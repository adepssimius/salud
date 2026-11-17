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

      // Each entry now reports the membership, and the start carries the started flag through the
      // same correction rules the entry PATCH enforces.
      const obs = await http().get(`/api/observations/${later.id}`).set('Authorization', `Bearer ${token}`).expect(200);
      expect(obs.body.episodeIds).toEqual([res.body.id]);
      const unlink = await http()
        .patch(`/api/interventions/${earlier.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ episodeIds: [] })
        .expect(400);
      expect(unlink.body.message).toBe('CANNOT_UNLINK_STARTED_EPISODE');

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
      // Earlier than the start: a member, but the start stays put.
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
      expect(res.body.startedAtId).toBe(start.id);

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

    it('removes entries but never the start, and reopens the episode when its resolving entry is removed', async () => {
      const { token } = await registerAndLogin(app);
      const { patientId, start, episodeId } = await framed(token);

      const unlinkStart = await http()
        .post(`/api/episodes/${episodeId}/events`)
        .set('Authorization', `Bearer ${token}`)
        .send({ remove: [{ type: 'observation', id: start.id }] })
        .expect(400);
      expect(unlinkStart.body.message).toBe('CANNOT_UNLINK_STARTED_EPISODE');

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
