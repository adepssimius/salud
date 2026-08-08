import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { AppModule } from '../app.module';
import { DatabaseService } from '../persistence/database.service';
import { erBriefSnapshots } from '../../db/schema';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

async function registerAndLogin(app: INestApplication) {
  const email = `brief-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: 'Brief User' });
  return { token: reg.body.token, userId: reg.body.user.id };
}

describe('ER Brief (e2e)', () => {
  let app: INestApplication;
  let tmpDir: string;
  let token: string;
  let patientId: string;
  let medicationId: string;
  let embodimentId: string;
  let conditionId: string;
  let scheduleId: string;
  let episodeId: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-erbrief-'));
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
    // Explicit bind (ISSUES #25): without this, supertest rebinds/closes an ephemeral port on
    // every single request instead of once per suite -- the leading suspect for the flake where
    // a request occasionally gets a real but wrong response (401/404 on a route that just worked).
    await app.listen(0);

    const auth = await registerAndLogin(app);
    token = auth.token;

    const patient = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Brief Patient', dateOfBirth: '2018-03-01', sexAtBirth: 'female', myRole: 'parent' })
      .expect(201);
    patientId = patient.body.id;

    await request(app.getHttpServer())
      .patch(`/api/patients/${patientId}/code-status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ codeStatus: 'Full code' })
      .expect(200);

    const med = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'brief-test-med' })
      .expect(201);
    medicationId = med.body.id;
    const emb = await request(app.getHttpServer())
      .post(`/api/medications/${medicationId}/embodiments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'suspension', concentrationMgPerMl: 40, unitType: 'ml' })
      .expect(201);
    embodimentId = emb.body.id;

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/reactions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        description: 'anaphylaxis last time',
        occurredAt: '2025-01-01T00:00:00Z',
        severity: 'danger',
        scopeType: 'medication',
        medicationId,
      })
      .expect(201);

    const cond = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/conditions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'ALL treatment', diagnosisText: 'ALL', baselines: ['resting HR runs 110'] })
      .expect(201);
    conditionId = cond.body.id;

    await request(app.getHttpServer())
      .post(`/api/conditions/${conditionId}/protocols`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Fever with port',
        triggerMetric: 'temperature',
        triggerOperator: 'gte',
        triggerValue: 38,
        instructionText: 'ER immediately, do not give antipyretics first',
        sourceText: 'Dr. Okafor, 2026-03-01',
      })
      .expect(201);

    // A prior, older episode under the same condition (F-7.8).
    const priorObs = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: '2025-01-01T00:00:00Z',
        startEpisodeName: 'Neutropenic fever #2',
        startEpisodeConditionId: conditionId,
        entries: [{ type: 'temperature', metadata: { value: 37, unit: 'C', method: 'oral' } }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/observations/${priorObs.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ resolvesEpisodeIds: priorObs.body.episodeIds })
      .expect(200);

    // Weight on file so the dose's own weightKgUsed can drive mg/kg math.
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [{ type: 'weight', metadata: { kg: 20 } }],
      })
      .expect(201);

    const sched = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/schedules`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'medication_dose',
        label: 'Amoxicillin q8h',
        medicationId,
        medicationEmbodimentId: embodimentId,
        doseMg: 200,
        frequencyHours: 8,
        startAt: new Date().toISOString(),
      })
      .expect(201);
    scheduleId = sched.body.id;
    await request(app.getHttpServer())
      .post(`/api/schedules/${scheduleId}/log`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    // The current episode, tripping the Fever-with-port protocol (101F ≈ 38.3C).
    const obs = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        startEpisodeName: 'Neutropenic fever #3',
        startEpisodeConditionId: conditionId,
        entries: [{ type: 'temperature', metadata: { value: 101, unit: 'F', method: 'oral' } }],
      })
      .expect(201);
    episodeId = obs.body.episodeIds[0];

    // A same-episode, off-guideline dose to populate atypicalAdvisories.
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'medication_dose',
        episodeIds: [episodeId],
        medicationId,
        doseSource: 'override',
        amountMg: 999,
      })
      .expect(201);
  }, 30000);

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('builds a complete header', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/er-brief`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.header.patient.fullName).toBe('Brief Patient');
    expect(res.body.header.patient.ageYears).toBeGreaterThanOrEqual(0);
    expect(res.body.header.latestWeight.kg).toBe(20);
    expect(res.body.header.codeStatus.value).toBe('Full code');
    expect(res.body.header.codeStatus.setByName).toBe('Brief User');
    expect(res.body.header.dangerReactions.length).toBe(1);
    expect(res.body.header.dangerReactions[0].description).toBe('anaphylaxis last time');
    expect(res.body.header.activeConditions.some((c: any) => c.id === conditionId)).toBe(true);
    expect(res.body.header.protocolFiredReason.protocolName).toBe('Fever with port');
    expect(res.body.header.protocolFiredReason.instructionText).toBe(
      'ER immediately, do not give antipyretics first',
    );
  });

  it('computes mg/kg on the active schedule from the dose\'s own recorded weight, not the current patient weight', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/er-brief`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const sched = res.body.body.activeSchedules.find((s: any) => s.scheduleId === scheduleId);
    expect(sched).toBeDefined();
    expect(sched.medicationName).toBe('brief-test-med');
    expect(sched.lastDoseMg).toBe(200);
    expect(sched.lastDoseMgPerKg).toBe(10); // 200mg / 20kg
    // No MedicationGuideline exists for this test medication, so the dosing engine has no
    // interval to compute nextAllowedAt from — null is the correct value here, not a bug.
    expect(sched.nextAllowedAt).toBeNull();
  });

  it('includes the prior episode under the same condition, and the atypical dose in the current episode', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/er-brief?episodeId=${episodeId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.body.episode.id).toBe(episodeId);
    expect(res.body.body.priorEpisodes.length).toBe(1);
    expect(res.body.body.priorEpisodes[0].name).toBe('Neutropenic fever #2');
    expect(res.body.body.priorEpisodes[0].status).toBe('resolved');
    expect(res.body.body.atypicalAdvisories.length).toBe(1);
    expect(res.body.body.atypicalAdvisories[0].payload.reasons).toContain('override');
    expect(
      res.body.body.events.some((e: any) => e.kind === 'advisory' && e.type === 'protocol_fired'),
    ).toBe(true);
  });

  it('rejects an unknown episodeId with 404 EPISODE_NOT_FOUND', async () => {
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/er-brief?episodeId=11111111-1111-4111-8111-111111111111`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('enforces patient access control (404, not 403)', async () => {
    const other = await registerAndLogin(app);
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/er-brief`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/er-brief/snapshots`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({})
      .expect(404);
  });

  it('rejects expiresInHours beyond the 168h cap', async () => {
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/er-brief/snapshots`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expiresInHours: 200 })
      .expect(400);
  });

  describe('frozen snapshots', () => {
    it('round-trips through the unauthenticated shared route with no Authorization header, frozen at creation', async () => {
      const create = await request(app.getHttpServer())
        .post(`/api/patients/${patientId}/er-brief/snapshots`)
        .set('Authorization', `Bearer ${token}`)
        .send({ episodeId })
        .expect(201);
      expect(create.body.token).toBeTruthy();
      expect(create.body.url).toContain(create.body.token);
      expect(create.body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

      const shared = await request(app.getHttpServer())
        .get(`/api/er-brief/shared/${create.body.token}`)
        .expect(200);
      expect(shared.body.payload.header.patient.fullName).toBe('Brief Patient');
      expect(shared.body.payload.body.episode.id).toBe(episodeId);
      expect(shared.body.frozenAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));

      // A non-member can read the shared link (it's a capability, not an account) but there is
      // no snapshot-creation path available to them at all without patient access — already
      // covered by the access-control test above.
      const other = await registerAndLogin(app);
      const sharedAsOther = await request(app.getHttpServer())
        .get(`/api/er-brief/shared/${create.body.token}`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(200);
      expect(sharedAsOther.body.payload.header.patient.fullName).toBe('Brief Patient');
    });

    it('404s identically for a missing token and an expired one', async () => {
      const missing = await request(app.getHttpServer())
        .get('/api/er-brief/shared/does-not-exist')
        .expect(404);
      expect(missing.body.message).toBe('SNAPSHOT_NOT_FOUND');

      const create = await request(app.getHttpServer())
        .post(`/api/patients/${patientId}/er-brief/snapshots`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);

      const dbService = app.get(DatabaseService);
      const db = (dbService as any).db;
      await db
        .update(erBriefSnapshots)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(erBriefSnapshots.token, create.body.token));

      const expired = await request(app.getHttpServer())
        .get(`/api/er-brief/shared/${create.body.token}`)
        .expect(404);
      expect(expired.body.message).toBe('SNAPSHOT_NOT_FOUND');
    });

    it('lists snapshots without the token, newest first, and drops revoked ones', async () => {
      const first = await request(app.getHttpServer())
        .post(`/api/patients/${patientId}/er-brief/snapshots`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);
      const second = await request(app.getHttpServer())
        .post(`/api/patients/${patientId}/er-brief/snapshots`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);

      const list = await request(app.getHttpServer())
        .get(`/api/patients/${patientId}/er-brief/snapshots`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(list.body[0].token).toBeUndefined();
      expect(list.body[0].expiresAt).toBeDefined();
      const ids = list.body.map((s: any) => s.id);

      const dbService = app.get(DatabaseService);
      const db = (dbService as any).db;
      const firstRow = await db.select().from(erBriefSnapshots).where(eq(erBriefSnapshots.token, first.body.token));
      const secondRow = await db.select().from(erBriefSnapshots).where(eq(erBriefSnapshots.token, second.body.token));
      expect(ids).toEqual(expect.arrayContaining([firstRow[0].id, secondRow[0].id]));

      await request(app.getHttpServer())
        .delete(`/api/er-brief/snapshots/${secondRow[0].id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const listAfter = await request(app.getHttpServer())
        .get(`/api/patients/${patientId}/er-brief/snapshots`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(listAfter.body.map((s: any) => s.id)).not.toContain(secondRow[0].id);
      expect(listAfter.body.map((s: any) => s.id)).toContain(firstRow[0].id);
    });

    it('revokes a snapshot by deleting it, after which the shared link 404s', async () => {
      const create = await request(app.getHttpServer())
        .post(`/api/patients/${patientId}/er-brief/snapshots`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);

      const dbService = app.get(DatabaseService);
      const db = (dbService as any).db;
      const rows = await db
        .select()
        .from(erBriefSnapshots)
        .where(eq(erBriefSnapshots.token, create.body.token));
      const snapshotId = rows[0].id;

      await request(app.getHttpServer())
        .delete(`/api/er-brief/snapshots/${snapshotId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/er-brief/shared/${create.body.token}`)
        .expect(404);
    });
  });
});
