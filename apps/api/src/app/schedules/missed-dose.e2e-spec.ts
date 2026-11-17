import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../testing/create-test-app';

// api.md → Intervention schedules → "Missed doses": the instruction records what the prescriber or
// label said; the app shows it and moves the schedule as it says, and never decides on its own.

const HOUR = 3600;
const nowSec = () => Math.floor(Date.now() / 1000);
const iso = (sec: number) => new Date(sec * 1000).toISOString();
// Read the clock once per moment and derive every expectation from that one reading. Reading it
// again for the expectation lands a second later whenever a second boundary falls in between, which
// is how both of these specs once failed on CI (a course's end a second before its own slot, a
// next due a second off).
const hoursAgo = (h: number) => nowSec() - h * HOUR;

async function registerAndLogin(app: INestApplication) {
  const email = `missed-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer()).post('/api/auth/register').send({ email, password: 'password123', displayName: 'Missed' });
  return { token: reg.body.token as string };
}

describe('Missed-dose instruction (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let token: string;
  let medicationId: string;
  let embodimentId: string;
  const server = () => app.getHttpServer();
  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function patient(weightKg?: number) {
    const pid = (
      await request(server())
        .post('/api/patients')
        .set(auth())
        .send({ fullName: 'Missed Dose Kid', dateOfBirth: '2018-01-01', sexAtBirth: 'female', myRole: 'parent' })
        .expect(201)
    ).body.id as string;
    if (weightKg) {
      await request(server())
        .post(`/api/patients/${pid}/observations`)
        .set(auth())
        .send({ observedAt: iso(nowSec() - 24 * HOUR), entries: [{ type: 'weight', metadata: { kg: weightKg } }] })
        .expect(201);
    }
    return pid;
  }

  // Every 8 h from `start` (epoch seconds), with an optional instruction.
  async function schedule(pid: string, start: number, extra: Record<string, unknown> = {}) {
    return (
      await request(server())
        .post(`/api/patients/${pid}/schedules`)
        .set(auth())
        .send({
          type: 'medication_dose',
          label: 'q8h',
          medicationId,
          medicationEmbodimentId: embodimentId,
          doseMg: 100,
          frequencyHours: 8,
          startAt: iso(start),
          ...extra,
        })
        .expect(201)
    ).body;
  }

  const getSchedule = async (id: string) => (await request(server()).get(`/api/schedules/${id}`).set(auth()).expect(200)).body;

  async function giveDose(pid: string, scheduleId: string, atSec: number) {
    return (
      await request(server())
        .post(`/api/patients/${pid}/interventions`)
        .set(auth())
        .send({
          type: 'medication_dose',
          performedAt: iso(atSec),
          medicationId,
          medicationEmbodimentId: embodimentId,
          amountMg: 100,
          doseSource: 'override',
          interventionScheduleId: scheduleId,
        })
        .expect(201)
    ).body;
  }

  beforeAll(async () => {
    ({ app, close } = await createTestApp('missed-dose'));
    token = (await registerAndLogin(app)).token;
    medicationId = (await request(server()).post('/api/medications').set(auth()).send({ name: `missed-med-${Date.now()}` }).expect(201)).body.id;
    embodimentId = (
      await request(server())
        .post(`/api/medications/${medicationId}/embodiments`)
        .set(auth())
        .send({ label: 'suspension', concentrationMgPerMl: 20, unitType: 'ml' })
        .expect(201)
    ).body.id;
    await request(server())
      .post(`/api/medications/${medicationId}/guidelines`)
      .set(auth())
      .send({ medicationEmbodimentId: embodimentId, source: 'Test source', type: 'weight_based', mgPerKg: 10, maxMgPerDose: 150, maxMgPerDay: 1000, minIntervalHours: 4 })
      .expect(201);
  });

  afterAll(async () => {
    await close();
  });

  it('stores the instruction and refuses one that has nothing to act on', async () => {
    const pid = await patient();
    const s = await schedule(pid, hoursAgo(1), {
      missedDoseAction: 'take_late_keep_times',
      missedDoseCutoffHours: 2,
      missedDoseCourseEffect: 'finish_every_dose',
      missedDoseNote: '  per the label  ',
      endAfterOccurrences: 10,
    });
    expect(s).toMatchObject({
      missedDoseAction: 'take_late_keep_times',
      missedDoseCutoffHours: 2,
      missedDoseCourseEffect: 'finish_every_dose',
      missedDoseNote: 'per the label',
    });
    const base = { type: 'medication_dose', label: 'x', medicationId, frequencyHours: 8, startAt: iso(nowSec()) };
    const post = (body: Record<string, unknown>) => request(server()).post(`/api/patients/${pid}/schedules`).set(auth()).send({ ...base, ...body });
    expect((await post({ missedDoseAction: 'skip', missedDoseCutoffHours: 2 }).expect(400)).body.message).toBe('MISSED_DOSE_INSTRUCTION_INVALID');
    expect((await post({ missedDoseCourseEffect: 'end_on_date' }).expect(400)).body.message).toBe('MISSED_DOSE_INSTRUCTION_INVALID');
    await post({ missedDoseAction: 'whenever' }).expect(400);
    // Checked against the merged result: clearing the end under a course effect is refused too.
    const withEnd = await schedule(pid, hoursAgo(1), { missedDoseCourseEffect: 'end_on_date', endAfterOccurrences: 3 });
    expect((await request(server()).patch(`/api/schedules/${withEnd.id}`).set(auth()).send({ missedDoseCourseEffect: 'end_on_date', endAfterOccurrences: null }).expect(400)).body.message).toBe(
      'MISSED_DOSE_INSTRUCTION_INVALID',
    );
    // Clearing the instruction is allowed.
    const cleared = await request(server()).patch(`/api/schedules/${s.id}`).set(auth()).send({ missedDoseAction: null, missedDoseCutoffHours: null }).expect(200);
    expect(cleared.body.missedDoseAction).toBeNull();
  });

  it('keeps the times on a late dose, where restarting the clock follows the dose', async () => {
    const pid = await patient();
    const start = hoursAgo(9); // slots at -9h and -1h
    const keep = await schedule(pid, start, { missedDoseAction: 'take_late_keep_times' });
    const restart = await schedule(pid, start, { missedDoseAction: 'take_late_restart' });
    const none = await schedule(pid, start);
    for (const s of [keep, restart, none]) await giveDose(pid, s.id, start + 2 * HOUR); // 2 h late

    expect((await getSchedule(keep.id)).nextDueAt).toBe(start + 8 * HOUR); // the planned -1h slot
    expect((await getSchedule(restart.id)).nextDueAt).toBe(start + 10 * HOUR); // dose + 8 h
    // No instruction behaves exactly as before instructions existed: the clock restarts.
    expect((await getSchedule(none.id)).nextDueAt).toBe(start + 10 * HOUR);
    expect((await getSchedule(keep.id)).adherence.overdue).toBe(true);
    expect((await getSchedule(restart.id)).adherence.overdue).toBe(false);
  });

  it('a dose filed from the dose form moves the schedule, and another patient\'s schedule is not found', async () => {
    const pid = await patient();
    const s = await schedule(pid, hoursAgo(1));
    expect((await getSchedule(s.id)).adherence.overdue).toBe(true);
    const doseAt = nowSec() - 60;
    await giveDose(pid, s.id, doseAt);
    const after = await getSchedule(s.id);
    expect(after.adherence).toMatchObject({ loggedCount: 1, overdue: false });
    expect(after.nextDueAt).toBe(doseAt + 8 * HOUR);

    const other = await patient();
    const res = await request(server())
      .post(`/api/patients/${other}/interventions`)
      .set(auth())
      .send({ type: 'medication_dose', performedAt: iso(nowSec()), medicationId, amountMg: 100, doseSource: 'override', interventionScheduleId: s.id })
      .expect(404);
    expect(res.body.message).toBe('SCHEDULE_NOT_FOUND');
  });

  it('records a tapped skip as skipped, not missed, and can undo it', async () => {
    const pid = await patient();
    const start = hoursAgo(9);
    const s = await schedule(pid, start, { missedDoseAction: 'skip' });
    let cur = await getSchedule(s.id);
    expect(cur.missedDose).toMatchObject({ action: 'skip', pastCutoff: false, doubleNextDue: false });
    expect(cur.missedDose.slotAt).toBe(start);

    // Only the current missed slot can be skipped.
    expect((await request(server()).post(`/api/schedules/${s.id}/skips`).set(auth()).send({ slotAt: start + 8 * HOUR }).expect(400)).body.message).toBe(
      'SCHEDULE_SLOT_NOT_SKIPPABLE',
    );
    cur = (await request(server()).post(`/api/schedules/${s.id}/skips`).set(auth()).send({}).expect(201)).body;
    expect(cur.missedDose.slotAt).toBe(start + 8 * HOUR); // the -1h slot is now the missed one
    cur = (await request(server()).post(`/api/schedules/${s.id}/skips`).set(auth()).send({}).expect(201)).body;
    expect(cur.missedDose).toBeNull();
    expect(cur.nextDueAt).toBe(start + 16 * HOUR);
    expect(cur.adherence).toMatchObject({ expectedCount: 2, loggedCount: 0, skippedCount: 2, missed: 0, overdue: false });

    // Nothing missed now: nothing to skip.
    expect((await request(server()).post(`/api/schedules/${s.id}/skips`).set(auth()).send({}).expect(400)).body.message).toBe('SCHEDULE_SLOT_NOT_SKIPPABLE');

    const skips = (await request(server()).get(`/api/schedules/${s.id}/skips`).set(auth()).expect(200)).body;
    expect(skips.map((k: any) => k.reason)).toEqual(['skipped', 'skipped']);
    cur = (await request(server()).delete(`/api/schedules/${s.id}/skips/${skips[0].id}`).set(auth()).expect(200)).body;
    expect(cur.adherence).toMatchObject({ skippedCount: 1, missed: 1, overdue: true });
  });

  it('says when a take-late dose is past its cutoff', async () => {
    const pid = await patient();
    // Slots at -7h and +1h: the next dose is an hour away.
    const start = hoursAgo(7);
    const within = await schedule(pid, start, { missedDoseAction: 'take_late_keep_times', missedDoseCutoffHours: 2 });
    const outside = await schedule(pid, start, { missedDoseAction: 'take_late_keep_times', missedDoseCutoffHours: 0.5 });
    expect((await getSchedule(within.id)).missedDose).toMatchObject({ pastCutoff: true });
    expect((await getSchedule(outside.id)).missedDose).toMatchObject({ pastCutoff: false });
  });

  it('logs the prescribed double: twice the amount, the missed slot made up, and every warning still raised with its reason', async () => {
    const pid = await patient(10);
    const start = hoursAgo(9);
    const plain = await schedule(pid, start);
    expect((await request(server()).post(`/api/schedules/${plain.id}/log`).set(auth()).send({ double: true }).expect(400)).body.message).toBe('DOUBLE_DOSE_NOT_DUE');

    const s = await schedule(pid, start, { missedDoseAction: 'double_next' });
    expect((await getSchedule(s.id)).missedDose).toMatchObject({ doubleNextDue: true });
    const res = (await request(server()).post(`/api/schedules/${s.id}/log`).set(auth()).send({ double: true }).expect(201)).body;
    expect(res.intervention.metadata).toMatchObject({ amountMg: 200, prescribedDouble: true, isAtypical: true });
    expect(res.intervention.metadata.atypicalReason).toContain('exceeds_max_per_dose');
    // The -9h slot made up, the -1h slot covered by this dose: next is the +7h slot.
    expect(res.schedule.adherence).toMatchObject({ loggedCount: 1, skippedCount: 1, missed: 0 });
    expect(res.schedule.nextDueAt).toBe(start + 16 * HOUR);
    const skips = (await request(server()).get(`/api/schedules/${s.id}/skips`).set(auth()).expect(200)).body;
    expect(skips.map((k: any) => k.reason)).toEqual(['made_up_by_double']);
    // A slot made up by a dose goes only with that dose.
    expect((await request(server()).delete(`/api/schedules/${s.id}/skips/${skips[0].id}`).set(auth()).expect(400)).body.message).toBe('SCHEDULE_SKIP_NOT_UNDOABLE');

    const advisories = (await request(server()).get(`/api/patients/${pid}/advisories`).set(auth()).expect(200)).body.filter(
      (a: any) => a.contextId === res.intervention.id && a.type === 'atypical_dose',
    );
    expect(advisories).toHaveLength(1);
    expect(advisories[0].payload).toMatchObject({ prescribedDouble: true });
    expect(advisories[0].payload.reasons).toContain('exceeds_max_per_dose');

    // Not in force any more: nothing is missed.
    expect((await request(server()).post(`/api/schedules/${s.id}/log`).set(auth()).send({ double: true }).expect(400)).body.message).toBe('DOUBLE_DOSE_NOT_DUE');
    // The flag is the service's to write.
    await request(server())
      .post(`/api/patients/${pid}/interventions`)
      .set(auth())
      .send({ type: 'medication_dose', performedAt: iso(nowSec()), medicationId, amountMg: 100, doseSource: 'override', metadata: { prescribedDouble: true } })
      .expect(400);
  });

  it('applies the course effect to skipped doses', async () => {
    const pid = await patient();
    const skipBoth = async (id: string) => {
      await request(server()).post(`/api/schedules/${id}/skips`).set(auth()).send({}).expect(201);
      return (await request(server()).post(`/api/schedules/${id}/skips`).set(auth()).send({}).expect(201)).body;
    };
    const start = hoursAgo(9);
    // A count course of 3 (slots -9h, -1h, +7h) with two skips.
    const finish = await skipBoth((await schedule(pid, start, { missedDoseAction: 'skip', endAfterOccurrences: 3, missedDoseCourseEffect: 'finish_every_dose' })).id);
    expect(finish).toMatchObject({ status: 'active' });
    expect(finish.adherence.remainingOccurrences).toBe(3); // every dose still to give
    const onDate = await skipBoth((await schedule(pid, start, { missedDoseAction: 'skip', endAfterOccurrences: 3, missedDoseCourseEffect: 'end_on_date' })).id);
    expect(onDate.adherence.remainingOccurrences).toBe(1); // ends at its third planned slot

    // A date course ending exactly at the -1h slot. Taken from the same `start`: an end read from the
    // clock separately can fall a second before that slot, and then the course is over after one skip.
    const endAt = iso(start + 8 * HOUR);
    const dateFinish = await skipBoth((await schedule(pid, start, { missedDoseAction: 'skip', endAt, missedDoseCourseEffect: 'finish_every_dose' })).id);
    expect(dateFinish.status).toBe('active'); // runs two slots longer
    expect(dateFinish.nextDueAt).not.toBeNull();
    const dateEnd = await skipBoth((await schedule(pid, start, { missedDoseAction: 'skip', endAt, missedDoseCourseEffect: 'end_on_date' })).id);
    expect(dateEnd.status).toBe('completed');
    expect(dateEnd.nextDueAt).toBeNull();
  });

  it('keeps every route behind the care team', async () => {
    const pid = await patient();
    const s = await schedule(pid, hoursAgo(9), { missedDoseAction: 'skip' });
    const outsider = await registerAndLogin(app);
    const as = { Authorization: `Bearer ${outsider.token}` };
    await request(server()).post(`/api/schedules/${s.id}/skips`).set(as).send({}).expect(404);
    await request(server()).get(`/api/schedules/${s.id}/skips`).set(as).expect(404);
    await request(server()).post(`/api/schedules/${s.id}/log`).set(as).send({ double: true }).expect(404);
  });
});
