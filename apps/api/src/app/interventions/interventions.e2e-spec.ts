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
  const email = `int-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const password = 'password123';
  const displayName = 'Intervention User';

  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({
      email,
      password,
      displayName,
    });
  return { token: reg.body.token, email, userId: reg.body.user.id };
}

async function createPatient(app: INestApplication, token: string) {
  const res = await request(app.getHttpServer())
    .post(`/api/patients`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      fullName: `Patient ${Date.now()}`,
      dateOfBirth: '2015-01-01',
      sexAtBirth: 'female',
      myRole: 'parent',
    })
    .expect(201);
  return res.body.id as string;
}

describe('Interventions (e2e)', () => {
  let app: INestApplication;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-interventions-'));
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

  it('creates and fetches a medication dose intervention', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    const createRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'medication_dose',
        medicationId: 'med-1',
        doseSource: 'override',
        amountMg: 200,
        notes: 'Dose given',
      })
      .expect(201);

    expect(createRes.body.id).toBeDefined();
    expect(createRes.body.patientId).toBe(patientId);
    expect(createRes.body.type).toBe('medication_dose');
    expect(Array.isArray(createRes.body.resolvesEpisodeIds)).toBe(true);
    expect(createRes.body.metadata.medicationId).toBe('med-1');

    const getRes = await request(app.getHttpServer())
      .get(`/api/interventions/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(getRes.body.id).toBe(createRes.body.id);
    expect(getRes.body.metadata.medicationId).toBe('med-1');
  });

  it('rejects resolvesEpisodeIds that are not a subset of episodeIds', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'medication_dose',
        resolvesEpisodeIds: ['ep-1'],
        medicationId: 'med-1',
      })
      .expect(400);
  });

  it('enforces access control across users', async () => {
    const owner = await registerAndLogin(app);
    const other = await registerAndLogin(app);
    const patientId = await createPatient(app, owner.token);

    const created = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'dressing_change',
        bodyLocation: 'Left knee',
        side: 'left',
        dressingType: 'gauze',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/interventions/${created.body.id}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/interventions/${created.body.id}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
  });

  it('filters by medicationId', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'medication_dose',
        episodeIds: [],
        medicationId: 'med-a',
        doseSource: 'override',
        amountMg: 100,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'medication_dose',
        episodeIds: [],
        medicationId: 'med-b',
        doseSource: 'override',
        amountMg: 50,
      })
      .expect(201);

    const listMedA = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/interventions`)
      .query({ medicationId: 'med-a' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(listMedA.body.length).toBe(1);
    expect(listMedA.body[0].metadata.medicationId).toBe('med-a');
  });

  it('validates resolves subset on update while allowing updates without resending episodeIds', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    const created = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'medication_dose',
        startEpisodeName: 'Ear infection',
        medicationId: 'med-1',
        doseSource: 'override',
        amountMg: 50,
      })
      .expect(201);

    const episodeId = created.body.episodeIds[0];

    await request(app.getHttpServer())
      .patch(`/api/interventions/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ resolvesEpisodeIds: [episodeId], notes: 'updated' })
      .expect(200)
      .expect((res) => {
        expect(res.body.resolvesEpisodeIds).toEqual([episodeId]);
        expect(res.body.notes).toBe('updated');
      });

    await request(app.getHttpServer())
      .patch(`/api/interventions/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ resolvesEpisodeIds: ['ep-2'] })
      .expect(400);
  });
});
