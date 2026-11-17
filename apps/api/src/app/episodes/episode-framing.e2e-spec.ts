import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../testing/create-test-app';

// Episodes drawn from the episode side (api.md → Episodes → POST /patients/:id/episodes and
// POST /episodes/:id/events; data-model.md → "Episodes drawn afterward").

async function registerAndLogin(app: INestApplication) {
  const email = `epf-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: 'Framing User' });
  return { token: reg.body.token as string };
}

async function createPatient(app: INestApplication, token: string, fullName = 'Framing Patient') {
  const res = await request(app.getHttpServer())
    .post('/api/patients')
    .set('Authorization', `Bearer ${token}`)
    .send({ fullName, dateOfBirth: '2019-01-01', sexAtBirth: 'female', myRole: 'parent' })
    .expect(201);
  return res.body.id as string;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000).toISOString();

async function logObservation(app: INestApplication, token: string, patientId: string, at: string, value = 38.4) {
  const res = await request(app.getHttpServer())
    .post(`/api/patients/${patientId}/observations`)
    .set('Authorization', `Bearer ${token}`)
    .send({ observedAt: at, entries: [{ type: 'temperature', metadata: { value, unit: 'C', method: 'oral' } }] })
    .expect(201);
  return res.body as { id: string; observedAt: number };
}

async function logDressing(app: INestApplication, token: string, patientId: string, at: string) {
  const res = await request(app.getHttpServer())
    .post(`/api/patients/${patientId}/interventions`)
    .set('Authorization', `Bearer ${token}`)
    .send({ performedAt: at, type: 'dressing_change', bodyLocation: 'Left knee', side: 'left' })
    .expect(201);
  return res.body as { id: string; performedAt: number };
}

describe('Episode framing (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, close } = await createTestApp('episode-framing'));
  });

  afterAll(async () => {
    await close();
  });

  describe('POST /patients/:patientId/episodes', () => {
    it('frames existing entries, anchoring the start on the earliest one, and records a revision per entry', async () => {
      const { token } = await registerAndLogin(app);
      const patientId = await createPatient(app, token);
      const later = await logObservation(app, token, patientId, hoursAgo(2));
      const earlier = await logDressing(app, token, patientId, hoursAgo(5));

      const res = await http()
        .post(`/api/patients/${patientId}/episodes`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Knee scrape',
          notes: 'Drawn afterward',
          events: [
            { type: 'observation', id: later.id },
            { type: 'intervention', id: earlier.id },
          ],
        })
        .expect(201);

      expect(res.body.name).toBe('Knee scrape');
      expect(res.body.status).toBe('active');
      expect(res.body.startedAtType).toBe('intervention');
      expect(res.body.startedAtId).toBe(earlier.id);
      expect(res.body.startedAt).toBe(earlier.performedAt);
      expect(res.body.endedAt).toBeNull();
      expect(res.body.observationIds).toEqual([later.id]);
      expect(res.body.interventionIds).toEqual([earlier.id]);

      // Each entry now reports the membership, and unlinking the start through the entry PATCH
      // hands the start to the next-earliest member, as Remove on the episode side does.
      const obs = await http().get(`/api/observations/${later.id}`).set('Authorization', `Bearer ${token}`).expect(200);
      expect(obs.body.episodeIds).toEqual([res.body.id]);
      await http()
        .patch(`/api/interventions/${earlier.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ episodeIds: [] })
        .expect(200);
      const moved = await http().get(`/api/episodes/${res.body.id}`).set('Authorization', `Bearer ${token}`).expect(200);
      expect(moved.body.startedAtId).toBe(later.id);
      expect(moved.body.startedAt).toBe(later.observedAt);

      const revs = await http()
        .get(`/api/observations/${later.id}/revisions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(revs.body).toHaveLength(1);
      expect(revs.body[0].snapshot.episodeIds).toEqual([]);

      const list = await http()
        .get(`/api/patients/${patientId}/episodes`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(list.body.map((e: any) => e.id)).toEqual([res.body.id]);
    });

    it('creates an episode already resolved by one of its entries', async () => {
      const { token } = await registerAndLogin(app);
      const patientId = await createPatient(app, token);
      const first = await logObservation(app, token, patientId, hoursAgo(48), 39.1);
      const last = await logObservation(app, token, patientId, hoursAgo(1), 36.9);

      const res = await http()
        .post(`/api/patients/${patientId}/episodes`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Fever Nov 2026',
          events: [
            { type: 'observation', id: first.id },
            { type: 'observation', id: last.id },
          ],
          resolvedBy: { type: 'observation', id: last.id },
        })
        .expect(201);
      expect(res.body.status).toBe('resolved');
      expect(res.body.startedAtId).toBe(first.id);
      expect(res.body.endedAtId).toBe(last.id);
      expect(res.body.endedAt).toBe(last.observedAt);

      const obs = await http().get(`/api/observations/${last.id}`).set('Authorization', `Bearer ${token}`).expect(200);
      expect(obs.body.episodeIds).toEqual([res.body.id]);
      expect(obs.body.resolvesEpisodeIds).toEqual([res.body.id]);

      // A resolved episode is not active, so it does not put the patient into sick mode.
      const active = await http().get('/api/episodes/active').set('Authorization', `Bearer ${token}`).expect(200);
      expect(active.body.map((e: any) => e.id)).not.toContain(res.body.id);
    });

    it('rejects a bad request and writes nothing', async () => {
      const { token } = await registerAndLogin(app);
      const patientId = await createPatient(app, token);
      const otherPatientId = await createPatient(app, token, 'Sibling');
      const mine = await logObservation(app, token, patientId, hoursAgo(3));
      const theirs = await logObservation(app, token, otherPatientId, hoursAgo(3));
      const notIncluded = await logObservation(app, token, patientId, hoursAgo(1));

      const empty = await http()
        .post(`/api/patients/${patientId}/episodes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Nothing', events: [] })
        .expect(400);
      expect(empty.body.message).toBe('EPISODE_EVENTS_REQUIRED');

      const foreign = await http()
        .post(`/api/patients/${patientId}/episodes`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Cross-patient',
          events: [
            { type: 'observation', id: mine.id },
            { type: 'observation', id: theirs.id },
          ],
        })
        .expect(404);
      expect(foreign.body.message).toBe('EPISODE_EVENT_NOT_FOUND');

      const strayResolve = await http()
        .post(`/api/patients/${patientId}/episodes`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Stray',
          events: [{ type: 'observation', id: mine.id }],
          resolvedBy: { type: 'observation', id: notIncluded.id },
        })
        .expect(400);
      expect(strayResolve.body.message).toBe('RESOLVES_MUST_BE_SUBSET_OF_EPISODES');

      const siblingCondition = await http()
        .post(`/api/patients/${otherPatientId}/conditions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Asthma' })
        .expect(201);
      const wrongCondition = await http()
        .post(`/api/patients/${patientId}/episodes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Wrong condition', conditionId: siblingCondition.body.id, events: [{ type: 'observation', id: mine.id }] })
        .expect(404);
      expect(wrongCondition.body.message).toBe('CONDITION_NOT_FOUND');

      const list = await http()
        .get(`/api/patients/${patientId}/episodes`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(list.body).toEqual([]);
      const revs = await http()
        .get(`/api/observations/${mine.id}/revisions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(revs.body).toEqual([]);
    });

    it('nests under a condition of the same patient', async () => {
      const { token } = await registerAndLogin(app);
      const patientId = await createPatient(app, token);
      const obs = await logObservation(app, token, patientId, hoursAgo(3));
      const condition = await http()
        .post(`/api/patients/${patientId}/conditions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Eczema' })
        .expect(201);
      const res = await http()
        .post(`/api/patients/${patientId}/episodes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Flare', conditionId: condition.body.id, events: [{ type: 'observation', id: obs.id }] })
        .expect(201);
      expect(res.body.conditionId).toBe(condition.body.id);
    });

    it('returns 404 to a caller who is not on the care team', async () => {
      const owner = await registerAndLogin(app);
      const stranger = await registerAndLogin(app);
      const patientId = await createPatient(app, owner.token);
      const obs = await logObservation(app, owner.token, patientId, hoursAgo(3));
      const res = await http()
        .post(`/api/patients/${patientId}/episodes`)
        .set('Authorization', `Bearer ${stranger.token}`)
        .send({ name: 'Snoop', events: [{ type: 'observation', id: obs.id }] })
        .expect(404);
      expect(res.body.message).toBe('PATIENT_NOT_FOUND');
    });
  });

  describe('POST /episodes/:episodeId/events', () => {
    async function framed(token: string) {
      const patientId = await createPatient(app, token);
      const start = await logObservation(app, token, patientId, hoursAgo(10), 38.9);
      const ep = await http()
        .post(`/api/patients/${patientId}/episodes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Cold', events: [{ type: 'observation', id: start.id }] })
        .expect(201);
      return { patientId, start, episodeId: ep.body.id as string };
    }

    it('adds entries, treating an existing member as a no-op', async () => {
      const { token } = await registerAndLogin(app);
      const { patientId, start, episodeId } = await framed(token);
      const dose = await logDressing(app, token, patientId, hoursAgo(4));
      // Earlier than the start: a member, and the start moves to it.
      const before = await logObservation(app, token, patientId, hoursAgo(20));

      const res = await http()
        .post(`/api/episodes/${episodeId}/events`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          add: [
            { type: 'intervention', id: dose.id },
            { type: 'observation', id: before.id },
            { type: 'observation', id: start.id },
          ],
        })
        .expect(200);
      expect(res.body.interventionIds).toEqual([dose.id]);
      expect(new Set(res.body.observationIds)).toEqual(new Set([start.id, before.id]));
      expect(res.body.startedAtId).toBe(before.id);
      expect(res.body.startedAt).toBe(before.observedAt);

      // Revisions only for entries whose links changed.
      const startRevs = await http()
        .get(`/api/observations/${start.id}/revisions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(startRevs.body).toHaveLength(1); // the create, not this no-op add
      const doseRevs = await http()
        .get(`/api/interventions/${dose.id}/revisions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(doseRevs.body).toHaveLength(1);
      expect(doseRevs.body[0].snapshot.episodeIds).toEqual([]);

      const intervention = await http()
        .get(`/api/interventions/${dose.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(intervention.body.episodeIds).toEqual([episodeId]);
    });

    it('removes entries but never the last one, and reopens the episode when its resolving entry is removed', async () => {
      const { token } = await registerAndLogin(app);
      const { patientId, start, episodeId } = await framed(token);

      const unlinkLast = await http()
        .post(`/api/episodes/${episodeId}/events`)
        .set('Authorization', `Bearer ${token}`)
        .send({ remove: [{ type: 'observation', id: start.id }] })
        .expect(400);
      expect(unlinkLast.body.message).toBe('EPISODE_LAST_ENTRY');

      // Resolve it the normal way: a logged observation.
      const resolving = await http()
        .post(`/api/patients/${patientId}/observations`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          observedAt: hoursAgo(1),
          episodeIds: [episodeId],
          resolvesEpisodeIds: [episodeId],
          entries: [{ type: 'temperature', metadata: { value: 36.8, unit: 'C', method: 'oral' } }],
        })
        .expect(201);
      const resolved = await http().get(`/api/episodes/${episodeId}`).set('Authorization', `Bearer ${token}`).expect(200);
      expect(resolved.body.status).toBe('resolved');

      const res = await http()
        .post(`/api/episodes/${episodeId}/events`)
        .set('Authorization', `Bearer ${token}`)
        .send({ remove: [{ type: 'observation', id: resolving.body.id }] })
        .expect(200);
      expect(res.body.status).toBe('active');
      expect(res.body.endedAtId).toBeNull();
      expect(res.body.observationIds).toEqual([start.id]);

      const obs = await http()
        .get(`/api/observations/${resolving.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(obs.body.episodeIds).toEqual([]);
      expect(obs.body.resolvesEpisodeIds).toEqual([]);
    });

    it('promotes the next-earliest entry when the start is removed, and plans one move per request', async () => {
      const { token } = await registerAndLogin(app);
      const { patientId, start, episodeId } = await framed(token);
      const next = await logObservation(app, token, patientId, hoursAgo(8));
      const later = await logDressing(app, token, patientId, hoursAgo(6));
      await http()
        .post(`/api/episodes/${episodeId}/events`)
        .set('Authorization', `Bearer ${token}`)
        .send({ add: [{ type: 'observation', id: next.id }, { type: 'intervention', id: later.id }] })
        .expect(200);

      const res = await http()
        .post(`/api/episodes/${episodeId}/events`)
        .set('Authorization', `Bearer ${token}`)
        .send({ remove: [{ type: 'observation', id: start.id }] })
        .expect(200);
      expect(res.body.startedAtType).toBe('observation');
      expect(res.body.startedAtId).toBe(next.id);
      expect(res.body.startedAt).toBe(next.observedAt);

      // Adding an earlier entry and removing the current start in one request: one move.
      const earliest = await logObservation(app, token, patientId, hoursAgo(30));
      const swap = await http()
        .post(`/api/episodes/${episodeId}/events`)
        .set('Authorization', `Bearer ${token}`)
        .send({ add: [{ type: 'observation', id: earliest.id }], remove: [{ type: 'observation', id: next.id }] })
        .expect(200);
      expect(swap.body.startedAtId).toBe(earliest.id);

      // Removing every member at once is refused, and writes nothing.
      const all = await http()
        .post(`/api/episodes/${episodeId}/events`)
        .set('Authorization', `Bearer ${token}`)
        .send({ remove: [{ type: 'observation', id: earliest.id }, { type: 'intervention', id: later.id }] })
        .expect(400);
      expect(all.body.message).toBe('EPISODE_LAST_ENTRY');
      const after = await http().get(`/api/episodes/${episodeId}`).set('Authorization', `Bearer ${token}`).expect(200);
      expect(after.body.startedAtId).toBe(earliest.id);
      expect(after.body.interventionIds).toEqual([later.id]);
    });

    it('breaks a tie on identical times observation-first, with the resolving entry last', async () => {
      const { token } = await registerAndLogin(app);
      const patientId = await createPatient(app, token);
      const at = hoursAgo(5);
      const dressing = await logDressing(app, token, patientId, at);
      const obs = await logObservation(app, token, patientId, at);
      const res = await http()
        .post(`/api/patients/${patientId}/episodes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Tie', events: [{ type: 'intervention', id: dressing.id }, { type: 'observation', id: obs.id }] })
        .expect(201);
      expect(res.body.startedAtId).toBe(obs.id);

      // With the observation resolving it, the tie goes to the other entry: a valid frame rather
      // than one that ends at its own start.
      const resolved = await http()
        .post(`/api/patients/${patientId}/episodes`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Tie resolved',
          events: [{ type: 'intervention', id: dressing.id }, { type: 'observation', id: obs.id }],
          resolvedBy: { type: 'observation', id: obs.id },
        })
        .expect(201);
      expect(resolved.body.startedAtId).toBe(dressing.id);
      expect(resolved.body.endedAtId).toBe(obs.id);
    });

    it('keeps the end on the resolving entry, and refuses a result that ends at its own start', async () => {
      const { token } = await registerAndLogin(app);
      const patientId = await createPatient(app, token);
      const first = await logObservation(app, token, patientId, hoursAgo(10));
      const middle = await logObservation(app, token, patientId, hoursAgo(8));
      const resolving = await logObservation(app, token, patientId, hoursAgo(6));
      const created = await http()
        .post(`/api/patients/${patientId}/episodes`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Resolved',
          events: [first, middle, resolving].map((e) => ({ type: 'observation', id: e.id })),
          resolvedBy: { type: 'observation', id: resolving.id },
        })
        .expect(201);
      const episodeId = created.body.id;

      // A follow-up after the resolving entry joins without moving the end.
      const followUp = await logObservation(app, token, patientId, hoursAgo(2));
      const added = await http()
        .post(`/api/episodes/${episodeId}/events`)
        .set('Authorization', `Bearer ${token}`)
        .send({ add: [{ type: 'observation', id: followUp.id }] })
        .expect(200);
      expect(added.body.status).toBe('resolved');
      expect(added.body.endedAtId).toBe(resolving.id);
      expect(added.body.startedAtId).toBe(first.id);

      // Removing every entry before the resolving one would leave it ending at its own start.
      const inverted = await http()
        .post(`/api/episodes/${episodeId}/events`)
        .set('Authorization', `Bearer ${token}`)
        .send({ remove: [{ type: 'observation', id: first.id }, { type: 'observation', id: middle.id }] })
        .expect(400);
      expect(inverted.body.message).toBe('EPISODE_TIME_ORDER_INVALID');
      // Removing just the start is fine: the middle entry takes it.
      const promoted = await http()
        .post(`/api/episodes/${episodeId}/events`)
        .set('Authorization', `Bearer ${token}`)
        .send({ remove: [{ type: 'observation', id: first.id }] })
        .expect(200);
      expect(promoted.body.startedAtId).toBe(middle.id);
      expect(promoted.body.endedAtId).toBe(resolving.id);

      // Correcting the resolving entry's time before every other member is refused on the entry
      // route too.
      const corrected = await http()
        .patch(`/api/observations/${resolving.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ observedAt: hoursAgo(12) })
        .expect(400);
      expect(corrected.body.message).toBe('EPISODE_TIME_ORDER_INVALID');

      // A direct create whose resolving entry is strictly the earliest is refused as well.
      const bad = await http()
        .post(`/api/patients/${patientId}/episodes`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Backwards',
          events: [first, middle].map((e) => ({ type: 'observation', id: e.id })),
          resolvedBy: { type: 'observation', id: first.id },
        })
        .expect(400);
      expect(bad.body.message).toBe('EPISODE_TIME_ORDER_INVALID');
    });

    it('is atomic, rejects empty bodies and foreign entries, and hides the episode from strangers', async () => {
      const { token } = await registerAndLogin(app);
      const { patientId, episodeId } = await framed(token);
      const otherPatientId = await createPatient(app, token, 'Sibling');
      const ok = await logObservation(app, token, patientId, hoursAgo(2));
      const theirs = await logObservation(app, token, otherPatientId, hoursAgo(2));

      const empty = await http()
        .post(`/api/episodes/${episodeId}/events`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
      expect(empty.body.message).toBe('EPISODE_EVENTS_REQUIRED');

      const foreign = await http()
        .post(`/api/episodes/${episodeId}/events`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          add: [
            { type: 'observation', id: ok.id },
            { type: 'observation', id: theirs.id },
          ],
        })
        .expect(404);
      expect(foreign.body.message).toBe('EPISODE_EVENT_NOT_FOUND');
      const after = await http().get(`/api/episodes/${episodeId}`).set('Authorization', `Bearer ${token}`).expect(200);
      expect(after.body.observationIds).not.toContain(ok.id);

      // Removing a non-member is a no-op.
      await http()
        .post(`/api/episodes/${episodeId}/events`)
        .set('Authorization', `Bearer ${token}`)
        .send({ remove: [{ type: 'observation', id: ok.id }] })
        .expect(200);
      const okRevs = await http()
        .get(`/api/observations/${ok.id}/revisions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(okRevs.body).toEqual([]);

      const stranger = await registerAndLogin(app);
      const hidden = await http()
        .post(`/api/episodes/${episodeId}/events`)
        .set('Authorization', `Bearer ${stranger.token}`)
        .send({ add: [{ type: 'observation', id: ok.id }] })
        .expect(404);
      expect(hidden.body.message).toBe('PATIENT_NOT_FOUND');
    });
  });
});
