import { INestApplication } from '@nestjs/common';
import path from 'path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { createTestApp } from '../../testing/create-test-app';

async function registerAndLogin(app: INestApplication) {
  const email = `ep-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = 'password123';
  const displayName = 'Episode User';

  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password, displayName });
  return { token: reg.body.token, email, userId: reg.body.user.id, displayName };
}

async function createPatient(app: INestApplication, token: string) {
  const res = await request(app.getHttpServer())
    .post('/api/patients')
    .set('Authorization', `Bearer ${token}`)
    .send({
      fullName: 'Episode Patient',
      dateOfBirth: '2019-01-01',
      sexAtBirth: 'female',
      myRole: 'parent',
    })
    .expect(201);
  return res.body.id;
}

describe('Episodes (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ app, close } = await createTestApp('episodes'));
  });

  afterAll(async () => {
    await close();
  });

  it('returns episode details with linked observation ids', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    const obsRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        text: 'Fever started',
        startEpisodeName: 'Fever Jan 2025',
        entries: [{ type: 'temperature', metadata: { value: 38.5, unit: 'C', method: 'oral' } }],
      })
      .expect(201);
    const episodeId = obsRes.body.episodeIds[0];
    expect(episodeId).toBeDefined();

    const getRes = await request(app.getHttpServer())
      .get(`/api/episodes/${episodeId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(getRes.body.id).toBe(episodeId);
    expect(getRes.body.patientId).toBe(patientId);
    expect(getRes.body.name).toBe('Fever Jan 2025');
    expect(getRes.body.status).toBe('active');
    expect(getRes.body.observationIds).toEqual([obsRes.body.id]);
    expect(getRes.body.interventionIds).toEqual([]);
    // Derived timestamps, resolved from the linked start event — the single-episode route returns
    // the same shape the list route does (api.md → Episodes).
    expect(getRes.body.startedAt).toBe(obsRes.body.observedAt);
    expect(getRes.body.endedAt).toBeNull();
  });

  // One child's event filed into another child's episode renders in that child's episode view,
  // timeline and ER Brief (data-model.md -> Data integrity rules). Both patients belong to the
  // same caregiver here, so the failure is genuinely about patient scoping and not about access.
  it('refuses to attach an event to another patient\'s episode', async () => {
    const { token } = await registerAndLogin(app);
    const patientA = await createPatient(app, token);
    const patientB = await createPatient(app, token);

    const obsA = await request(app.getHttpServer())
      .post(`/api/patients/${patientA}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        startEpisodeName: "A's fever",
        entries: [{ type: 'temperature', metadata: { value: 38.5, unit: 'C', method: 'oral' } }],
      })
      .expect(201);
    const episodeOfA = obsA.body.episodeIds[0];

    const rejected = await request(app.getHttpServer())
      .post(`/api/patients/${patientB}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        episodeIds: [episodeOfA],
        entries: [{ type: 'heart_rate', metadata: { bpm: 110 } }],
      })
      .expect(404);
    expect(rejected.body.message).toBe('EPISODE_NOT_FOUND');

    // Same rule on interventions, and on the update path.
    await request(app.getHttpServer())
      .post(`/api/patients/${patientB}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'dressing_change',
        bodyLocation: 'knee',
        episodeIds: [episodeOfA],
      })
      .expect(404);

    const obsB = await request(app.getHttpServer())
      .post(`/api/patients/${patientB}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [{ type: 'heart_rate', metadata: { bpm: 100 } }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/observations/${obsB.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ episodeIds: [episodeOfA] })
      .expect(404);

    // And A's episode is untouched by all of that.
    const episode = await request(app.getHttpServer())
      .get(`/api/episodes/${episodeOfA}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(episode.body.observationIds).toEqual([obsA.body.id]);
  });

  it('rejects a second event resolving an already-resolved episode, but stays idempotent for the same event', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    const first = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        startEpisodeName: 'Resolve once',
        entries: [{ type: 'heart_rate', metadata: { bpm: 100 } }],
      })
      .expect(201);
    const episodeId = first.body.episodeIds[0];

    await request(app.getHttpServer())
      .patch(`/api/observations/${first.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ episodeIds: [episodeId], resolvesEpisodeIds: [episodeId] })
      .expect(200);

    // A *different* event trying to close it would silently overwrite endedAt.
    const second = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        episodeIds: [episodeId],
        resolvesEpisodeIds: [episodeId],
        entries: [{ type: 'heart_rate', metadata: { bpm: 90 } }],
      })
      .expect(400);
    expect(second.body.message).toBe('EPISODE_ALREADY_RESOLVED');

    // The regression guard for the identity-aware carve-out: an update that only touches
    // episodeIds re-sends the event's own existing resolvesEpisodeIds, and must not start failing.
    await request(app.getHttpServer())
      .patch(`/api/observations/${first.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ episodeIds: [episodeId] })
      .expect(200);

    const episode = await request(app.getHttpServer())
      .get(`/api/episodes/${episodeId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(episode.body.endedAtId).toBe(first.body.id);
  });

  it('reflects resolution and includes the resolving intervention id', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    const obsRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        startEpisodeName: 'Ear infection',
        entries: [{ type: 'temperature', metadata: { value: 38.9, unit: 'C', method: 'oral' } }],
      })
      .expect(201);
    const episodeId = obsRes.body.episodeIds[0];

    const intRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'dressing_change',
        bodyLocation: 'Left ear',
        side: 'left',
        dressingType: 'n/a',
        episodeIds: [episodeId],
        resolvesEpisodeIds: [episodeId],
      })
      .expect(201);

    const getRes = await request(app.getHttpServer())
      .get(`/api/episodes/${episodeId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(getRes.body.status).toBe('resolved');
    expect(getRes.body.endedAtType).toBe('intervention');
    expect(getRes.body.endedAtId).toBe(intRes.body.id);
    expect(getRes.body.observationIds).toEqual([obsRes.body.id]);
    expect(getRes.body.interventionIds).toEqual([intRes.body.id]);
    // Once resolved, endedAt resolves from the linked resolving event rather than staying null.
    expect(getRes.body.startedAt).toBe(obsRes.body.observedAt);
    expect(getRes.body.endedAt).toBe(intRes.body.performedAt);
  });

  it('returns 404 for a non-member and 400 for a malformed id', async () => {
    const owner = await registerAndLogin(app);
    const other = await registerAndLogin(app);
    const patientId = await createPatient(app, owner.token);

    const obsRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        observedAt: new Date().toISOString(),
        startEpisodeName: 'Private episode',
        entries: [{ type: 'temperature', metadata: { value: 37.9, unit: 'C', method: 'oral' } }],
      })
      .expect(201);
    const episodeId = obsRes.body.episodeIds[0];

    await request(app.getHttpServer())
      .get(`/api/episodes/${episodeId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);

    await request(app.getHttpServer())
      .get('/api/episodes/not-a-uuid')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(400);
  });

  it('still resolves /episodes/active correctly alongside /episodes/:episodeId', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        startEpisodeName: 'Active check',
        entries: [{ type: 'temperature', metadata: { value: 38.1, unit: 'C', method: 'oral' } }],
      })
      .expect(201);

    const activeRes = await request(app.getHttpServer())
      .get('/api/episodes/active')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(activeRes.body.some((e: any) => e.name === 'Active check')).toBe(true);
    // Regression marker for ISSUES #20: this route's createdAt/updatedAt leaked as ISO strings
    // while getById/listForPatient in this same file normalized theirs. The full wire-contract
    // sweep lives in persistence/timestamps.e2e-spec.ts; this just names the file.
    const active = activeRes.body.find((e: any) => e.name === 'Active check');
    expect(Number.isInteger(active.createdAt)).toBe(true);
    expect(Number.isInteger(active.updatedAt)).toBe(true);
  });
});
