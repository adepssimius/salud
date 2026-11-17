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
