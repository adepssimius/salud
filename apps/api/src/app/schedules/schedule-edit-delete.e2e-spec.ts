import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../testing/create-test-app';

// Editing and deleting a schedule (api.md → Intervention schedules → "Editing a schedule" and
// "Deleting a schedule").

const HOUR = 3600;

describe('Schedule edit and delete (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let token: string;
  let pid: string;
  let medicationId: string;
  let otherMedId: string;

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test, t = token) => r.set('Authorization', `Bearer ${t}`);
  const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR * 1000).toISOString();

  async function register() {
    const email = `sched-ed-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const reg = await http().post('/api/auth/register').send({ email, password: 'password123', displayName: 'Edit User' });
    return reg.body.token as string;
  }

  const makeSchedule = async (over: Record<string, any> = {}) =>
    (
      await auth(http().post(`/api/patients/${pid}/schedules`))
        .send({ type: 'medication_dose', label: 'q12h', medicationId, doseMg: 200, frequencyHours: 12, startAt: hoursAgo(48), ...over })
        .expect(201)
    ).body;

  const giveDose = async (performedAt: string) =>
    (
      await auth(http().post(`/api/patients/${pid}/interventions`))
        .send({ type: 'medication_dose', performedAt, medicationId, amountMg: 200, doseSource: 'override' })
        .expect(201)
    ).body.id as string;

  beforeAll(async () => {
    ({ app, close } = await createTestApp('schedule-edit-delete'));
    token = await register();
    pid = (
      await auth(http().post('/api/patients'))
        .send({ fullName: 'Edit Patient', dateOfBirth: '2015-01-01', sexAtBirth: 'female', myRole: 'parent' })
        .expect(201)
    ).body.id;
    medicationId = (await auth(http().post('/api/medications')).send({ name: `edit-med-${Date.now()}` }).expect(201)).body.id;
    otherMedId = (await auth(http().post('/api/medications')).send({ name: `edit-other-${Date.now()}` }).expect(201)).body.id;
  });

  afterAll(async () => {
    await close();
  });

  describe('PATCH /api/schedules/:id', () => {
    it('rewrites the plan as if it had always been so: adherence and next due recount, linked doses stay', async () => {
      const s = await makeSchedule();
      const logged = await auth(http().post(`/api/schedules/${s.id}/log`)).send({ performedAt: hoursAgo(47) }).expect(201);
      expect(logged.body.schedule.adherence).toMatchObject({ expectedCount: 5, loggedCount: 1 });

      const startAt = hoursAgo(24);
      const res = await auth(http().patch(`/api/schedules/${s.id}`)).send({ startAt, frequencyHours: 6 }).expect(200);
      expect(res.body.startAt).toBe(Math.floor(new Date(startAt).getTime() / 1000));
      expect(res.body.frequencyHours).toBe(6);
      // q6h over the last 24 h: slots at -24, -18, -12, -6, 0 → 5 expected; the dose stays linked.
      expect(res.body.adherence).toMatchObject({ expectedCount: 5, loggedCount: 1, missed: 4 });
      const doses = await auth(http().get(`/api/schedules/${s.id}/doses`)).expect(200);
      expect(doses.body.linked.map((d: any) => d.interventionId)).toEqual([logged.body.intervention.id]);
      // Restart reading: one interval after the last dose.
      expect(res.body.nextDueAt).toBe(Math.floor(new Date(hoursAgo(47)).getTime() / 1000) + 6 * HOUR);
    });

    it('switches between an interval and fixed times, clearing the other', async () => {
      const s = await makeSchedule();
      const daily = await auth(http().patch(`/api/schedules/${s.id}`)).send({ explicitTimes: ['08:00', '20:00'], timeZone: 'America/Chicago' }).expect(200);
      expect(daily.body).toMatchObject({ frequencyHours: null, explicitTimes: ['08:00', '20:00'], timeZone: 'America/Chicago' });
      const back = await auth(http().patch(`/api/schedules/${s.id}`)).send({ frequencyHours: 8 }).expect(200);
      expect(back.body).toMatchObject({ frequencyHours: 8, explicitTimes: null });
      await auth(http().patch(`/api/schedules/${s.id}`)).send({ frequencyHours: null }).expect(400, /FREQUENCY_OR_EXPLICIT_TIMES_REQUIRED/);
    });

    it('clears optional fields with null and keeps required ones', async () => {
      const s = await makeSchedule({ endAfterOccurrences: 10, notes: 'with food', missedDoseAction: 'skip', missedDoseCourseEffect: 'end_on_date' });
      // A course effect needs an end, so clearing the end alone is refused on the merged result...
      await auth(http().patch(`/api/schedules/${s.id}`)).send({ endAfterOccurrences: null }).expect(400, /MISSED_DOSE_INSTRUCTION_INVALID/);
      // ...and allowed with the effect cleared too.
      const res = await auth(http().patch(`/api/schedules/${s.id}`))
        .send({ endAfterOccurrences: null, missedDoseCourseEffect: null, doseMg: null, notes: null, label: null })
        .expect(200);
      expect(res.body).toMatchObject({ endAfterOccurrences: null, missedDoseCourseEffect: null, doseMg: null, notes: null, label: 'q12h' });
      expect(res.body.adherence.remainingOccurrences).toBeNull();
    });

    it('changes the type or medicine only while no dose is linked', async () => {
      const s = await makeSchedule();
      // No doses yet: the medicine can change, and the type too (it needs its own required field).
      await auth(http().patch(`/api/schedules/${s.id}`)).send({ medicationId: otherMedId }).expect(200);
      await auth(http().patch(`/api/schedules/${s.id}`)).send({ type: 'dressing_change' }).expect(400, /BODY_LOCATION_REQUIRED/);
      const dressing = await auth(http().patch(`/api/schedules/${s.id}`)).send({ type: 'dressing_change', bodyLocation: 'left knee' }).expect(200);
      expect(dressing.body).toMatchObject({ type: 'dressing_change', bodyLocation: 'left knee', medicationId: null, doseMg: null });
      await auth(http().patch(`/api/schedules/${s.id}`)).send({ type: 'medication_dose', medicationId }).expect(200);

      const d = await giveDose(hoursAgo(40));
      await auth(http().post(`/api/schedules/${s.id}/doses`)).send({ link: [d] }).expect(201);
      await auth(http().patch(`/api/schedules/${s.id}`)).send({ medicationId: otherMedId }).expect(409, /SCHEDULE_HAS_DOSES/);
      await auth(http().patch(`/api/schedules/${s.id}`)).send({ type: 'dressing_change', bodyLocation: 'x' }).expect(409, /SCHEDULE_HAS_DOSES/);
      // Sending the same medicine back is not a change.
      await auth(http().patch(`/api/schedules/${s.id}`)).send({ medicationId, doseMg: 250 }).expect(200);
    });

    it('404s a caller not on the care team', async () => {
      const s = await makeSchedule();
      const outsider = await register();
      await auth(http().patch(`/api/schedules/${s.id}`), outsider).send({ label: 'mine now' }).expect(404, /PATIENT_NOT_FOUND/);
    });
  });

  describe('DELETE /api/schedules/:id', () => {
    it('deletes the plan and its skips, and keeps every dose — unlinked, with a revision, doseSource untouched', async () => {
      const first = await giveDose(hoursAgo(50));
      const episode = (
        await auth(http().post(`/api/patients/${pid}/episodes`))
          .send({ name: 'Ear infection', events: [{ type: 'intervention', id: first }] })
          .expect(201)
      ).body;
      const s = await makeSchedule({ startAt: hoursAgo(30), missedDoseAction: 'skip', episodeId: episode.id });
      // The 30 h-ago slot is missed: skip it.
      await auth(http().post(`/api/schedules/${s.id}/skips`)).send({}).expect(201);
      const fromSchedule = (await auth(http().post(`/api/schedules/${s.id}/log`)).send({ performedAt: hoursAgo(17) }).expect(201)).body.intervention.id;
      const adHoc = await giveDose(hoursAgo(5));
      await auth(http().post(`/api/schedules/${s.id}/doses`)).send({ link: [adHoc] }).expect(201);

      const res = await auth(http().delete(`/api/schedules/${s.id}`)).expect(200);
      expect(res.body).toEqual({ deleted: true, unlinkedDoseCount: 2, removedSkipCount: 1 });

      await auth(http().get(`/api/schedules/${s.id}`)).expect(404, /SCHEDULE_NOT_FOUND/);
      await auth(http().get(`/api/schedules/${s.id}/skips`)).expect(404);
      const list = await auth(http().get(`/api/patients/${pid}/schedules`)).expect(200);
      expect(list.body.map((x: any) => x.id)).not.toContain(s.id);
      const ep = await auth(http().get(`/api/episodes/${episode.id}`)).expect(200);
      expect((ep.body.schedules ?? []).map((x: any) => x.id)).not.toContain(s.id);

      for (const [id, source, revisionCount] of [
        [fromSchedule, 'schedule', 1],
        [adHoc, 'override', 2], // its link made one revision, the delete another
      ] as const) {
        const dose = await auth(http().get(`/api/interventions/${id}`)).expect(200);
        expect(dose.body.scheduleId).toBeNull();
        expect(dose.body.metadata.interventionScheduleId).toBeNull();
        expect(dose.body.metadata.scheduleLinked).toBeUndefined();
        expect(dose.body.metadata.doseSource).toBe(source);
        const revs = await auth(http().get(`/api/interventions/${id}/revisions`)).expect(200);
        // The delete's revision holds the prior state, which names the schedule the dose was on.
        // Not by position: SQLite's second-resolution timestamps can tie the two revisions.
        expect(revs.body).toHaveLength(revisionCount);
        expect(revs.body.some((r: any) => r.snapshot.scheduleId === s.id)).toBe(true);
      }

      // Gone for good: a second delete is a 404, and the doses can be filed against nothing.
      await auth(http().delete(`/api/schedules/${s.id}`)).expect(404, /SCHEDULE_NOT_FOUND/);
    });

    it('deletes a schedule with no doses', async () => {
      const s = await makeSchedule();
      const res = await auth(http().delete(`/api/schedules/${s.id}`)).expect(200);
      expect(res.body).toEqual({ deleted: true, unlinkedDoseCount: 0, removedSkipCount: 0 });
    });

    it('404s a caller not on the care team, and leaves the schedule', async () => {
      const s = await makeSchedule();
      const outsider = await register();
      await auth(http().delete(`/api/schedules/${s.id}`), outsider).expect(404, /PATIENT_NOT_FOUND/);
      await auth(http().get(`/api/schedules/${s.id}`)).expect(200);
    });
  });
});
