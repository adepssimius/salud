import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { createTestApp } from '../../testing/create-test-app';
import { EpisodesService } from '../episodes/episodes.service';
import { randomUUID } from 'crypto';

// Stand-in medication ids. They need to be v4 UUIDs (CreateInterventionDto validates the shape),
// but not rows in the catalog: these suites exercise intervention persistence and filtering, not
// dose resolution. dosing.e2e-spec.ts covers the path where the medication actually exists.
const MED_1 = randomUUID();
const MED_A = randomUUID();
const MED_B = randomUUID();

async function registerAndLogin(app: INestApplication) {
  const email = `int-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const password = 'password123';
  const displayName = 'Intervention User';

  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({
      email,
      password,
      displayName,
    });
  return { token: reg.body.token, email, userId: reg.body.user.id };
}

async function createPatient(app: INestApplication, token: string) {
  const res = await request(app.getHttpServer())
    .post(`/api/patients`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      fullName: `Patient ${Date.now()}`,
      dateOfBirth: '2015-01-01',
      sexAtBirth: 'female',
      myRole: 'parent',
    })
    .expect(201);
  return res.body.id as string;
}

describe('Interventions (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ app, close } = await createTestApp('interventions'));
  });

  afterAll(async () => {
    await close();
  });

  it('creates and fetches a medication dose intervention', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    const createRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'medication_dose',
        medicationId: MED_1,
        doseSource: 'override',
        amountMg: 200,
        notes: 'Dose given',
      })
      .expect(201);

    expect(createRes.body.id).toBeDefined();
    expect(createRes.body.patientId).toBe(patientId);
    expect(createRes.body.type).toBe('medication_dose');
    expect(Array.isArray(createRes.body.resolvesEpisodeIds)).toBe(true);
    expect(createRes.body.metadata.medicationId).toBe(MED_1);
    // Regression marker for ISSUES #20: createdAt/updatedAt leaked as ISO strings here. The full
    // wire-contract sweep lives in persistence/timestamps.e2e-spec.ts; this just names the file.
    expect(Number.isInteger(createRes.body.createdAt)).toBe(true);
    expect(Number.isInteger(createRes.body.updatedAt)).toBe(true);

    const getRes = await request(app.getHttpServer())
      .get(`/api/interventions/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(getRes.body.id).toBe(createRes.body.id);
    expect(getRes.body.metadata.medicationId).toBe(MED_1);
  });

  // A single mistyped year would otherwise pin the dashboard's "last dose" to the future forever,
  // with no way to correct it from the UI -- and "did I already give Tylenol?" is the founding
  // question the app exists to answer.
  it('rejects a performedAt in the future', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    const res = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: '2030-01-01T00:00:00Z',
        type: 'medication_dose',
        medicationId: MED_1,
        doseSource: 'override',
        amountMg: 100,
      })
      .expect(400);
    expect(res.body.message).toContain('DATE_IN_FUTURE');
  });

  // These two codes existed but were wired only into schedule create. A dose with no medicationId
  // doesn't just record nothing -- it skips guideline resolution entirely, so the dosing engine
  // and every advisory silently do nothing.
  it('requires medicationId on a dose and bodyLocation on a dressing change, including on update', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    const noMed = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ performedAt: new Date().toISOString(), type: 'medication_dose', amountMg: 100 })
      .expect(400);
    expect(noMed.body.message).toBe('MEDICATION_ID_REQUIRED');

    const noLocation = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ performedAt: new Date().toISOString(), type: 'dressing_change', side: 'left' })
      .expect(400);
    expect(noLocation.body.message).toBe('BODY_LOCATION_REQUIRED');

    const dressing = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'dressing_change',
        bodyLocation: 'Left knee',
        side: 'left',
      })
      .expect(201);

    // Checked against the merged row, so clearing it on an existing event is caught too.
    const cleared = await request(app.getHttpServer())
      .patch(`/api/interventions/${dressing.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ bodyLocation: '' })
      .expect(400);
    expect(cleared.body.message).toBe('BODY_LOCATION_REQUIRED');
  });

  it('rejects a negative amountMg rather than counting it toward the daily total', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'medication_dose',
        medicationId: MED_1,
        doseSource: 'override',
        amountMg: -100,
      })
      .expect(400);
  });

  it('rejects resolvesEpisodeIds that are not a subset of episodeIds', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'medication_dose',
        resolvesEpisodeIds: ['ep-1'],
        medicationId: MED_1,
      })
      .expect(400);
  });

  it('enforces access control across users', async () => {
    const owner = await registerAndLogin(app);
    const other = await registerAndLogin(app);
    const patientId = await createPatient(app, owner.token);

    const created = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'dressing_change',
        bodyLocation: 'Left knee',
        side: 'left',
        dressingType: 'gauze',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/interventions/${created.body.id}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/interventions/${created.body.id}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
  });

  it('filters by medicationId', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'medication_dose',
        episodeIds: [],
        medicationId: MED_A,
        doseSource: 'override',
        amountMg: 100,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'medication_dose',
        episodeIds: [],
        medicationId: MED_B,
        doseSource: 'override',
        amountMg: 50,
      })
      .expect(201);

    const listMedA = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/interventions`)
      .query({ medicationId: MED_A })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(listMedA.body.length).toBe(1);
    expect(listMedA.body[0].metadata.medicationId).toBe(MED_A);
  });

  // Read-time enrichment from the catalog, never stored on the dose (api.md → Interventions).
  // CURRENT tags: retagging a medication re-classifies its past doses everywhere at once, which is
  // what lets a chart overlay default apply retroactively without a backfill.
  // ISSUES.md #28: `metadata` merged last, so a client could hand back its own value over the one
  // the dosing engine had just resolved — including the atypical flag, which is the permanent
  // trace that a dose didn't follow guidance (F-2.4).
  describe('reserved metadata keys', () => {
    it('refuses to let a create erase the engine\'s atypical verdict', async () => {
      const { token } = await registerAndLogin(app);
      const patientId = await createPatient(app, token);
      const auth = { Authorization: `Bearer ${token}` };

      const attempt = await request(app.getHttpServer())
        .post(`/api/patients/${patientId}/interventions`)
        .set(auth)
        .send({
          performedAt: '2026-01-05T10:00:00.000Z',
          type: 'medication_dose',
          medicationId: MED_1,
          doseSource: 'override',
          amountMg: 200,
          metadata: { isAtypical: false, atypicalReason: null },
        })
        .expect(400);
      expect(attempt.body.message).toBe('RESERVED_METADATA_KEY');
      expect(attempt.body.keys.sort()).toEqual(['atypicalReason', 'isAtypical']);

      // The same dose without the smuggled keys saves, and keeps the verdict the engine computed:
      // nothing to compare against, so not atypical — a hand-typed amount is not itself a reason
      // (data-model.md → Data integrity rules).
      const honest = await request(app.getHttpServer())
        .post(`/api/patients/${patientId}/interventions`)
        .set(auth)
        .send({
          performedAt: '2026-01-05T10:00:00.000Z',
          type: 'medication_dose',
          medicationId: MED_1,
          doseSource: 'override',
          amountMg: 200,
        })
        .expect(201);
      expect(honest.body.metadata.isAtypical).toBe(false);
      expect(honest.body.metadata.atypicalReason).toBeNull();
    });

    it('refuses to let metadata smuggle an unvalidated amount past the DTO range check', async () => {
      const { token } = await registerAndLogin(app);
      const patientId = await createPatient(app, token);
      const auth = { Authorization: `Bearer ${token}` };

      // Rejected as a top-level field by the range check, and now equally rejected via metadata —
      // a negative amount would otherwise count toward the daily total behind exceeds_max_per_day.
      const smuggled = await request(app.getHttpServer())
        .post(`/api/patients/${patientId}/interventions`)
        .set(auth)
        .send({
          performedAt: '2026-01-05T10:00:00.000Z',
          type: 'medication_dose',
          medicationId: MED_1,
          doseSource: 'override',
          amountMg: 200,
          metadata: { amountMg: -5000 },
        })
        .expect(400);
      expect(smuggled.body.message).toBe('RESERVED_METADATA_KEY');
      expect(smuggled.body.keys).toEqual(['amountMg']);
    });

    it('refuses the same keys on update, and still allows a client\'s own metadata', async () => {
      const { token } = await registerAndLogin(app);
      const patientId = await createPatient(app, token);
      const auth = { Authorization: `Bearer ${token}` };

      const created = await request(app.getHttpServer())
        .post(`/api/patients/${patientId}/interventions`)
        .set(auth)
        .send({
          performedAt: '2026-01-05T10:00:00.000Z',
          type: 'medication_dose',
          medicationId: MED_1,
          doseSource: 'override',
          amountMg: 200,
          metadata: { loggedFrom: 'unit-test' },
        })
        .expect(201);
      // Free-form keys are still welcome — this guard narrows nothing a client legitimately does.
      expect(created.body.metadata.loggedFrom).toBe('unit-test');

      const blocked = await request(app.getHttpServer())
        .patch(`/api/interventions/${created.body.id}`)
        .set(auth)
        .send({ metadata: { isAtypical: false } })
        .expect(400);
      expect(blocked.body.message).toBe('RESERVED_METADATA_KEY');

      const allowed = await request(app.getHttpServer())
        .patch(`/api/interventions/${created.body.id}`)
        .set(auth)
        .send({ metadata: { loggedFrom: 'bruno' } })
        .expect(200);
      expect(allowed.body.metadata.loggedFrom).toBe('bruno');
      // Untouched by the client: still exactly the engine's verdict from create.
      expect(allowed.body.metadata.isAtypical).toBe(created.body.metadata.isAtypical);
      expect(allowed.body.metadata.atypicalReason).toBe(created.body.metadata.atypicalReason);
    });
  });

  it('enriches a dose with its medication\'s current tags, and follows a retag', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);
    const auth = { Authorization: `Bearer ${token}` };

    const medication = (
      await request(app.getHttpServer())
        .post('/api/medications')
        .set(auth)
        .send({ name: `tag-enrichment-med-${Date.now()}`, tags: ['antipyretic', 'analgesic'] })
        .expect(201)
    ).body;

    const created = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set(auth)
      .send({
        performedAt: '2026-01-05T10:00:00.000Z',
        type: 'medication_dose',
        medicationId: medication.id,
        doseSource: 'override',
        amountMg: 200,
      })
      .expect(201);

    const fetched = await request(app.getHttpServer())
      .get(`/api/interventions/${created.body.id}`)
      .set(auth)
      .expect(200);
    expect(fetched.body.medicationTags).toEqual(['antipyretic', 'analgesic']);

    const listed = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/interventions`)
      .set(auth)
      .expect(200);
    expect(listed.body[0].medicationTags).toEqual(['antipyretic', 'analgesic']);

    // Retagging the catalog row changes what the existing dose reports — the whole point of
    // resolving at read time rather than copying tags onto the event.
    await request(app.getHttpServer())
      .patch(`/api/medications/${medication.id}`)
      .set(auth)
      .send({ tags: ['nsaid'] })
      .expect(200);
    const retagged = await request(app.getHttpServer())
      .get(`/api/interventions/${created.body.id}`)
      .set(auth)
      .expect(200);
    expect(retagged.body.medicationTags).toEqual(['nsaid']);
  });

  it('reports no tags for a dose whose medication is not in the catalog, and none at all on a dressing change', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);
    const auth = { Authorization: `Bearer ${token}` };

    const orphanDose = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set(auth)
      .send({
        performedAt: '2026-01-05T10:00:00.000Z',
        type: 'medication_dose',
        medicationId: MED_1,
        doseSource: 'override',
        amountMg: 100,
      })
      .expect(201);
    const fetchedDose = await request(app.getHttpServer())
      .get(`/api/interventions/${orphanDose.body.id}`)
      .set(auth)
      .expect(200);
    expect(fetchedDose.body.medicationTags).toEqual([]);

    const dressing = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set(auth)
      .send({
        performedAt: '2026-01-05T11:00:00.000Z',
        type: 'dressing_change',
        bodyLocation: 'Left knee',
        side: 'left',
        dressingType: 'sterile gauze',
      })
      .expect(201);
    const fetchedDressing = await request(app.getHttpServer())
      .get(`/api/interventions/${dressing.body.id}`)
      .set(auth)
      .expect(200);
    expect(fetchedDressing.body.medicationTags).toBeUndefined();
  });

  it('validates resolves subset on update while allowing updates without resending episodeIds', async () => {
    const { token } = await registerAndLogin(app);
    const patientId = await createPatient(app, token);

    const created = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'medication_dose',
        startEpisodeName: 'Ear infection',
        medicationId: MED_1,
        doseSource: 'override',
        amountMg: 50,
      })
      .expect(201);

    const episodeId = created.body.episodeIds[0];

    await request(app.getHttpServer())
      .patch(`/api/interventions/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ resolvesEpisodeIds: [episodeId], notes: 'updated' })
      .expect(200)
      .expect((res) => {
        expect(res.body.resolvesEpisodeIds).toEqual([episodeId]);
        expect(res.body.notes).toBe('updated');
      });

    await request(app.getHttpServer())
      .patch(`/api/interventions/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ resolvesEpisodeIds: ['ep-2'] })
      .expect(400);
  });
});


// api.md → Timeline & dashboard → GET /api/patients/:patientId/recent-medications, the Quick Log
// "recents first" source (frontend.md → "Information architecture (v2)" → Quick Log).
describe('Recent medications (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let token: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function createMedication(name: string) {
    const res = await request(app.getHttpServer())
      .post('/api/medications')
      .set(auth())
      .send({ name })
      .expect(201);
    return res.body.id as string;
  }

  async function createEmbodiment(medicationId: string, label: string) {
    const res = await request(app.getHttpServer())
      .post(`/api/medications/${medicationId}/embodiments`)
      .set(auth())
      .send({ label, concentrationMgPerMl: 32, unitType: 'ml' })
      .expect(201);
    return res.body.id as string;
  }

  async function logDose(patientId: string, body: Record<string, unknown>) {
    const res = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set(auth())
      .send({ type: 'medication_dose', doseSource: 'override', ...body })
      .expect(201);
    return res.body;
  }

  async function recents(patientId: string) {
    const res = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/recent-medications`)
      .set(auth())
      .expect(200);
    return res.body as any[];
  }

  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  beforeAll(async () => {
    ({ app, close } = await createTestApp('recent-medications'));
    ({ token } = await registerAndLogin(app));
  });

  afterAll(async () => {
    await close();
  });

  it('carries the last amount, embodiment and frozen nextAllowedAt for the prefill', async () => {
    const patientId = await createPatient(app, token);
    const medicationId = await createMedication(`recents-prefill-${Date.now()}`);
    const embodimentId = await createEmbodiment(medicationId, 'infant suspension 160mg/5mL');

    const dose = await logDose(patientId, {
      performedAt: new Date().toISOString(),
      medicationId,
      medicationEmbodimentId: embodimentId,
      amountMg: 160,
      amountMl: 5,
    });

    const body = await recents(patientId);
    expect(body.length).toBe(1);
    expect(body[0]).toMatchObject({
      medicationId,
      lastAmountMg: 160,
      lastAmountMl: 5,
      lastEmbodimentId: embodimentId,
      lastEmbodimentLabel: 'infant suspension 160mg/5mL',
      onActiveSchedule: false,
    });
    // Frozen at log time, exactly the dashboard's semantics — not recomputed on read.
    expect(body[0].nextAllowedAt).toEqual(dose.metadata.nextAllowedAt);
    expect(body[0].isAtypicalLastDose).toBe(!!dose.metadata.isAtypical);
    expect(Number.isInteger(body[0].lastDoseAt)).toBe(true);
  });

  it('orders most-recent-dose-first and drops doses older than the 14-day window', async () => {
    const patientId = await createPatient(app, token);
    const stamp = Date.now();
    const older = await createMedication(`recents-older-${stamp}`);
    const newer = await createMedication(`recents-newer-${stamp}`);
    const ancient = await createMedication(`recents-ancient-${stamp}`);

    await logDose(patientId, { performedAt: daysAgo(3), medicationId: older, amountMg: 100 });
    await logDose(patientId, { performedAt: daysAgo(1), medicationId: newer, amountMg: 200 });
    await logDose(patientId, { performedAt: daysAgo(20), medicationId: ancient, amountMg: 300 });

    const body = await recents(patientId);
    expect(body.map((r) => r.medicationId)).toEqual([newer, older]);
  });

  it('includes an active schedule\'s medication with null last* fields, ordered last', async () => {
    const patientId = await createPatient(app, token);
    const stamp = Date.now();
    const givenId = await createMedication(`recents-given-${stamp}`);
    const scheduledId = await createMedication(`recents-scheduled-${stamp}`);

    await logDose(patientId, { performedAt: new Date().toISOString(), medicationId: givenId, amountMg: 100 });
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/schedules`)
      .set(auth())
      .send({
        type: 'medication_dose',
        label: 'Amoxicillin course',
        medicationId: scheduledId,
        doseMg: 250,
        frequencyHours: 8,
        startAt: new Date().toISOString(),
      })
      .expect(201);

    const body = await recents(patientId);
    expect(body.map((r) => r.medicationId)).toEqual([givenId, scheduledId]);
    expect(body[1]).toMatchObject({
      medicationId: scheduledId,
      lastDoseAt: null,
      lastAmountMg: null,
      lastAmountMl: null,
      lastEmbodimentId: null,
      lastEmbodimentLabel: null,
      lastDoseSource: null,
      nextAllowedAt: null,
      isAtypicalLastDose: false,
      onActiveSchedule: true,
    });
  });

  // Carried so the "same as last time" prefill does not silently downgrade a guideline dose to an
  // ad-hoc override — and get it flagged atypical for it (frontend.md → Home).
  it('carries the last dose source, so a repeat is not recorded as an override', async () => {
    const patientId = await createPatient(app, token);
    const medicationId = await createMedication(`recents-source-${Date.now()}`);
    await logDose(patientId, {
      performedAt: new Date().toISOString(),
      medicationId,
      amountMg: 160,
      doseSource: 'weight_based',
      weightKgUsed: 14,
    });

    expect((await recents(patientId))[0].lastDoseSource).toBe('weight_based');
  });

  // The wrong-chart guard, and the reason this endpoint exists per patient rather than per
  // household (api.md; frontend.md → "Patient identity"). Two children on the same medication at
  // different weight-based amounts is the normal concurrent-illness case.
  it('never merges another patient\'s doses of the same medication', async () => {
    const sibling = await createPatient(app, token);
    const other = await createPatient(app, token);
    const medicationId = await createMedication(`recents-shared-${Date.now()}`);

    await logDose(sibling, { performedAt: new Date().toISOString(), medicationId, amountMg: 160 });
    await logDose(other, { performedAt: new Date().toISOString(), medicationId, amountMg: 320 });

    expect((await recents(sibling))[0].lastAmountMg).toBe(160);
    expect((await recents(other))[0].lastAmountMg).toBe(320);
  });

  it('returns an empty array for a patient with no doses and no schedules', async () => {
    const patientId = await createPatient(app, token);
    expect(await recents(patientId)).toEqual([]);
  });

  // Non-disclosure, not authorization: a caregiver off the care team must not learn the patient
  // exists (CLAUDE.md → Access control).
  it('404s PATIENT_NOT_FOUND for a caller who is not on the care team', async () => {
    const patientId = await createPatient(app, token);
    const stranger = await registerAndLogin(app);

    const res = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/recent-medications`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);
    expect(res.body.message).toBe('PATIENT_NOT_FOUND');
  });
});

// api.md → PATCH /api/interventions/:interventionId ("Not correctable", "Re-evaluation is scoped
// to a dose change", "Advisories after a correction", "Atomic"); ISSUES #31, #33, #35, #36, #39.
describe('Correcting an intervention (e2e)', () => {
  const HOUR = 3600;
  let app: INestApplication;
  let close: () => Promise<void>;
  let token: string;
  let userId: string;
  let medicationId: string;
  let embodimentId: string;
  const nowSec = () => Math.floor(Date.now() / 1000);
  const iso = (sec: number) => new Date(sec * 1000).toISOString();
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const server = () => app.getHttpServer();

  async function patientWithWeight(kg = 10) {
    const pid = await createPatient(app, token);
    await request(server())
      .post(`/api/patients/${pid}/observations`)
      .set(auth())
      .send({ observedAt: iso(nowSec() - 24 * HOUR), entries: [{ type: 'weight', metadata: { kg } }] })
      .expect(201);
    return pid;
  }
  async function dose(pid: string, body: Record<string, unknown>) {
    return (
      await request(server())
        .post(`/api/patients/${pid}/interventions`)
        .set(auth())
        .send({
          type: 'medication_dose',
          performedAt: iso(nowSec() - HOUR),
          medicationId,
          medicationEmbodimentId: embodimentId,
          doseSource: 'weight_based',
          amountMg: 150,
          ...body,
        })
        .expect(201)
    ).body;
  }
  const patch = (id: string, body: Record<string, unknown>, t = token) =>
    request(server()).patch(`/api/interventions/${id}`).set(auth(t)).send(body);
  const get = async (id: string) =>
    (await request(server()).get(`/api/interventions/${id}`).set(auth()).expect(200)).body;
  const advisoriesFor = async (pid: string, id: string) =>
    ((await request(server()).get(`/api/patients/${pid}/advisories`).set(auth()).expect(200)).body as any[]).filter(
      (a) => a.contextId === id,
    );
  const revisions = async (id: string) =>
    (await request(server()).get(`/api/interventions/${id}/revisions`).set(auth()).expect(200)).body as any[];

  beforeAll(async () => {
    ({ app, close } = await createTestApp('intervention-corrections'));
    ({ token, userId } = await registerAndLogin(app));
    medicationId = (
      await request(server()).post('/api/medications').set(auth()).send({ name: 'correction-med' }).expect(201)
    ).body.id;
    embodimentId = (
      await request(server())
        .post(`/api/medications/${medicationId}/embodiments`)
        .set(auth())
        .send({ label: 'suspension', concentrationMgPerMl: 30, unitType: 'ml' })
        .expect(201)
    ).body.id;
    await request(server())
      .post(`/api/medications/${medicationId}/guidelines`)
      .set(auth())
      .send({
        medicationEmbodimentId: embodimentId,
        source: 'Test source',
        type: 'weight_based',
        mgPerKg: 15,
        maxMgPerDose: 200,
        maxMgPerDay: 600,
        minIntervalHours: 4,
      })
      .expect(201);
  });

  afterAll(async () => {
    await close();
  });

  it('a notes-only edit writes no advisory and keeps every engine-resolved field (ISSUES #33)', async () => {
    const pid = await patientWithWeight();
    // Over the per-dose maximum, so the dose carries an atypical verdict and an advisory to keep.
    const d = await dose(pid, { doseSource: 'override', amountMg: 250 });
    expect(d.metadata.isAtypical).toBe(true);
    const before = await advisoriesFor(pid, d.id);
    expect(before.length).toBeGreaterThan(0);

    const res = await patch(d.id, { notes: 'given with food', amountMl: 4, pillCount: null }).expect(200);
    expect(res.body.notes).toBe('given with food');
    const { amountMl, pillCount, ...engineAndRest } = res.body.metadata;
    const { amountMl: _a, pillCount: _p, ...originalRest } = d.metadata;
    expect(amountMl).toBe(4);
    expect(engineAndRest).toEqual(originalRest);
    expect(await advisoriesFor(pid, d.id)).toEqual(before);
  });

  it('a dose edit that changes the evaluated reason writes exactly one new advisory and deletes none', async () => {
    const pid = await patientWithWeight();
    const d = await dose(pid, {});
    expect(d.metadata.isAtypical).toBe(false);
    const before = await advisoriesFor(pid, d.id);

    const over = await patch(d.id, { amountMg: 250 }).expect(200);
    expect(over.body.metadata.isAtypical).toBe(true);
    expect(over.body.metadata.atypicalReason).toBe('exceeds_max_per_dose');
    let after = await advisoriesFor(pid, d.id);
    expect(after).toHaveLength(before.length + 1);
    expect(after.filter((a) => a.type === 'atypical_dose')).toHaveLength(1);
    expect(after.map((a) => a.id)).toEqual(expect.arrayContaining(before.map((a) => a.id)));
    // stale_weight etc. were already recorded against this dose: not written again.
    expect(new Set(after.map((a) => a.type)).size).toBe(after.length);

    // Same reason again: nothing new.
    await patch(d.id, { amountMg: 260 }).expect(200);
    expect(await advisoriesFor(pid, d.id)).toHaveLength(after.length);

    // Cleared: the verdict flips, the earlier advisory stays, nothing is written.
    const cleared = await patch(d.id, { amountMg: 150 }).expect(200);
    expect(cleared.body.metadata.isAtypical).toBe(false);
    expect(cleared.body.metadata.atypicalReason).toBeNull();
    after = await advisoriesFor(pid, d.id);
    expect(after.filter((a) => a.type === 'atypical_dose')).toHaveLength(1);
  });

  it('corrects performedAt, re-running the engine at the corrected time and excluding the dose itself', async () => {
    const pid = await patientWithWeight();
    const t0 = nowSec();
    const first = await dose(pid, { performedAt: iso(t0 - 8 * HOUR) });
    const second = await dose(pid, { performedAt: iso(t0 - 7 * HOUR) });
    expect(second.metadata.atypicalReason).toBe('interval_too_short');

    const res = await patch(second.id, { performedAt: iso(t0 - 2 * HOUR) }).expect(200);
    expect(res.body.performedAt).toBe(t0 - 2 * HOUR);
    expect(res.body.metadata.isAtypical).toBe(false);
    expect(res.body.metadata.nextAllowedAt).toBe(t0 - 2 * HOUR + 4 * HOUR);
    // Later doses are not re-checked (ISSUES #38): the first dose is untouched.
    expect((await get(first.id)).metadata).toEqual(first.metadata);
  });

  it.each([
    ['type', 'dressing_change'],
    ['interventionScheduleId', '11111111-1111-4111-8111-111111111111'],
    ['recordedByUserId', '11111111-1111-4111-8111-111111111111'],
    ['createdAt', 1700000000],
    ['startEpisodeName', 'New frame'],
    ['startEpisodeConditionId', '11111111-1111-4111-8111-111111111111'],
    ['doseSource', 'schedule'],
  ])('refuses %s with FIELD_NOT_CORRECTABLE, naming it (ISSUES #36)', async (field, value) => {
    const pid = await patientWithWeight();
    const d = await dose(pid, {});
    const res = await patch(d.id, { notes: 'and this', [field]: value }).expect(400);
    expect(res.body.message).toBe('FIELD_NOT_CORRECTABLE');
    expect(res.body.fields).toEqual([field]);
    expect((await get(d.id)).notes).toBeNull();
    expect(await revisions(d.id)).toEqual([]);
  });

  it('refuses any doseSource on a scheduled dose, but corrects its other fields', async () => {
    const pid = await patientWithWeight();
    const schedule = await request(server())
      .post(`/api/patients/${pid}/schedules`)
      .set(auth())
      .send({
        type: 'medication_dose',
        label: 'q8h',
        medicationId,
        medicationEmbodimentId: embodimentId,
        doseMg: 150,
        frequencyHours: 8,
        startAt: new Date().toISOString(),
      })
      .expect(201);
    const logged = await request(server()).post(`/api/schedules/${schedule.body.id}/log`).set(auth()).expect(201);
    const id = logged.body.intervention.id;

    const res = await patch(id, { doseSource: 'weight_based' }).expect(400);
    expect(res.body.message).toBe('FIELD_NOT_CORRECTABLE');
    expect(res.body.fields).toEqual(['doseSource']);

    const ok = await patch(id, { amountMg: 140, notes: 'spat some out' }).expect(200);
    expect(ok.body.scheduleId).toBe(schedule.body.id);
    expect(ok.body.metadata.doseSource).toBe('schedule');
    expect(ok.body.metadata.amountMg).toBe(140);
    expect(ok.body.metadata.atypicalReason ?? null).toBeNull(); // the schedule exemption holds
  });

  it('reopens an episode when the resolving dose drops its resolve link', async () => {
    const pid = await patientWithWeight();
    const start = await request(server())
      .post(`/api/patients/${pid}/observations`)
      .set(auth())
      .send({ observedAt: iso(nowSec() - 3 * HOUR), startEpisodeName: 'Fever', entries: [{ type: 'note', metadata: { text: 'hot' } }] })
      .expect(201);
    const episodeId = start.body.episodeIds[0];
    const d = await dose(pid, { episodeIds: [episodeId], resolvesEpisodeIds: [episodeId] });
    const res = await patch(d.id, { resolvesEpisodeIds: [] }).expect(200);
    expect(res.body.resolvesEpisodeIds).toEqual([]);
    const ep = await request(server()).get(`/api/episodes/${episodeId}`).set(auth()).expect(200);
    expect(ep.body.status).toBe('active');

    // And a corrected time before the episode's start is refused when it resolves it again.
    const bad = await patch(d.id, { resolvesEpisodeIds: [episodeId], performedAt: iso(nowSec() - 4 * HOUR) }).expect(400);
    expect(bad.body.message).toBe('EPISODE_TIME_ORDER_INVALID');
  });

  it('writes nothing, the revision included, when the transaction fails partway (ISSUES #39)', async () => {
    const pid = await patientWithWeight();
    const d = await dose(pid, {});
    const before = await advisoriesFor(pid, d.id);
    const episodesService = app.get(EpisodesService);
    const spy = jest
      .spyOn(episodesService, 'applyEventEpisodeCorrection')
      .mockRejectedValueOnce(new Error('simulated failure inside the transaction'));
    try {
      await patch(d.id, { amountMg: 250, notes: 'after' }).expect(500);
    } finally {
      spy.mockRestore();
    }
    const after = await get(d.id);
    expect(after.notes).toBeNull();
    expect(after.metadata).toEqual(d.metadata);
    expect(await advisoriesFor(pid, d.id)).toEqual(before);
    expect(await revisions(d.id)).toEqual([]);
  });

  it('404s a non-member, and lets any care team member correct any dose', async () => {
    const pid = await patientWithWeight();
    const d = await dose(pid, {});
    const outsider = await registerAndLogin(app);
    const denied = await patch(d.id, { notes: 'nope' }, outsider.token).expect(404);
    expect(denied.body.message).toBe('PATIENT_NOT_FOUND');

    const helper = await registerAndLogin(app);
    await request(server())
      .post(`/api/patients/${pid}/care-team`)
      .set(auth())
      .send({ userId: helper.userId, role: 'babysitter' })
      .expect(201);
    const res = await patch(d.id, { notes: 'fixed by the babysitter' }, helper.token).expect(200);
    expect(res.body.notes).toBe('fixed by the babysitter');
    expect(res.body.recordedByUserId).toBe(userId);
    const revs = await revisions(d.id);
    expect(revs).toHaveLength(1);
    expect(revs[0].editedByUserId).toBe(helper.userId);
    expect(revs[0].snapshot.notes).toBeNull();
  });
});
