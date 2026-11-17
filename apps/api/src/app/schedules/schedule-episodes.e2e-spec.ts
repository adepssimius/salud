import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../testing/create-test-app';

// A schedule's episodes (data-model.md → ScheduleEpisode; api.md → Intervention schedules): any
// number of them, alongside a condition or not, attached and detached with PATCH `episodeIds`.

const HOUR = 3600;

describe('Schedule episodes (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let token: string;
  let pid: string;
  let medicationId: string;

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test, t = token) => r.set('Authorization', `Bearer ${t}`);
  const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR * 1000).toISOString();

  async function register() {
    const email = `sched-ep-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const reg = await http().post('/api/auth/register').send({ email, password: 'password123', displayName: 'Episodes User' });
    return reg.body.token as string;
  }

  const newPatient = async (t = token) =>
    (
      await auth(http().post('/api/patients'), t)
        .send({ fullName: 'Episodes Patient', dateOfBirth: '2016-01-01', sexAtBirth: 'male', myRole: 'parent' })
        .expect(201)
    ).body.id as string;

  /** An episode started by a note `hoursBack` hours ago. */
  const startEpisode = async (name: string, patientId = pid, hoursBack = 30, t = token) =>
    (
      await auth(http().post(`/api/patients/${patientId}/observations`), t)
        .send({ observedAt: hoursAgo(hoursBack), startEpisodeName: name, entries: [{ type: 'note', metadata: { text: name } }] })
        .expect(201)
    ).body.episodeIds[0] as string;

  const resolveEpisode = async (episodeId: string) =>
    auth(http().post(`/api/patients/${pid}/observations`))
      .send({ observedAt: hoursAgo(1), episodeIds: [episodeId], resolvesEpisodeIds: [episodeId], entries: [{ type: 'note', metadata: { text: 'better' } }] })
      .expect(201);

  const makeSchedule = async (over: Record<string, any> = {}) =>
    (
      await auth(http().post(`/api/patients/${pid}/schedules`))
        .send({ type: 'medication_dose', label: 'Ibuprofen q8h', medicationId, doseMg: 200, frequencyHours: 8, startAt: hoursAgo(20), ...over })
        .expect(201)
    ).body;

  const getEpisode = async (id: string) => (await auth(http().get(`/api/episodes/${id}`)).expect(200)).body;
  const patch = (id: string, body: Record<string, unknown>) => auth(http().patch(`/api/schedules/${id}`)).send(body);

  beforeAll(async () => {
    ({ app, close } = await createTestApp('schedule-episodes'));
    token = await register();
    pid = await newPatient();
    medicationId = (await auth(http().post('/api/medications')).send({ name: `sched-ep-med-${Date.now()}` }).expect(201)).body.id;
  });

  afterAll(async () => {
    await close();
  });

  it('treats several episodes at once, alongside a condition, and shows on every one of them', async () => {
    const knee = await startEpisode('Swollen knee');
    const fever = await startEpisode('Fever');
    const conditionId = (await auth(http().post(`/api/patients/${pid}/conditions`)).send({ name: 'Juvenile arthritis' }).expect(201)).body.id;

    const both = [knee, fever].sort(); // a set, sorted by id
    const s = await makeSchedule({ episodeIds: [knee, fever, knee], conditionId });
    expect(s.episodeIds).toEqual(both); // duplicates ignored
    expect(s.conditionId).toBe(conditionId); // no longer mutually exclusive

    for (const ep of [knee, fever]) expect((await getEpisode(ep)).schedules.map((x: any) => x.id)).toContain(s.id);
    const filtered = await auth(http().get(`/api/patients/${pid}/schedules`)).query({ episodeId: fever }).expect(200);
    expect(filtered.body.map((x: any) => x.id)).toEqual([s.id]);
    expect(filtered.body[0].episodeIds).toEqual(both);

    // Home and What's-New carry the same list.
    const dash = await auth(http().get('/api/dashboard')).expect(200);
    expect(dash.body.upcomingSchedules.find((u: any) => u.scheduleId === s.id).episodeIds).toEqual(both);
  });

  it('attaches an existing schedule to an episode, resolved ones included, and detaches it without touching doses', async () => {
    const ringworm = await startEpisode('Ringworm');
    const s = await makeSchedule({ label: 'Clotrimazole q12h', frequencyHours: 12 });
    expect(s.episodeIds).toEqual([]);
    const logged = (await auth(http().post(`/api/schedules/${s.id}/log`)).send({ performedAt: hoursAgo(19) }).expect(201)).body;
    expect(logged.intervention.episodeIds).toEqual([]); // no episode attached yet: joins none

    // Attach, the way the episode page does: the schedule's list with this episode added.
    const attached = (await patch(s.id, { episodeIds: [...s.episodeIds, ringworm] }).expect(200)).body;
    expect(attached.episodeIds).toEqual([ringworm]);
    expect((await getEpisode(ringworm)).schedules.map((x: any) => x.id)).toEqual([s.id]);
    // Attaching moves no dose: the earlier one stays out of the episode, and the plan is unchanged.
    expect((await getEpisode(ringworm)).interventionIds).not.toContain(logged.intervention.id);
    expect(attached.nextDueAt).toBe(logged.schedule.nextDueAt);
    expect(attached.adherence).toEqual(logged.schedule.adherence);

    // A dose logged now joins the attached, active episode.
    const second = (await auth(http().post(`/api/schedules/${s.id}/log`)).send({ performedAt: hoursAgo(7) }).expect(201)).body;
    expect(second.intervention.episodeIds).toEqual([ringworm]);

    // Detach: the link goes, nothing else does.
    const detached = (await patch(s.id, { episodeIds: [] }).expect(200)).body;
    expect(detached.episodeIds).toEqual([]);
    expect(detached.status).toBe('active');
    expect(detached.adherence).toEqual(second.schedule.adherence);
    expect(detached.nextDueAt).toBe(second.schedule.nextDueAt);
    const ep = await getEpisode(ringworm);
    expect(ep.schedules).toEqual([]);
    expect(ep.interventionIds).toContain(second.intervention.id); // the dose stays in the episode
    const doses = (await auth(http().get(`/api/schedules/${s.id}/doses`)).expect(200)).body;
    expect(doses.linked.map((d: any) => d.interventionId).sort()).toEqual([logged.intervention.id, second.intervention.id].sort());

    // A resolved episode can take a schedule after the fact; `null` detaches every episode.
    const old = await startEpisode('Last month', pid, 40);
    await resolveEpisode(old);
    expect((await patch(s.id, { episodeIds: [old] }).expect(200)).body.episodeIds).toEqual([old]);
    expect((await patch(s.id, { episodeIds: null }).expect(200)).body.episodeIds).toEqual([]);
  });

  it('logs a dose into every attached episode that is still active, and leaves a resolved one alone', async () => {
    const knee = await startEpisode('Knee again');
    const fever = await startEpisode('Fever again');
    const done = await startEpisode('Earlier sprain');
    await resolveEpisode(done);
    const s = await makeSchedule({ episodeIds: [knee, done, fever] });
    const res = (await auth(http().post(`/api/schedules/${s.id}/log`)).send({ performedAt: hoursAgo(0.5) }).expect(201)).body;
    expect(res.intervention.episodeIds.sort()).toEqual([knee, fever].sort());
    expect((await getEpisode(done)).interventionIds).not.toContain(res.intervention.id);
  });

  it('replaces the list whole when one is added and another removed', async () => {
    const a = await startEpisode('A');
    const b = await startEpisode('B');
    const c = await startEpisode('C');
    const s = await makeSchedule({ episodeIds: [a, b] });
    expect((await patch(s.id, { episodeIds: [c, b] }).expect(200)).body.episodeIds).toEqual([b, c].sort());
    // Fields not sent leave the list alone.
    expect((await patch(s.id, { notes: 'with food' }).expect(200)).body.episodeIds).toEqual([b, c].sort());
  });

  it("404s another patient's episode or condition, on create and on edit", async () => {
    const sibling = await newPatient();
    const siblingsEpisode = await startEpisode('Sibling cold', sibling);
    const siblingsCondition = (await auth(http().post(`/api/patients/${sibling}/conditions`)).send({ name: 'Asthma' }).expect(201)).body.id;
    const own = await startEpisode('Own cold');

    await auth(http().post(`/api/patients/${pid}/schedules`))
      .send({ type: 'medication_dose', label: 'x', medicationId, frequencyHours: 8, startAt: hoursAgo(1), episodeIds: [own, siblingsEpisode] })
      .expect(404, /EPISODE_NOT_FOUND/);
    await auth(http().post(`/api/patients/${pid}/schedules`))
      .send({ type: 'medication_dose', label: 'x', medicationId, frequencyHours: 8, startAt: hoursAgo(1), conditionId: siblingsCondition })
      .expect(404, /CONDITION_NOT_FOUND/);

    const s = await makeSchedule({ episodeIds: [own] });
    await patch(s.id, { episodeIds: [own, siblingsEpisode] }).expect(404, /EPISODE_NOT_FOUND/);
    await patch(s.id, { episodeIds: ['no-such-episode'] }).expect(404, /EPISODE_NOT_FOUND/);
    await patch(s.id, { conditionId: siblingsCondition }).expect(404, /CONDITION_NOT_FOUND/);
    // Nothing changed, and the sibling's episode never shows it.
    expect((await auth(http().get(`/api/schedules/${s.id}`)).expect(200)).body.episodeIds).toEqual([own]);
    expect((await getEpisode(siblingsEpisode)).schedules).toEqual([]);

    // Someone not on the care team cannot attach either.
    const outsider = await register();
    await auth(http().patch(`/api/schedules/${s.id}`), outsider).send({ episodeIds: [] }).expect(404, /PATIENT_NOT_FOUND/);
  });

  it('goes with the schedule when it is deleted, and with the patient', async () => {
    const ep = await startEpisode('Short course');
    const s = await makeSchedule({ episodeIds: [ep] });
    await auth(http().delete(`/api/schedules/${s.id}`)).expect(200);
    expect((await getEpisode(ep)).schedules).toEqual([]);

    // A patient whose schedule is attached to their episode deletes cleanly (the link references both).
    const other = await newPatient();
    const otherEp = await startEpisode('Other', other);
    await auth(http().post(`/api/patients/${other}/schedules`))
      .send({ type: 'medication_dose', label: 'y', medicationId, frequencyHours: 8, startAt: hoursAgo(1), episodeIds: [otherEp] })
      .expect(201);
    await auth(http().delete(`/api/patients/${other}`)).expect(200);
    await auth(http().get(`/api/episodes/${otherEp}`)).expect(404);
  });
});
