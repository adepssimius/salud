import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { DatabaseService } from '../persistence/database.service';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'crypto';

// Stand-in medication ids. They need to be v4 UUIDs (CreateInterventionDto validates the shape),
// but not rows in the catalog: these suites exercise intervention persistence and filtering, not
// dose resolution. dosing.e2e-spec.ts covers the path where the medication actually exists.
const MED_1 = randomUUID();
const MED_A = randomUUID();
const MED_B = randomUUID();

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
    // Explicit bind (ISSUES #25): without this, supertest rebinds/closes an ephemeral port on
    // every single request instead of once per suite -- the leading suspect for the flake where
    // a request occasionally gets a real but wrong response (401/404 on a route that just worked).
    await app.listen(0);
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
        medicationId: MED_1,
        doseSource: 'override',
        amountMg: 200,
        notes: 'Dose given',
      })
      .expect(201);

    expect(createRes.body.id).toBeDefined();
    expect(createRes.body.patientId).toBe(patientId);
    expect(createRes.body.type).toBe('medication_dose');
    expect(Array.isArray(createRes.body.resolvesEpisodeIds)).toBe(true);
    expect(createRes.body.metadata.medicationId).toBe(MED_1);
    // Regression marker for ISSUES #20: createdAt/updatedAt leaked as ISO strings here. The full
    // wire-contract sweep lives in persistence/timestamps.e2e-spec.ts; this just names the file.
    expect(Number.isInteger(createRes.body.createdAt)).toBe(true);
    expect(Number.isInteger(createRes.body.updatedAt)).toBe(true);

    const getRes = await request(app.getHttpServer())
      .get(`/api/interventions/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(getRes.body.id).toBe(createRes.body.id);
    expect(getRes.body.metadata.medicationId).toBe(MED_1);
  });

  // A single mistyped year would otherwise pin the dashboard's "last dose" to the future forever,
  // with no way to correct it from the UI -- and "did I already give Tylenol?" is the founding
  // question the app exists to answer.
  it('rejects a performedAt in the future', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    const res = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: '2030-01-01T00:00:00Z',
        type: 'medication_dose',
        medicationId: MED_1,
        doseSource: 'override',
        amountMg: 100,
      })
      .expect(400);
    expect(res.body.message).toContain('DATE_IN_FUTURE');
  });

  // These two codes existed but were wired only into schedule create. A dose with no medicationId
  // doesn't just record nothing -- it skips guideline resolution entirely, so the dosing engine
  // and every advisory silently do nothing.
  it('requires medicationId on a dose and bodyLocation on a dressing change, including on update', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    const noMed = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ performedAt: new Date().toISOString(), type: 'medication_dose', amountMg: 100 })
      .expect(400);
    expect(noMed.body.message).toBe('MEDICATION_ID_REQUIRED');

    const noLocation = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ performedAt: new Date().toISOString(), type: 'dressing_change', side: 'left' })
      .expect(400);
    expect(noLocation.body.message).toBe('BODY_LOCATION_REQUIRED');

    const dressing = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'dressing_change',
        bodyLocation: 'Left knee',
        side: 'left',
      })
      .expect(201);

    // Checked against the merged row, so clearing it on an existing event is caught too.
    const cleared = await request(app.getHttpServer())
      .patch(`/api/interventions/${dressing.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ bodyLocation: '' })
      .expect(400);
    expect(cleared.body.message).toBe('BODY_LOCATION_REQUIRED');
  });

  it('rejects a negative amountMg rather than counting it toward the daily total', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'medication_dose',
        medicationId: MED_1,
        doseSource: 'override',
        amountMg: -100,
      })
      .expect(400);
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
        medicationId: MED_1,
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
        medicationId: MED_A,
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
        medicationId: MED_B,
        doseSource: 'override',
        amountMg: 50,
      })
      .expect(201);

    const listMedA = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/interventions`)
      .query({ medicationId: MED_A })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(listMedA.body.length).toBe(1);
    expect(listMedA.body[0].metadata.medicationId).toBe(MED_A);
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
        medicationId: MED_1,
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
