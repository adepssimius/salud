import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { DatabaseService } from '../persistence/database.service';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

// The wire contract from app-spec/api.md → Conventions: every response timestamp is an integer of
// epoch seconds, never an ISO string. #20 found three mappers that broke this by copying a Drizzle
// Date straight through. This walks the whole response tree of every endpoint that could carry one
// of those objects, rather than asserting a fixed field list — a list only guards fields someone
// thought of, and that's exactly how #20 went unnoticed as long as it did.

// Keys ending in "At" are timestamps, with one addition ("since") and a few explicit exclusions for
// keys that end in "At" but aren't one (episode polymorphic pointers, the entry-metadata key).
const TIMESTAMP_KEY = /At$/;
const NOT_A_TIMESTAMP_KEY = new Set([
  'startedAtType',
  'startedAtId',
  'endedAtType',
  'endedAtId',
  'unitPreferenceAtEntry',
]);
const EXTRA_TIMESTAMP_KEYS = new Set(['since']);

function assertEpochSeconds(node: unknown, jsonPath: string): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    node.forEach((item, i) => assertEpochSeconds(item, `${jsonPath}[${i}]`));
    return;
  }
  if (typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = `${jsonPath}.${key}`;
    const looksLikeTimestamp = (TIMESTAMP_KEY.test(key) && !NOT_A_TIMESTAMP_KEY.has(key)) || EXTRA_TIMESTAMP_KEYS.has(key);
    if (looksLikeTimestamp && value !== null && value !== undefined) {
      // Number.isInteger fails an ISO string outright (the #20 failure mode) with a clearer message
      // than typeof, and the upper bound catches a plausible sibling bug — milliseconds instead of
      // seconds — that a bare type check would sail past.
      if (!Number.isInteger(value) || (value as number) >= 4_000_000_000) {
        throw new Error(`${path} is not epoch seconds: ${JSON.stringify(value)}`);
      }
    } else {
      assertEpochSeconds(value, path);
    }
  }
}

async function registerAndLogin(app: INestApplication) {
  const email = `ts-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: 'Timestamp User' });
  return { token: reg.body.token, userId: reg.body.user.id };
}

describe('Timestamp wire contract (e2e)', () => {
  let app: INestApplication;
  let tmpDir: string;
  let token: string;
  let patientId: string;
  let medicationId: string;
  let embodimentId: string;
  let observationId: string;
  let interventionId: string;
  let episodeId: string;
  let scheduleId: string;

  beforeAll(async () => {
    // Distinct prefix from every other suite's tmpdir (ISSUES #21 tracks the cross-suite
    // process.env.DATA_DIR flake this doesn't fix, only avoids compounding).
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-timestamps-'));
    process.env.DATA_DIR = tmpDir;
    process.env.DB_CLIENT = 'sqlite';
    process.env.JWT_SECRET = 'test-secret';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    const dbService = app.get(DatabaseService);
    await migrate((dbService as any).db, {
      migrationsFolder: path.join(process.cwd(), 'apps/api/src/db/migrations/sqlite'),
    });
    await app.init();

    const auth = await registerAndLogin(app);
    token = auth.token;

    const patientRes = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Timestamp Patient', dateOfBirth: '2020-01-01', sexAtBirth: 'female', myRole: 'parent' })
      .expect(201);
    patientId = patientRes.body.id;

    const med = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'timestamp-test-med' })
      .expect(201);
    medicationId = med.body.id;

    const emb = await request(app.getHttpServer())
      .post(`/api/medications/${medicationId}/embodiments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'timestamp suspension', unitType: 'ml' })
      .expect(201);
    embodimentId = emb.body.id;

    const obsRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        startEpisodeName: 'Timestamp episode',
        entries: [{ type: 'temperature', metadata: { value: 38.2, unit: 'C', method: 'oral' } }],
      })
      .expect(201);
    observationId = obsRes.body.id;
    episodeId = obsRes.body.episodeIds[0];

    const intRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'medication_dose',
        medicationId,
        medicationEmbodimentId: embodimentId,
        doseSource: 'override',
        amountMg: 120,
        episodeIds: [episodeId],
      })
      .expect(201);
    interventionId = intRes.body.id;

    const schedRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/schedules`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'medication_dose',
        label: 'Timestamp q6h',
        medicationId,
        startAt: new Date().toISOString(),
        frequencyHours: 6,
        doseMg: 120,
      })
      .expect(201);
    scheduleId = schedRes.body.id;
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it.each([
    ['POST create observation', () =>
      request(app.getHttpServer())
        .post(`/api/patients/${patientId}/observations`)
        .set(auth())
        .send({ observedAt: new Date().toISOString(), entries: [{ type: 'note', metadata: { text: 'hi' } }] })],
    ['GET list observations', () => request(app.getHttpServer()).get(`/api/patients/${patientId}/observations`).set(auth())],
    ['GET one observation', () => request(app.getHttpServer()).get(`/api/observations/${observationId}`).set(auth())],
    ['PATCH observation', () =>
      request(app.getHttpServer()).patch(`/api/observations/${observationId}`).set(auth()).send({ text: 'edited' })],
    ['GET observation revisions', () =>
      request(app.getHttpServer()).get(`/api/observations/${observationId}/revisions`).set(auth())],
    ['POST create intervention', () =>
      request(app.getHttpServer())
        .post(`/api/patients/${patientId}/interventions`)
        .set(auth())
        .send({ performedAt: new Date().toISOString(), type: 'medication_dose', medicationId, medicationEmbodimentId: embodimentId, doseSource: 'override', amountMg: 120 })],
    ['GET list interventions', () => request(app.getHttpServer()).get(`/api/patients/${patientId}/interventions`).set(auth())],
    ['GET one intervention', () => request(app.getHttpServer()).get(`/api/interventions/${interventionId}`).set(auth())],
    ['PATCH intervention', () =>
      request(app.getHttpServer()).patch(`/api/interventions/${interventionId}`).set(auth()).send({ amountMg: 125 })],
    ['GET intervention revisions', () =>
      request(app.getHttpServer()).get(`/api/interventions/${interventionId}/revisions`).set(auth())],
    ['POST schedule log', () => request(app.getHttpServer()).post(`/api/schedules/${scheduleId}/log`).set(auth())],
    ['GET episodes/active', () => request(app.getHttpServer()).get('/api/episodes/active').set(auth())],
    ['GET episode by id', () => request(app.getHttpServer()).get(`/api/episodes/${episodeId}`).set(auth())],
    ['GET episodes for patient', () => request(app.getHttpServer()).get(`/api/patients/${patientId}/episodes`).set(auth())],
    ['GET timeline', () => request(app.getHttpServer()).get(`/api/patients/${patientId}/timeline`).set(auth())],
    ['GET whats-new', () => request(app.getHttpServer()).get(`/api/patients/${patientId}/whats-new`).set(auth())],
    ['GET er-brief', () => request(app.getHttpServer()).get(`/api/patients/${patientId}/er-brief`).set(auth())],
    ['GET dashboard', () => request(app.getHttpServer()).get('/api/dashboard').set(auth())],
    ['GET patient', () => request(app.getHttpServer()).get(`/api/patients/${patientId}`).set(auth())],
  ] as const)('%s returns only epoch-second timestamps', async (_name, run) => {
    const res = await run();
    expect(res.status).toBeLessThan(400);
    assertEpochSeconds(res.body, '$');
  });

  it('the unauthenticated shared brief also carries only epoch seconds', async () => {
    const snap = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/er-brief/snapshots`)
      .set(auth())
      .send({ episodeId })
      .expect(201);
    const shared = await request(app.getHttpServer()).get(`/api/er-brief/shared/${snap.body.token}`).expect(200);
    assertEpochSeconds(shared.body, '$');
  });
});
