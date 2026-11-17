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

  // data-model.md → ScheduleAdherence: expectedCount stops at the course's end. A finished course
  // must not keep accruing "missed" doses after endAt or past endAfterOccurrences.
  it('caps expectedCount at endAt and at endAfterOccurrences', async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86400_000);
    const byEndAt = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/schedules`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'medication_dose',
        label: 'ended course',
        medicationId,
        frequencyHours: 24,
        startAt: tenDaysAgo.toISOString(),
        // Slots at day 0, 1, 2 (inclusive of the boundary) — three, not eleven.
        endAt: new Date(tenDaysAgo.getTime() + 2 * 86400_000).toISOString(),
      })
      .expect(201);
    expect(byEndAt.body.adherence.expectedCount).toBe(3);

    const byCount = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/schedules`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'medication_dose',
        label: 'five doses',
        medicationId,
        frequencyHours: 24,
        startAt: tenDaysAgo.toISOString(),
        endAfterOccurrences: 5,
      })
      .expect(201);
    expect(byCount.body.adherence.expectedCount).toBe(5);
    expect(byCount.body.adherence.missed).toBe(5);

    const open = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/schedules`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'medication_dose', label: 'open', medicationId, frequencyHours: 24, startAt: tenDaysAgo.toISOString() })
      .expect(201);
    expect(open.body.adherence.expectedCount).toBe(11);
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

  // api.md → Intervention schedules → "Linking existing doses": doses logged ad hoc before the
  // schedule existed are attached explicitly, never counted implicitly.
  describe('linking existing doses', () => {
    const http = () => request(app.getHttpServer());
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
    let pid: string;
    let otherEmbodimentId: string;
    let otherMedId: string;

    const giveDose = async (performedAt: string, over: Record<string, any> = {}) =>
      (
        await auth(http().post(`/api/patients/${pid}/interventions`))
          .send({ type: 'medication_dose', performedAt, medicationId, medicationEmbodimentId: embodimentId, amountMg: 200, doseSource: 'override', ...over })
          .expect(201)
      ).body.id as string;

    const makeSchedule = async (over: Record<string, any> = {}) =>
      (
        await auth(http().post(`/api/patients/${pid}/schedules`))
          .send({ type: 'medication_dose', label: 'q12h', medicationId, medicationEmbodimentId: embodimentId, frequencyHours: 12, startAt: hoursAgo(48), ...over })
          .expect(201)
      ).body;

    beforeAll(async () => {
      pid = await createPatient();
      otherEmbodimentId = (
        await auth(http().post(`/api/medications/${medicationId}/embodiments`)).send({ label: 'other bottle', concentrationMgPerMl: 20, unitType: 'ml' }).expect(201)
      ).body.id;
      otherMedId = (await auth(http().post('/api/medications')).send({ name: `other-${Date.now()}` }).expect(201)).body.id;
    });

    it('lists only matching unlinked doses in the window, links them with a revision each, and recomputes adherence and nextDueAt', async () => {
      const before = await giveDose(hoursAgo(60)); // before startAt
      const a = await giveDose(hoursAgo(47));
      const b = await giveDose(hoursAgo(35));
      const c = await giveDose(hoursAgo(23));
      await giveDose(hoursAgo(22), { medicationEmbodimentId: otherEmbodimentId }); // other embodiment
      await giveDose(hoursAgo(21), { medicationId: otherMedId, medicationEmbodimentId: undefined }); // other medicine
      const sched = await makeSchedule();
      expect(sched.adherence).toMatchObject({ loggedCount: 0, expectedCount: 5, missed: 5, overdue: true });

      const listed = await auth(http().get(`/api/schedules/${sched.id}/doses`)).expect(200);
      expect(listed.body.linked).toEqual([]);
      expect(listed.body.candidates.map((d: any) => d.interventionId)).toEqual([c, b, a]);
      expect(listed.body.candidates.map((d: any) => d.interventionId)).not.toContain(before);

      const res = await auth(http().post(`/api/schedules/${sched.id}/doses`)).send({ link: [a, b, c] }).expect(201);
      expect(res.body.candidates).toEqual([]);
      expect(res.body.linked.map((d: any) => [d.interventionId, d.linkedLater, d.doseSource])).toEqual([
        [c, true, 'override'],
        [b, true, 'override'],
        [a, true, 'override'],
      ]);
      expect(res.body.schedule.adherence).toMatchObject({ loggedCount: 3, missed: 2 });
      // Next due follows the latest linked dose (23h ago) by one interval: 11h ago.
      const latest = Math.floor(new Date(hoursAgo(23)).getTime() / 1000);
      expect(Math.abs(res.body.schedule.nextDueAt - (latest + 12 * 3600))).toBeLessThanOrEqual(1);

      const dose = await auth(http().get(`/api/interventions/${a}`)).expect(200);
      expect(dose.body.scheduleId).toBe(sched.id);
      expect(dose.body.metadata.doseSource).toBe('override');
      const revs = await auth(http().get(`/api/interventions/${a}/revisions`)).expect(200);
      expect(revs.body).toHaveLength(1);
      expect(revs.body[0].snapshot.scheduleId).toBeNull();

      // Linked to this schedule now, so not a candidate for another one.
      const other = await makeSchedule({ label: 'second plan' });
      const otherList = await auth(http().get(`/api/schedules/${other.id}/doses`)).expect(200);
      expect(otherList.body.candidates.map((d: any) => d.interventionId)).not.toContain(a);
      await auth(http().post(`/api/schedules/${other.id}/doses`)).send({ link: [a] }).expect(400, /DOSE_NOT_LINKABLE/);

      // Unlink one: back to a candidate, its schedule link and flag gone, another revision.
      const un = await auth(http().post(`/api/schedules/${sched.id}/doses`)).send({ unlink: [c] }).expect(201);
      expect(un.body.linked.map((d: any) => d.interventionId)).toEqual([b, a]);
      expect(un.body.candidates.map((d: any) => d.interventionId)).toContain(c);
      expect(un.body.schedule.adherence.loggedCount).toBe(2);
      const cDose = await auth(http().get(`/api/interventions/${c}`)).expect(200);
      expect(cDose.body.scheduleId).toBeNull();
      expect(cDose.body.metadata.scheduleLinked).toBeUndefined();
    });

    it('refuses to unlink a dose logged from the schedule itself', async () => {
      const sched = await makeSchedule({ startAt: hoursAgo(2) });
      const logged = await auth(http().post(`/api/schedules/${sched.id}/log`)).send({}).expect(201);
      const res = await auth(http().post(`/api/schedules/${sched.id}/doses`))
        .send({ unlink: [logged.body.intervention.id] })
        .expect(400);
      expect(res.body.message).toBe('DOSE_NOT_UNLINKABLE');
      const list = await auth(http().get(`/api/schedules/${sched.id}/doses`)).expect(200);
      expect(list.body.linked).toHaveLength(1);
      expect(list.body.linked[0].linkedLater).toBe(false);
    });

    it('completes the schedule when linking reaches endAfterOccurrences', async () => {
      const d1 = await giveDose(hoursAgo(30));
      const d2 = await giveDose(hoursAgo(18));
      const sched = await makeSchedule({ startAt: hoursAgo(31), endAfterOccurrences: 2 });
      const res = await auth(http().post(`/api/schedules/${sched.id}/doses`)).send({ link: [d1, d2] }).expect(201);
      expect(res.body.schedule.status).toBe('completed');
      expect(res.body.schedule.nextDueAt).toBeNull();
      expect(res.body.schedule.adherence.remainingOccurrences).toBe(0);
    });

    it('writes nothing when any dose in the request is not linkable', async () => {
      const good = await giveDose(hoursAgo(5));
      const wrongMed = await giveDose(hoursAgo(4), { medicationId: otherMedId, medicationEmbodimentId: undefined });
      const sched = await makeSchedule({ startAt: hoursAgo(6) });
      const res = await auth(http().post(`/api/schedules/${sched.id}/doses`)).send({ link: [good, wrongMed] }).expect(400);
      expect(res.body).toMatchObject({ message: 'DOSE_NOT_LINKABLE', interventionIds: [wrongMed] });
      const dose = await auth(http().get(`/api/interventions/${good}`)).expect(200);
      expect(dose.body.scheduleId).toBeNull();
    });

    it('rejects an empty or self-contradicting request', async () => {
      const sched = await makeSchedule();
      const d = await giveDose(hoursAgo(1));
      await auth(http().post(`/api/schedules/${sched.id}/doses`)).send({}).expect(400, /SCHEDULE_DOSES_INVALID/);
      await auth(http().post(`/api/schedules/${sched.id}/doses`)).send({ link: [d], unlink: [d] }).expect(400, /SCHEDULE_DOSES_INVALID/);
      await auth(http().post(`/api/schedules/${sched.id}/doses`)).send({ link: ['not-a-uuid'] }).expect(400);
    });

    it("treats another patient's dose as not found, and a non-member gets 404 on the schedule", async () => {
      const sched = await makeSchedule();
      const outsider = await registerAndLogin(app);
      const theirPatient = (
        await request(app.getHttpServer())
          .post('/api/patients')
          .set('Authorization', `Bearer ${outsider.token}`)
          .send({ fullName: 'Other kid', dateOfBirth: '2018-01-01', sexAtBirth: 'male', myRole: 'parent' })
          .expect(201)
      ).body.id;
      const theirMed = (
        await request(app.getHttpServer()).post('/api/medications').set('Authorization', `Bearer ${outsider.token}`).send({ name: `theirs-${Date.now()}` }).expect(201)
      ).body.id;
      const theirDose = (
        await request(app.getHttpServer())
          .post(`/api/patients/${theirPatient}/interventions`)
          .set('Authorization', `Bearer ${outsider.token}`)
          .send({ type: 'medication_dose', performedAt: hoursAgo(1), medicationId: theirMed, doseSource: 'override' })
          .expect(201)
      ).body.id;
      const res = await auth(http().post(`/api/schedules/${sched.id}/doses`)).send({ link: [theirDose] }).expect(404);
      expect(res.body.message).toBe('INTERVENTION_NOT_FOUND');
      await request(app.getHttpServer()).get(`/api/schedules/${sched.id}/doses`).set('Authorization', `Bearer ${outsider.token}`).expect(404);
      await request(app.getHttpServer())
        .post(`/api/schedules/${sched.id}/doses`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({ link: [theirDose] })
        .expect(404);
    });

    it('still refuses the schedule link as a dose correction', async () => {
      const d = await giveDose(hoursAgo(1));
      const sched = await makeSchedule();
      await auth(http().patch(`/api/interventions/${d}`)).send({ interventionScheduleId: sched.id }).expect(400, /FIELD_NOT_CORRECTABLE/);
      await auth(http().patch(`/api/interventions/${d}`)).send({ metadata: { scheduleLinked: true } }).expect(400, /RESERVED_METADATA_KEY/);
    });
  });
});
