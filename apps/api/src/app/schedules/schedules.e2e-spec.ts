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
  const email = `sched-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: 'Schedule User' });
  return { token: reg.body.token, userId: reg.body.user.id };
}

describe('Schedules (e2e)', () => {
  let app: INestApplication;
  let tmpDir: string;
  let token: string;
  let patientId: string;
  let medicationId: string;
  let embodimentId: string;

  async function createPatient() {
    const res = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Schedule Patient', dateOfBirth: '2015-01-01', sexAtBirth: 'male', myRole: 'parent' })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-schedules-'));
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
    patientId = await createPatient();

    const med = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'schedule-test-med' })
      .expect(201);
    medicationId = med.body.id;

    const emb = await request(app.getHttpServer())
      .post(`/api/medications/${medicationId}/embodiments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'suspension', concentrationMgPerMl: 40, unitType: 'ml' })
      .expect(201);
    embodimentId = emb.body.id;
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects a medication schedule without medicationId', async () => {
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/schedules`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'medication_dose', label: 'x', frequencyHours: 8, startAt: new Date().toISOString() })
      .expect(400);
  });

  it('rejects a dressing schedule without bodyLocation', async () => {
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/schedules`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'dressing_change', label: 'x', frequencyHours: 24, startAt: new Date().toISOString() })
      .expect(400);
  });

  it('rejects a schedule with neither frequencyHours nor explicitTimes', async () => {
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/schedules`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'medication_dose', label: 'x', medicationId, startAt: new Date().toISOString() })
      .expect(400);
  });

  it('creates a frequency-based schedule with nextDueAt = startAt, and logs doses through the shared dosing engine', async () => {
    const startAt = new Date();
    const create = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/schedules`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'medication_dose',
        label: 'Amoxicillin q8h',
        medicationId,
        medicationEmbodimentId: embodimentId,
        doseMg: 400,
        doseMl: 5,
        frequencyHours: 8,
        startAt: startAt.toISOString(),
        endAfterOccurrences: 3,
      })
      .expect(201);
    expect(create.body.nextDueAt).toBe(Math.floor(startAt.getTime() / 1000));
    expect(create.body.status).toBe('active');
    expect(create.body.adherence.loggedCount).toBe(0);
    expect(create.body.adherence.remainingOccurrences).toBe(3);
    const scheduleId = create.body.id;

    const log1 = await request(app.getHttpServer())
      .post(`/api/schedules/${scheduleId}/log`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(log1.body.intervention.scheduleId).toBe(scheduleId);
    expect(log1.body.intervention.metadata.medicationId).toBe(medicationId);
    expect(log1.body.intervention.metadata.amountMg).toBe(400);
    // Scheduled doses are exempt from the override-implies-atypical rule.
    expect(log1.body.intervention.metadata.isAtypical).toBe(false);
    expect(log1.body.intervention.metadata.atypicalReason).toBeNull();

    expect(log1.body.schedule.adherence.loggedCount).toBe(1);
    expect(log1.body.schedule.adherence.remainingOccurrences).toBe(2);
    expect(log1.body.schedule.status).toBe('active');
    const firstDosePerformedAt = log1.body.intervention.performedAt;
    expect(log1.body.schedule.nextDueAt).toBe(firstDosePerformedAt + 8 * 3600);

    const log2 = await request(app.getHttpServer())
      .post(`/api/schedules/${scheduleId}/log`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(log2.body.schedule.adherence.remainingOccurrences).toBe(1);
    expect(log2.body.schedule.status).toBe('active');

    const log3 = await request(app.getHttpServer())
      .post(`/api/schedules/${scheduleId}/log`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(log3.body.schedule.adherence.remainingOccurrences).toBe(0);
    expect(log3.body.schedule.status).toBe('completed');
    expect(log3.body.schedule.nextDueAt).toBeNull();
  });

  it('creates an explicit-times schedule with nextDueAt at the next slot at-or-after startAt', async () => {
    const startAt = new Date();
    startAt.setHours(10, 0, 0, 0); // 10:00 local
    const res = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/schedules`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'dressing_change',
        label: 'Nightly dressing',
        bodyLocation: 'Left knee',
        side: 'left',
        dressingType: 'sterile gauze',
        explicitTimes: ['08:00', '20:00'],
        startAt: startAt.toISOString(),
      })
      .expect(201);
    // From 10:00, the next slot is 20:00 the same day.
    const expected = new Date(startAt);
    expected.setHours(20, 0, 0, 0);
    expect(res.body.nextDueAt).toBe(Math.floor(expected.getTime() / 1000));
  });

  it('pausing clears nextDueAt; resuming recomputes it', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/schedules`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'medication_dose',
        label: 'Pause test',
        medicationId,
        frequencyHours: 6,
        startAt: new Date().toISOString(),
      })
      .expect(201);
    const scheduleId = res.body.id;
    expect(res.body.nextDueAt).not.toBeNull();

    const paused = await request(app.getHttpServer())
      .patch(`/api/schedules/${scheduleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'paused' })
      .expect(200);
    expect(paused.body.status).toBe('paused');
    expect(paused.body.nextDueAt).toBeNull();

    const resumed = await request(app.getHttpServer())
      .patch(`/api/schedules/${scheduleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' })
      .expect(200);
    expect(resumed.body.status).toBe('active');
    expect(resumed.body.nextDueAt).not.toBeNull();
  });

  it('lists schedules for a patient with filters', async () => {
    const list = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/schedules?type=medication_dose`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.length).toBeGreaterThan(0);
    expect(list.body.every((s: any) => s.type === 'medication_dose')).toBe(true);
  });

  it('enforces patient access control (404, not 403)', async () => {
    const other = await registerAndLogin(app);
    const res = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/schedules`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'medication_dose', label: 'x', medicationId, frequencyHours: 8, startAt: new Date().toISOString() })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/schedules/${res.body.id}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/schedules`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
  });
});
