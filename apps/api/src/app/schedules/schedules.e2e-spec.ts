import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { createTestApp } from '../../testing/create-test-app';

async function registerAndLogin(app: INestApplication) {
  const email = `sched-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: 'Schedule User' });
  return { token: reg.body.token, userId: reg.body.user.id };
}

describe('Schedules (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
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
    ({ app, close } = await createTestApp('schedules'));

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
    await close();
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

  // The regression guard for the future-date rule: planning fields are deliberately exempt
  // (api.md -> Conventions). A course that starts next week is the normal case, not an error, and
  // this test exists so nobody later "completes" the @IsNotInFuture sweep by adding it here.
  it('accepts a schedule whose startAt and endAt are in the future', async () => {
    const startAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const endAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/schedules`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'medication_dose', label: 'next week', medicationId, doseMg: 100, frequencyHours: 8, startAt, endAt })
      .expect(201);
  });

  it('rejects logging a dose at a future performedAt', async () => {
    const create = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/schedules`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'medication_dose',
        label: 'future log',
        medicationId,
        doseMg: 100,
        frequencyHours: 8,
        startAt: new Date().toISOString(),
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/schedules/${create.body.id}/log`)
      .set('Authorization', `Bearer ${token}`)
      .send({ performedAt: new Date(Date.now() + 86_400_000).toISOString() })
      .expect(400);
    expect(res.body.message).toContain('DATE_IN_FUTURE');
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
    // A scheduled dose records how it was actually arrived at: from a plan, not from a caregiver
    // typing their own number. 'override' would misread the most plan-conforming dose there is.
    expect(log1.body.intervention.metadata.doseSource).toBe('schedule');
    // Exempt from the override-implies-atypical rule. Note the exemption keys on the scheduleId,
    // not on doseSource -- so this stays true for rows written before 'schedule' existed.
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

  // Fixed times are wall-clock times in the schedule's own zone, never the API server's
  // (data-model.md → InterventionSchedule.timeZone). The cluster's pods resolve UTC, and so does
  // every API test run (apps/api/src/testing/jest-global-setup.ts pins TZ): before the zone was
  // stored, a Chicago household's "20:00" fell due at 20:00 UTC — 14:00 at home.
  describe('fixed-time schedules in the household zone (server on UTC)', () => {
    const iso = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString();

    function createFixed(body: Record<string, unknown>) {
      return request(app.getHttpServer())
        .post(`/api/patients/${patientId}/schedules`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'dressing_change',
          label: 'Zoned dressing',
          bodyLocation: 'Left knee',
          side: 'left',
          dressingType: 'sterile gauze',
          ...body,
        });
    }

    it('runs on a UTC clock for the rest of this block', () => {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
    });

    it('places explicitTimes in the schedule zone, not the server zone', async () => {
      const res = await createFixed({
        explicitTimes: ['08:00', '20:00'],
        timeZone: 'America/Chicago',
        startAt: '2026-11-10T15:00:00.000Z', // 09:00 CST
      }).expect(201);
      expect(res.body.timeZone).toBe('America/Chicago');
      // 20:00 CST is 02:00Z the next day, not 20:00Z.
      expect(iso(res.body.nextDueAt)).toBe('2026-11-11T02:00:00.000Z');
    });

    it('advances from a logged dose to the next slot in the schedule zone', async () => {
      const created = await createFixed({
        explicitTimes: ['08:00', '20:00'],
        timeZone: 'America/Chicago',
        startAt: '2026-11-10T13:00:00.000Z', // 07:00 CST
      }).expect(201);
      expect(iso(created.body.nextDueAt)).toBe('2026-11-10T14:00:00.000Z'); // 08:00 CST
      const logged = await request(app.getHttpServer())
        .post(`/api/schedules/${created.body.id}/log`)
        .set('Authorization', `Bearer ${token}`)
        .send({ performedAt: '2026-11-10T14:05:00.000Z' }) // 08:05 CST
        .expect(201);
      expect(iso(logged.body.schedule.nextDueAt)).toBe('2026-11-11T02:00:00.000Z'); // 20:00 CST
    });

    it('counts expected occurrences on the schedule zone', async () => {
      // Asia/Kolkata has no DST (+05:30), so its 08:00 is 02:30Z every day and the expected count
      // can be worked out here by plain arithmetic.
      const nowMs = Date.now();
      const startMs = nowMs - 5 * 24 * 3600_000 - 7 * 60_000;
      const res = await createFixed({
        explicitTimes: ['08:00'],
        timeZone: 'Asia/Kolkata',
        startAt: new Date(startMs).toISOString(),
      }).expect(201);
      const dayMs = 24 * 3600_000;
      const slotOffsetMs = 2.5 * 3600_000; // 02:30Z
      let first = Math.floor(startMs / dayMs) * dayMs + slotOffsetMs;
      if (first < startMs) first += dayMs;
      const expected = first > nowMs ? 0 : Math.floor((nowMs - first) / dayMs) + 1;
      expect(res.body.adherence.expectedCount).toBe(expected);
    });

    it('moves a slot inside the spring-forward gap past the jump', async () => {
      // America/Chicago skips 02:00–03:00 CST on 2026-03-08; "02:30" that day is due at 03:30 CDT.
      const res = await createFixed({
        explicitTimes: ['02:30'],
        timeZone: 'America/Chicago',
        startAt: '2026-03-08T06:00:00.000Z', // 00:00 CST
      }).expect(201);
      expect(iso(res.body.nextDueAt)).toBe('2026-03-08T08:30:00.000Z');
    });

    it('uses the first of a slot that occurs twice at fall-back, and the new offset after', async () => {
      // 01:00–02:00 happens twice in America/Chicago on 2026-11-01; "01:30" is the CDT one.
      const res = await createFixed({
        explicitTimes: ['01:30'],
        timeZone: 'America/Chicago',
        startAt: '2026-11-01T05:00:00.000Z', // 00:00 CDT
      }).expect(201);
      expect(iso(res.body.nextDueAt)).toBe('2026-11-01T06:30:00.000Z');
      const logged = await request(app.getHttpServer())
        .post(`/api/schedules/${res.body.id}/log`)
        .set('Authorization', `Bearer ${token}`)
        .send({ performedAt: '2026-11-01T06:31:00.000Z' })
        .expect(201);
      // The repeat at 01:30 CST (07:30Z) is not a second slot; the next is 01:30 CST on 11-02.
      expect(iso(logged.body.schedule.nextDueAt)).toBe('2026-11-02T07:30:00.000Z');
    });

    it('a schedule without a zone keeps the server-clock reading; PATCHing a zone recomputes it', async () => {
      const created = await createFixed({
        explicitTimes: ['20:00'],
        startAt: '2026-11-10T15:00:00.000Z',
      }).expect(201);
      expect(created.body.timeZone).toBeNull();
      expect(iso(created.body.nextDueAt)).toBe('2026-11-10T20:00:00.000Z'); // 20:00 on the UTC server

      const patched = await request(app.getHttpServer())
        .patch(`/api/schedules/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ timeZone: 'America/Chicago' })
        .expect(200);
      expect(patched.body.timeZone).toBe('America/Chicago');
      expect(iso(patched.body.nextDueAt)).toBe('2026-11-11T02:00:00.000Z');
    });

    it('rejects an unknown zone with INVALID_TIME_ZONE on create and update', async () => {
      const bad = await createFixed({
        explicitTimes: ['08:00'],
        timeZone: 'Mars/Olympus_Mons',
        startAt: '2026-11-10T15:00:00.000Z',
      }).expect(400);
      expect(bad.body.message).toBe('INVALID_TIME_ZONE');

      const ok = await createFixed({ explicitTimes: ['08:00'], startAt: '2026-11-10T15:00:00.000Z' }).expect(201);
      const badPatch = await request(app.getHttpServer())
        .patch(`/api/schedules/${ok.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ timeZone: 'Not/AZone' })
        .expect(400);
      expect(badPatch.body.message).toBe('INVALID_TIME_ZONE');
    });
  });
});
