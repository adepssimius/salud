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
  const email = `obs-${Date.now()}@example.com`;
  const password = 'password123';
  const displayName = 'Obs User';

  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({
      email,
      password,
      displayName,
    });
  return { token: reg.body.token, email, userId: reg.body.user.id, displayName };
}

describe('Observations (e2e)', () => {
  let app: INestApplication;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-observations-'));
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
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates and lists observations with multiple entries', async () => {
    const { token, userId } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/users/${userId}/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Obs Patient',
        dateOfBirth: '2019-01-01',
        sexAtBirth: 'female',
        myRole: 'parent',
      })
      .expect(201);
    const patientId = patientRes.body.id;

    const createRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        text: 'Feeling warm',
        symptomTags: ['cough'],
        entries: [
          { type: 'temperature', metadata: { valueC: 38.2, inputUnit: 'C' } },
          { type: 'heart_rate', metadata: { bpm: 120 } },
        ],
      })
      .expect(201);

    expect(createRes.body.entries.length).toBe(2);

    const listRes = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listRes.body.length).toBe(1);
    expect(listRes.body[0].entries.some((e: any) => e.type === 'temperature')).toBe(true);

    const getRes = await request(app.getHttpServer())
      .get(`/api/observations/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(getRes.body.id).toBe(createRes.body.id);
  });

  it('filters by entry type', async () => {
    const { token, userId } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/users/${userId}/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Filter Patient',
        dateOfBirth: '2020-02-02',
        sexAtBirth: 'male',
      })
      .expect(201);
    const patientId = patientRes.body.id;

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [{ type: 'heart_rate', metadata: { bpm: 100 } }],
      })
      .expect(201);

    const tempRes = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/observations?type=temperature`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(tempRes.body.length).toBe(0);
  });

  it('enforces patient access and patientId match on get', async () => {
    const owner = await registerAndLogin(app);
    const other = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/users/${owner.userId}/patients`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        fullName: 'Private Obs',
        dateOfBirth: '2018-08-08',
        sexAtBirth: 'female',
      })
      .expect(201);
    const patientId = patientRes.body.id;

    const obsRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [{ type: 'note', metadata: null }],
      })
      .expect(201);
    const obsId = obsRes.body.id;

    // Other user cannot get
    await request(app.getHttpServer())
      .get(`/api/observations/${obsId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);

    // If patientId mismatches in URL, also 404
    await request(app.getHttpServer())
      .get(`/api/patients/${other.userId}/observations/${obsId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(404);
  });

  it('starts and resolves episodes via observations', async () => {
    const { token, userId } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/users/${userId}/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Episode Patient',
        dateOfBirth: '2020-05-05',
        sexAtBirth: 'male',
      })
      .expect(201);
    const patientId = patientRes.body.id;

    const startRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        startEpisodeName: 'Fever',
        entries: [{ type: 'temperature', metadata: { valueC: 38.5 } }],
      })
      .expect(201);

    const episodeId = startRes.body.episodeIds[0];
    expect(episodeId).toBeDefined();

    const listEpisodes = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/episodes?status=active`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listEpisodes.body.find((e: any) => e.id === episodeId)?.status).toBe('active');

    const resolveRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [{ type: 'temperature', metadata: { valueC: 37.0 } }],
        episodeIds: [episodeId],
        resolvesEpisodeIds: [episodeId],
      })
      .expect(201);
    expect(resolveRes.body.resolvesEpisodeIds).toContain(episodeId);

    const resolvedEpisodes = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/episodes?status=resolved`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const resolved = resolvedEpisodes.body.find((e: any) => e.id === episodeId);
    expect(resolved.status).toBe('resolved');
    expect(resolved.endedAtId).toBe(resolveRes.body.id);
    expect(resolved.endedAtType).toBe('observation');
  });
});
