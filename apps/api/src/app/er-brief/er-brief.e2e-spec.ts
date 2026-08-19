import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createTestApp } from '../../testing/create-test-app';
import { DatabaseService } from '../persistence/database.service';
import { erBriefSnapshots } from '../../db/schema';
import { applyAppSecurity } from '../app.security';

async function registerAndLogin(app: INestApplication) {
  const email = `brief-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: 'Brief User' });
  return { token: reg.body.token, userId: reg.body.user.id };
}

describe('ER Brief (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let token: string;
  let patientId: string;
  let medicationId: string;
  let embodimentId: string;
  let conditionId: string;
  let scheduleId: string;
  let episodeId: string;

  beforeAll(async () => {
    ({ app, close } = await createTestApp('erbrief', {
      configureApp: (app) => applyAppSecurity(app as any),
    }));

    const auth = await registerAndLogin(app);
    token = auth.token;

    const patient = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Brief Patient', dateOfBirth: '2018-03-01', sexAtBirth: 'female', myRole: 'parent' })
      .expect(201);
    patientId = patient.body.id;

    await request(app.getHttpServer())
      .patch(`/api/patients/${patientId}/code-status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ codeStatus: 'Full code' })
      .expect(200);

    const med = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'brief-test-med' })
      .expect(201);
    medicationId = med.body.id;
    const emb = await request(app.getHttpServer())
      .post(`/api/medications/${medicationId}/embodiments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'suspension', concentrationMgPerMl: 40, unitType: 'ml' })
      .expect(201);
    embodimentId = emb.body.id;

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/reactions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        description: 'anaphylaxis last time',
        occurredAt: '2025-01-01T00:00:00Z',
        severity: 'danger',
        scopeType: 'medication',
        medicationId,
      })
      .expect(201);

    const cond = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/conditions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'ALL treatment', diagnosisText: 'ALL', baselines: ['resting HR runs 110'] })
      .expect(201);
    conditionId = cond.body.id;

    await request(app.getHttpServer())
      .post(`/api/conditions/${conditionId}/protocols`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Fever with port',
        triggerMetric: 'temperature',
        triggerOperator: 'gte',
        triggerValue: 38,
        instructionText: 'ER immediately, do not give antipyretics first',
        sourceText: 'Dr. Okafor, 2026-03-01',
      })
      .expect(201);

    // A prior, older episode under the same condition (F-7.8).
    const priorObs = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: '2025-01-01T00:00:00Z',
        startEpisodeName: 'Neutropenic fever #2',
        startEpisodeConditionId: conditionId,
        entries: [{ type: 'temperature', metadata: { value: 37, unit: 'C', method: 'oral' } }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/observations/${priorObs.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ resolvesEpisodeIds: priorObs.body.episodeIds })
      .expect(200);

    // Weight on file so the dose's own weightKgUsed can drive mg/kg math.
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [{ type: 'weight', metadata: { kg: 20 } }],
      })
      .expect(201);

    const sched = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/schedules`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'medication_dose',
        label: 'Amoxicillin q8h',
        medicationId,
        medicationEmbodimentId: embodimentId,
        doseMg: 200,
        frequencyHours: 8,
        startAt: new Date().toISOString(),
      })
      .expect(201);
    scheduleId = sched.body.id;
    await request(app.getHttpServer())
      .post(`/api/schedules/${scheduleId}/log`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    // The current episode, tripping the Fever-with-port protocol (101F ≈ 38.3C).
    const obs = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        startEpisodeName: 'Neutropenic fever #3',
        startEpisodeConditionId: conditionId,
        entries: [{ type: 'temperature', metadata: { value: 101, unit: 'F', method: 'oral' } }],
      })
      .expect(201);
    episodeId = obs.body.episodeIds[0];

    // A same-episode, off-guideline dose to populate atypicalAdvisories.
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'medication_dose',
        episodeIds: [episodeId],
        medicationId,
        doseSource: 'override',
        amountMg: 999,
      })
      .expect(201);
  }, 30000);

  afterAll(async () => {
    await close();
  });

  it('builds a complete header', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/er-brief`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.header.patient.fullName).toBe('Brief Patient');
    expect(res.body.header.patient.ageYears).toBeGreaterThanOrEqual(0);
    expect(res.body.header.latestWeight.kg).toBe(20);
    expect(res.body.header.codeStatus.value).toBe('Full code');
    expect(res.body.header.codeStatus.setByName).toBe('Brief User');
    expect(res.body.header.dangerReactions.length).toBe(1);
    expect(res.body.header.dangerReactions[0].description).toBe('anaphylaxis last time');
    expect(res.body.header.activeConditions.some((c: any) => c.id === conditionId)).toBe(true);
    expect(res.body.header.protocolFiredReason.protocolName).toBe('Fever with port');
    expect(res.body.header.protocolFiredReason.instructionText).toBe(
      'ER immediately, do not give antipyretics first',
    );
    // All three care-document keys are always present. Null here is "not recorded" — the header
    // must be able to say that, rather than omitting the field and looking like "none".
    expect(res.body.header.careDocuments).toEqual({
      livingWill: null,
      advanceDirective: null,
      medicalPoa: null,
    });
  });

  it('computes mg/kg on the active schedule from the dose\'s own recorded weight, not the current patient weight', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/er-brief`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const sched = res.body.body.activeSchedules.find((s: any) => s.scheduleId === scheduleId);
    expect(sched).toBeDefined();
    expect(sched.medicationName).toBe('brief-test-med');
    expect(sched.lastDoseMg).toBe(200);
    expect(sched.lastDoseMgPerKg).toBe(10); // 200mg / 20kg
    // No MedicationGuideline exists for this test medication, so the dosing engine has no
    // interval to compute nextAllowedAt from — null is the correct value here, not a bug.
    expect(sched.nextAllowedAt).toBeNull();
  });

  it('includes the prior episode under the same condition, and the atypical dose in the current episode', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/er-brief?episodeId=${episodeId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.body.episode.id).toBe(episodeId);
    expect(res.body.body.priorEpisodes.length).toBe(1);
    expect(res.body.body.priorEpisodes[0].name).toBe('Neutropenic fever #2');
    expect(res.body.body.priorEpisodes[0].status).toBe('resolved');
    expect(res.body.body.atypicalAdvisories.length).toBe(1);
    expect(res.body.body.atypicalAdvisories[0].payload.reasons).toContain('override');
    expect(
      res.body.body.events.some((e: any) => e.kind === 'advisory' && e.type === 'protocol_fired'),
    ).toBe(true);
  });

  it('rejects an unknown episodeId with 404 EPISODE_NOT_FOUND', async () => {
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/er-brief?episodeId=11111111-1111-4111-8111-111111111111`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('enforces patient access control (404, not 403)', async () => {
    const other = await registerAndLogin(app);
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/er-brief`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/er-brief/snapshots`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({})
      .expect(404);
  });

  it('rejects expiresInHours beyond the 168h cap', async () => {
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/er-brief/snapshots`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expiresInHours: 200 })
      .expect(400);
  });

  describe('frozen snapshots', () => {
    it('round-trips through the unauthenticated shared route with no Authorization header, frozen at creation', async () => {
      const create = await request(app.getHttpServer())
        .post(`/api/patients/${patientId}/er-brief/snapshots`)
        .set('Authorization', `Bearer ${token}`)
        .send({ episodeId })
        .expect(201);
      expect(create.body.token).toBeTruthy();
      expect(create.body.url).toContain(create.body.token);
      expect(create.body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

      const shared = await request(app.getHttpServer())
        .get(`/api/er-brief/shared/${create.body.token}`)
        .expect(200);
      expect(shared.body.payload.header.patient.fullName).toBe('Brief Patient');
      expect(shared.body.payload.body.episode.id).toBe(episodeId);
      expect(shared.body.frozenAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));

      // A non-member can read the shared link (it's a capability, not an account) but there is
      // no snapshot-creation path available to them at all without patient access — already
      // covered by the access-control test above.
      const other = await registerAndLogin(app);
      const sharedAsOther = await request(app.getHttpServer())
        .get(`/api/er-brief/shared/${create.body.token}`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(200);
      expect(sharedAsOther.body.payload.header.patient.fullName).toBe('Brief Patient');
    });

    it('404s identically for a missing token and an expired one', async () => {
      const missing = await request(app.getHttpServer())
        .get('/api/er-brief/shared/does-not-exist')
        .expect(404);
      expect(missing.body.message).toBe('SNAPSHOT_NOT_FOUND');

      const create = await request(app.getHttpServer())
        .post(`/api/patients/${patientId}/er-brief/snapshots`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);

      const dbService = app.get(DatabaseService);
      const db = (dbService as any).db;
      await db
        .update(erBriefSnapshots)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(erBriefSnapshots.token, create.body.token));

      const expired = await request(app.getHttpServer())
        .get(`/api/er-brief/shared/${create.body.token}`)
        .expect(404);
      expect(expired.body.message).toBe('SNAPSHOT_NOT_FOUND');
    });

    // The share URL is a bearer capability to a whole medical brief -- name, DOB, weight, code
    // status, conditions, medications, allergies -- that gets copied, pasted and texted. It must
    // never go out as plaintext http://, and its host must not be something the requester chose.
    it('builds the share url from X-Forwarded-Proto and ignores a client Origin header', async () => {
      const create = await request(app.getHttpServer())
        .post(`/api/patients/${patientId}/er-brief/snapshots`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-Proto', 'https')
        .set('Origin', 'https://evil.example')
        .send({})
        .expect(201);

      expect(create.body.url.startsWith('https://')).toBe(true);
      expect(create.body.url).not.toContain('evil.example');
      expect(create.body.url).toContain(create.body.token);
    });

    it('returns the snapshot id, so the link can be revoked without re-listing', async () => {
      const create = await request(app.getHttpServer())
        .post(`/api/patients/${patientId}/er-brief/snapshots`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);
      expect(create.body.id).toEqual(expect.any(String));

      await request(app.getHttpServer())
        .delete(`/api/er-brief/snapshots/${create.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/er-brief/shared/${create.body.token}`)
        .expect(404);
    });

    it('lists snapshots without the token, newest first, and drops revoked ones', async () => {
      const first = await request(app.getHttpServer())
        .post(`/api/patients/${patientId}/er-brief/snapshots`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);
      const second = await request(app.getHttpServer())
        .post(`/api/patients/${patientId}/er-brief/snapshots`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);

      const list = await request(app.getHttpServer())
        .get(`/api/patients/${patientId}/er-brief/snapshots`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(list.body[0].token).toBeUndefined();
      expect(list.body[0].expiresAt).toBeDefined();
      const ids = list.body.map((s: any) => s.id);

      const dbService = app.get(DatabaseService);
      const db = (dbService as any).db;
      const firstRow = await db.select().from(erBriefSnapshots).where(eq(erBriefSnapshots.token, first.body.token));
      const secondRow = await db.select().from(erBriefSnapshots).where(eq(erBriefSnapshots.token, second.body.token));
      expect(ids).toEqual(expect.arrayContaining([firstRow[0].id, secondRow[0].id]));

      await request(app.getHttpServer())
        .delete(`/api/er-brief/snapshots/${secondRow[0].id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const listAfter = await request(app.getHttpServer())
        .get(`/api/patients/${patientId}/er-brief/snapshots`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(listAfter.body.map((s: any) => s.id)).not.toContain(secondRow[0].id);
      expect(listAfter.body.map((s: any) => s.id)).toContain(firstRow[0].id);
    });

    it('revokes a snapshot by deleting it, after which the shared link 404s', async () => {
      const create = await request(app.getHttpServer())
        .post(`/api/patients/${patientId}/er-brief/snapshots`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);

      const dbService = app.get(DatabaseService);
      const db = (dbService as any).db;
      const rows = await db
        .select()
        .from(erBriefSnapshots)
        .where(eq(erBriefSnapshots.token, create.body.token));
      const snapshotId = rows[0].id;

      await request(app.getHttpServer())
        .delete(`/api/er-brief/snapshots/${snapshotId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/er-brief/shared/${create.body.token}`)
        .expect(404);
    });
  });
  // The founding use case: an ER visit at 3 AM is precisely the moment nobody paused to open an
  // episode. Scoping the whole body to one meant the brief produced a header and an empty page.
  describe('with no episode ever opened', () => {
    let soloPatientId: string;

    beforeAll(async () => {
      const patient = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'No Episode Kid', dateOfBirth: '2019-05-05', sexAtBirth: 'male', myRole: 'parent' })
        .expect(201);
      soloPatientId = patient.body.id;

      // Inside the window, and one deliberately outside it.
      await request(app.getHttpServer())
        .post(`/api/patients/${soloPatientId}/observations`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          observedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
          entries: [{ type: 'temperature', metadata: { value: 38.6, unit: 'C', method: 'oral' } }],
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/patients/${soloPatientId}/observations`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          observedAt: new Date(Date.now() - 100 * 3600_000).toISOString(),
          entries: [{ type: 'heart_rate', metadata: { bpm: 95 } }],
        })
        .expect(201);
    });

    it('falls back to a 72-hour window and says so via eventScope', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/patients/${soloPatientId}/er-brief`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.body.episode).toBeNull();
      expect(res.body.body.eventScope.type).toBe('recent');
      expect(res.body.body.eventScope.windowHours).toBe(72);

      const { since, generatedAt } = res.body.body.eventScope;
      expect(generatedAt - since).toBe(72 * 3600);

      // Populated, not empty -- and the 100-hour-old event is outside the window.
      expect(res.body.body.events.length).toBe(1);
      expect(res.body.body.events.every((e: any) => e.timestamp >= since)).toBe(true);
    });

    it('freezes the absolute window into a snapshot, so a link read later still tells the truth', async () => {
      const create = await request(app.getHttpServer())
        .post(`/api/patients/${soloPatientId}/er-brief/snapshots`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);

      const shared = await request(app.getHttpServer())
        .get(`/api/er-brief/shared/${create.body.token}`)
        .expect(200);

      const scope = shared.body.payload.body.eventScope;
      expect(scope.type).toBe('recent');
      expect(scope.since).toEqual(expect.any(Number));
      expect(scope.generatedAt).toEqual(expect.any(Number));
    });
  });

  // The shared link is the copy a clinician actually opens, and it has no account to authenticate
  // with — so a care document referenced in a frozen brief must be readable through the token, and
  // nothing else may be (security.md → "ER Brief snapshot tokens").
  describe('care documents on a frozen snapshot', () => {
    let docPatientId: string;
    let docFileId: string;
    let otherFileId: string;
    let snapshotToken: string;

    beforeAll(async () => {
      const patient = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'Directive Patient', dateOfBirth: '2015-03-03', sexAtBirth: 'female', myRole: 'parent' })
        .expect(201);
      docPatientId = patient.body.id;

      const upload = await request(app.getHttpServer())
        .post('/api/files')
        .set('Authorization', `Bearer ${token}`)
        .field('patientId', docPatientId)
        .attach('file', Buffer.from('%PDF-1.4 advance directive'), {
          filename: 'advance-directive.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);
      docFileId = upload.body.fileId;

      // A second file on the same patient that is NOT referenced by any care document — the token
      // must not reach it just because it belongs to the same patient.
      const other = await request(app.getHttpServer())
        .post('/api/files')
        .set('Authorization', `Bearer ${token}`)
        .field('patientId', docPatientId)
        .attach('file', Buffer.from('unrelated'), { filename: 'x-ray.png', contentType: 'image/png' })
        .expect(201);
      otherFileId = other.body.fileId;

      await request(app.getHttpServer())
        .put(`/api/patients/${docPatientId}/care-documents/advance_directive`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'on_file', fileId: docFileId })
        .expect(200);

      const snapshot = await request(app.getHttpServer())
        .post(`/api/patients/${docPatientId}/er-brief/snapshots`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);
      snapshotToken = snapshot.body.token;
    });

    it('freezes the care documents into the payload', async () => {
      const shared = await request(app.getHttpServer())
        .get(`/api/er-brief/shared/${snapshotToken}`)
        .expect(200);

      expect(shared.body.payload.header.careDocuments.advanceDirective).toMatchObject({
        status: 'on_file',
        fileId: docFileId,
        originalName: 'advance-directive.pdf',
      });
      expect(shared.body.payload.header.careDocuments.livingWill).toBeNull();
    });

    it('streams a frozen care-document file with no Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/er-brief/shared/${snapshotToken}/files/${docFileId}`)
        .expect(200);

      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.body.toString()).toContain('advance directive');
    });

    // One code for every failure: a valid token gives no signal to probe other files with.
    it('404s SNAPSHOT_NOT_FOUND for a file that was not frozen into this snapshot', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/er-brief/shared/${snapshotToken}/files/${otherFileId}`)
        .expect(404);
      expect(res.body.message).toBe('SNAPSHOT_NOT_FOUND');
    });

    it('404s SNAPSHOT_NOT_FOUND for an unknown token, indistinguishably', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/er-brief/shared/not-a-real-token/files/${docFileId}`)
        .expect(404);
      expect(res.body.message).toBe('SNAPSHOT_NOT_FOUND');
    });

    // Immutability is what makes freezing ids equivalent to freezing bytes: superseding the
    // directive is a new file id, and the old link keeps serving what was on file at handoff.
    it('keeps serving the frozen document after the directive is superseded', async () => {
      const replacement = await request(app.getHttpServer())
        .post('/api/files')
        .set('Authorization', `Bearer ${token}`)
        .field('patientId', docPatientId)
        .attach('file', Buffer.from('%PDF-1.4 revised directive'), {
          filename: 'advance-directive-v2.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);

      await request(app.getHttpServer())
        .put(`/api/patients/${docPatientId}/care-documents/advance_directive`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'on_file', fileId: replacement.body.fileId })
        .expect(200);

      const stillFrozen = await request(app.getHttpServer())
        .get(`/api/er-brief/shared/${snapshotToken}/files/${docFileId}`)
        .expect(200);
      expect(stillFrozen.body.toString()).toContain('advance directive');

      // ...and the replacement is not reachable through the old token.
      await request(app.getHttpServer())
        .get(`/api/er-brief/shared/${snapshotToken}/files/${replacement.body.fileId}`)
        .expect(404);
    });
  });

  it('reports eventScope as episode-shaped when an episode is open', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/er-brief`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.body.eventScope.type).toBe('episode');
    expect(res.body.body.eventScope.episodeId).toBe(res.body.body.episode.id);
  });
});
