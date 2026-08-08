import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { DatabaseService } from '../persistence/database.service';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

async function registerAndLogin(app: INestApplication) {
  const email = `ep-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = 'password123';
  const displayName = 'Episode User';

  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password, displayName });
  return { token: reg.body.token, email, userId: reg.body.user.id, displayName };
}

async function createPatient(app: INestApplication, token: string) {
  const res = await request(app.getHttpServer())
    .post('/api/patients')
    .set('Authorization', `Bearer ${token}`)
    .send({
      fullName: 'Episode Patient',
      dateOfBirth: '2019-01-01',
      sexAtBirth: 'female',
      myRole: 'parent',
    })
    .expect(201);
  return res.body.id;
}

describe('Episodes (e2e)', () => {
  let app: INestApplication;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-episodes-'));
    process.env.DATA_DIR = tmpDir;
    process.env.DB_CLIENT = 'sqlite';
    process.env.JWT_SECRET = 'test-secret';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    const dbService = app.get(DatabaseService);
    await migrate((dbService as any).db, {
      migrationsFolder: path.join(process.cwd(), 'apps/api/src/db/migrations/sqlite'),
    });
    await app.init();
    // Explicit bind (ISSUES #25): without this, supertest rebinds/closes an ephemeral port on
    // every single request instead of once per suite -- the leading suspect for the flake where
    // a request occasionally gets a real but wrong response (401/404 on a route that just worked).
    await app.listen(0);
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns episode details with linked observation ids', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    const obsRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        text: 'Fever started',
        startEpisodeName: 'Fever Jan 2025',
        entries: [{ type: 'temperature', metadata: { value: 38.5, unit: 'C', method: 'oral' } }],
      })
      .expect(201);
    const episodeId = obsRes.body.episodeIds[0];
    expect(episodeId).toBeDefined();

    const getRes = await request(app.getHttpServer())
      .get(`/api/episodes/${episodeId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(getRes.body.id).toBe(episodeId);
    expect(getRes.body.patientId).toBe(patientId);
    expect(getRes.body.name).toBe('Fever Jan 2025');
    expect(getRes.body.status).toBe('active');
    expect(getRes.body.observationIds).toEqual([obsRes.body.id]);
    expect(getRes.body.interventionIds).toEqual([]);
    // Derived timestamps, resolved from the linked start event — the single-episode route returns
    // the same shape the list route does (api.md → Episodes).
    expect(getRes.body.startedAt).toBe(obsRes.body.observedAt);
    expect(getRes.body.endedAt).toBeNull();
  });

  it('reflects resolution and includes the resolving intervention id', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    const obsRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        startEpisodeName: 'Ear infection',
        entries: [{ type: 'temperature', metadata: { value: 38.9, unit: 'C', method: 'oral' } }],
      })
      .expect(201);
    const episodeId = obsRes.body.episodeIds[0];

    const intRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'dressing_change',
        bodyLocation: 'Left ear',
        side: 'left',
        dressingType: 'n/a',
        episodeIds: [episodeId],
        resolvesEpisodeIds: [episodeId],
      })
      .expect(201);

    const getRes = await request(app.getHttpServer())
      .get(`/api/episodes/${episodeId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(getRes.body.status).toBe('resolved');
    expect(getRes.body.endedAtType).toBe('intervention');
    expect(getRes.body.endedAtId).toBe(intRes.body.id);
    expect(getRes.body.observationIds).toEqual([obsRes.body.id]);
    expect(getRes.body.interventionIds).toEqual([intRes.body.id]);
    // Once resolved, endedAt resolves from the linked resolving event rather than staying null.
    expect(getRes.body.startedAt).toBe(obsRes.body.observedAt);
    expect(getRes.body.endedAt).toBe(intRes.body.performedAt);
  });

  it('returns 404 for a non-member and 400 for a malformed id', async () => {
    const owner = await registerAndLogin(app);
    const other = await registerAndLogin(app);
    const patientId = await createPatient(app, owner.token);

    const obsRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        observedAt: new Date().toISOString(),
        startEpisodeName: 'Private episode',
        entries: [{ type: 'temperature', metadata: { value: 37.9, unit: 'C', method: 'oral' } }],
      })
      .expect(201);
    const episodeId = obsRes.body.episodeIds[0];

    await request(app.getHttpServer())
      .get(`/api/episodes/${episodeId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);

    await request(app.getHttpServer())
      .get('/api/episodes/not-a-uuid')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(400);
  });

  it('still resolves /episodes/active correctly alongside /episodes/:episodeId', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        startEpisodeName: 'Active check',
        entries: [{ type: 'temperature', metadata: { value: 38.1, unit: 'C', method: 'oral' } }],
      })
      .expect(201);

    const activeRes = await request(app.getHttpServer())
      .get('/api/episodes/active')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(activeRes.body.some((e: any) => e.name === 'Active check')).toBe(true);
    // Regression marker for ISSUES #20: this route's createdAt/updatedAt leaked as ISO strings
    // while getById/listForPatient in this same file normalized theirs. The full wire-contract
    // sweep lives in persistence/timestamps.e2e-spec.ts; this just names the file.
    const active = activeRes.body.find((e: any) => e.name === 'Active check');
    expect(Number.isInteger(active.createdAt)).toBe(true);
    expect(Number.isInteger(active.updatedAt)).toBe(true);
  });
});
