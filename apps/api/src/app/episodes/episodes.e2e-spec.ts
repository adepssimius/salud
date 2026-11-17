import { INestApplication } from '@nestjs/common';
import path from 'path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { createTestApp } from '../../testing/create-test-app';
import { DatabaseService } from '../persistence/database.service';
import { EpisodesService } from './episodes.service';
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { episodes, episodesEventsPivot } from '../../db/schema';

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

  // The correction-side helpers the observation and intervention PATCHes share (data-model.md →
  // "Data integrity rules" → Corrections). Driven directly here, plan-then-apply inside
  // DatabaseService.withTransaction exactly as the PATCHes call them; the HTTP-level coverage
  // lands with those PATCHes.
  describe('event episode correction helpers', () => {
    const HOUR = 3600;
    let token: string;
    let userId: string;
    let patientId: string;
    let episodesService: EpisodesService;
    let dbService: DatabaseService;
    const nowSec = () => Math.floor(Date.now() / 1000);
    const iso = (sec: number) => new Date(sec * 1000).toISOString();

    const observe = async (body: Record<string, unknown>) =>
      (
        await request(app.getHttpServer())
          .post(`/api/patients/${patientId}/observations`)
          .set('Authorization', `Bearer ${token}`)
          .send({ entries: [{ type: 'note', metadata: { text: 'x' } }], ...body })
          .expect(201)
      ).body;
    const episode = async (id: string) =>
      (await request(app.getHttpServer()).get(`/api/episodes/${id}`).set('Authorization', `Bearer ${token}`).expect(200)).body;
    const plan = (eventId: string, rest: Record<string, unknown> = {}) =>
      episodesService.planEventEpisodeCorrection({ patientId, userId, eventType: 'observation', eventId, ...rest });
    const errorOf = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: any) => e?.response?.message ?? e?.message,
      );

    // A frame started by A at t0-3h and resolved by B at t0-2h.
    async function startedAndResolved() {
      const t0 = nowSec();
      const a = await observe({ observedAt: iso(t0 - 3 * HOUR), startEpisodeName: `Frame ${Math.random()}` });
      const episodeId = a.episodeIds[0];
      const b = await observe({ observedAt: iso(t0 - 2 * HOUR), episodeIds: [episodeId], resolvesEpisodeIds: [episodeId] });
      return { t0, a, b, episodeId };
    }

    beforeAll(async () => {
      ({ token, userId } = await registerAndLogin(app));
      patientId = await createPatient(app, token);
      episodesService = app.get(EpisodesService);
      dbService = app.get(DatabaseService);
    });

    it('moves the start to the next-earliest member when the starting event is unlinked', async () => {
      const { a, b, episodeId } = await startedAndResolved();
      // b is then the only member, starting and ending the frame — valid, as on a direct create.
      const p = await plan(a.id, { episodeIds: [] });
      expect(p.anchors).toEqual([{ episodeId, startedAtType: 'observation', startedAtId: b.id }]);
      // Omitted list: the links carry over and the pivot is left alone; the time still re-plans.
      const untouched = await plan(a.id, { clinicalTime: nowSec() - 4 * HOUR });
      expect(untouched.rewritePivot).toBe(false);
      expect(untouched.episodeIds).toEqual([episodeId]);
      expect(untouched.anchors).toEqual([{ episodeId, startedAtType: 'observation', startedAtId: a.id }]);
      // Re-sending the same list rewrites the row unflagged; the anchor write puts the flag back.
      const kept = await plan(a.id, { episodeIds: [episodeId] });
      expect(kept.pivotRows).toEqual([{ episodeId, startsEpisode: false, resolvesEpisode: false }]);
      expect(kept.anchors).toEqual([]);
    });

    it('refuses to unlink the last member of an episode', async () => {
      const lone = await observe({ observedAt: iso(nowSec() - HOUR), startEpisodeName: `Lone ${Math.random()}` });
      expect(await errorOf(plan(lone.id, { episodeIds: [] }))).toBe('EPISODE_LAST_ENTRY');
    });

    it('heals a stored start that is not the earliest member on the next read', async () => {
      const { t0, a, episodeId } = await startedAndResolved();
      const earlier = await observe({ observedAt: iso(t0 - 5 * HOUR) });
      // Reproduce the pre-fix state directly: a member earlier than the start, start left on a.
      const db = dbService.db as any;
      await db.insert(episodesEventsPivot).values({
        id: randomUUID(),
        episodeId,
        eventType: 'observation',
        eventId: earlier.id,
        startsEpisode: false,
        resolvesEpisode: false,
      });
      const stale = await db.select().from(episodes).where(eq(episodes.id, episodeId));
      expect(stale[0].startedAtId).toBe(a.id);

      const ep = await episode(episodeId);
      expect(ep.startedAtId).toBe(earlier.id);
      expect(ep.startedAt).toBe(t0 - 5 * HOUR);
      const row = await db.select().from(episodes).where(eq(episodes.id, episodeId));
      expect(row[0].startedAtId).toBe(earlier.id);
      const flagged = await db
        .select()
        .from(episodesEventsPivot)
        .where(and(eq(episodesEventsPivot.episodeId, episodeId), eq(episodesEventsPivot.startsEpisode, true)));
      expect(flagged.map((f: any) => f.eventId)).toEqual([earlier.id]);
    });

    it('reopens the episode when its resolving event drops the resolve link, keeping the membership', async () => {
      const { b, episodeId } = await startedAndResolved();
      const p = await plan(b.id, { resolvesEpisodeIds: [] });
      expect(p.reopenEpisodeIds).toEqual([episodeId]);
      // Separate-row pivot pattern (CLAUDE.md → Episode model): membership only, no resolve row.
      expect(p.pivotRows).toEqual([{ episodeId, startsEpisode: false, resolvesEpisode: false }]);
      await dbService.withTransaction((tx) => episodesService.applyEventEpisodeCorrection(tx, p));

      const ep = await episode(episodeId);
      expect(ep.status).toBe('active');
      expect(ep.endedAtId).toBeNull();
      expect(ep.endedAt).toBeNull();
      expect(ep.observationIds).toContain(b.id);
      const obs = await request(app.getHttpServer())
        .get(`/api/observations/${b.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(obs.body.episodeIds).toEqual([episodeId]);
      expect(obs.body.resolvesEpisodeIds).toEqual([]);
    });

    it('does not reopen an episode some other event ended', async () => {
      const { t0, episodeId } = await startedAndResolved();
      const member = await observe({ observedAt: iso(t0 - 150 * 60), episodeIds: [episodeId] });
      const p = await plan(member.id, { episodeIds: [] });
      expect(p.reopenEpisodeIds).toEqual([]);
      await dbService.withTransaction((tx) => episodesService.applyEventEpisodeCorrection(tx, p));
      expect((await episode(episodeId)).status).toBe('resolved');
    });

    it('resolves through the plan, and refuses an episode a different event already resolved', async () => {
      const { t0, b, episodeId } = await startedAndResolved();
      const other = await observe({ observedAt: iso(t0 - HOUR), episodeIds: [episodeId] });
      expect(await errorOf(plan(other.id, { resolvesEpisodeIds: [episodeId] }))).toBe('EPISODE_ALREADY_RESOLVED');
      // The resolving event re-asserting its own resolution is a no-op.
      expect((await plan(b.id, { resolvesEpisodeIds: [episodeId] })).resolveEpisodeIds).toEqual([]);

      const open = await observe({ observedAt: iso(t0 - HOUR), startEpisodeName: `Open ${Math.random()}` });
      const openId = open.episodeIds[0];
      const closer = await observe({ observedAt: iso(t0 - 30 * 60), episodeIds: [openId] });
      const p = await plan(closer.id, { resolvesEpisodeIds: [openId] });
      expect(p.resolveEpisodeIds).toEqual([openId]);
      await dbService.withTransaction((tx) => episodesService.applyEventEpisodeCorrection(tx, p));
      const ep = await episode(openId);
      expect(ep.status).toBe('resolved');
      expect(ep.endedAtId).toBe(closer.id);
    });

    it('refuses a clinical time that would end an episode before it starts', async () => {
      const { t0, a, b } = await startedAndResolved();
      // Start moved after the end, or the end moved before the start.
      expect(await errorOf(plan(a.id, { clinicalTime: t0 - HOUR }))).toBe('EPISODE_TIME_ORDER_INVALID');
      expect(await errorOf(plan(b.id, { clinicalTime: t0 - 4 * HOUR }))).toBe('EPISODE_TIME_ORDER_INVALID');
      // Within the frame, and exactly at the other end, are both fine.
      await expect(plan(a.id, { clinicalTime: t0 - 2 * HOUR })).resolves.toBeDefined();
      await expect(plan(b.id, { clinicalTime: t0 - 150 * 60 })).resolves.toBeDefined();
      // Moving the end earlier is fine once the same correction drops the resolve link.
      const reopening = await plan(b.id, { clinicalTime: t0 - 4 * HOUR, resolvesEpisodeIds: [] });
      expect(reopening.reopenEpisodeIds).toHaveLength(1);
    });

    it('writes nothing when the surrounding transaction rolls back', async () => {
      const { b, episodeId } = await startedAndResolved();
      const p = await plan(b.id, { resolvesEpisodeIds: [] });
      await expect(
        dbService.withTransaction(async (tx) => {
          await episodesService.applyEventEpisodeCorrection(tx, p);
          throw new Error('caller failed later in the same correction');
        }),
      ).rejects.toThrow('caller failed later');
      const ep = await episode(episodeId);
      expect(ep.status).toBe('resolved');
      expect(ep.endedAtId).toBe(b.id);
      const obs = await request(app.getHttpServer())
        .get(`/api/observations/${b.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(obs.body.resolvesEpisodeIds).toEqual([episodeId]);
    });
  });
});
