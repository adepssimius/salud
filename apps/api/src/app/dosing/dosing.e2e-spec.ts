import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { createTestApp } from '../../testing/create-test-app';

async function registerAndLogin(app: INestApplication) {
  const email = `dose-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: 'Dose User' });
  return { token: reg.body.token, userId: reg.body.user.id };
}

function isoDate(monthsAgo: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return d.toISOString().slice(0, 10);
}

describe('Dosing engine (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let token: string;
  let patientId: string;
  let medicationId: string;
  let embodimentId: string;
  let weightGuidelineId: string;
  let ageGuidelineId: string;

  async function createPatient(dobMonthsAgo: number) {
    const res = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Dose Patient', dateOfBirth: isoDate(dobMonthsAgo), sexAtBirth: 'female', myRole: 'parent' })
      .expect(201);
    return res.body.id;
  }

  async function logWeight(pid: string, kg: number, daysAgo = 0) {
    const observedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    await request(app.getHttpServer())
      .post(`/api/patients/${pid}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ observedAt, entries: [{ type: 'weight', metadata: { kg } }] })
      .expect(201);
  }

  async function doseCheck(pid: string, body: any) {
    const res = await request(app.getHttpServer())
      .post(`/api/patients/${pid}/dose-checks`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);
    return res.body;
  }

  async function logDose(pid: string, body: any, expectStatus = 201) {
    const res = await request(app.getHttpServer())
      .post(`/api/patients/${pid}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'medication_dose', performedAt: new Date().toISOString(), ...body })
      .expect(expectStatus);
    return res.body;
  }

  beforeAll(async () => {
    ({ app, close } = await createTestApp('dosing'));

    const auth = await registerAndLogin(app);
    token = auth.token;
    patientId = await createPatient(18); // 18 months old

    const med = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'dose-test-med', tags: ['antipyretic'] })
      .expect(201);
    medicationId = med.body.id;

    const emb = await request(app.getHttpServer())
      .post(`/api/medications/${medicationId}/embodiments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'test suspension', concentrationMgPerMl: 30, unitType: 'ml' })
      .expect(201);
    embodimentId = emb.body.id;

    const weightGuideline = await request(app.getHttpServer())
      .post(`/api/medications/${medicationId}/guidelines`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        medicationEmbodimentId: embodimentId,
        source: 'Test source (weight-based)',
        type: 'weight_based',
        mgPerKg: 15,
        maxMgPerDose: 200,
        maxMgPerDay: 600,
        minIntervalHours: 4,
      })
      .expect(201);
    weightGuidelineId = weightGuideline.body.id;

    const ageGuideline = await request(app.getHttpServer())
      .post(`/api/medications/${medicationId}/guidelines`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        medicationEmbodimentId: embodimentId,
        source: 'Test source (age-band)',
        type: 'age_band',
        ageMinMonths: 12,
        ageMaxMonths: 24,
        doseMg: 150,
        doseMl: 5,
        maxMgPerDay: 600,
        frequencyPerDay: 4,
      })
      .expect(201);
    ageGuidelineId = ageGuideline.body.id;

    await logWeight(patientId, 12); // 15 mg/kg * 12kg = 180mg (disagrees with age-band's fixed 150mg)
  });

  afterAll(async () => {
    await close();
  });

  it('returns both weight-based and age-band guidance, neither preselected, showing their disagreement (F-2.1)', async () => {
    const result = await doseCheck(patientId, { medicationId, medicationEmbodimentId: embodimentId });
    expect(result.guidance.weightBased).toMatchObject({
      guidelineId: weightGuidelineId,
      source: 'Test source (weight-based)',
      mgPerKg: 15,
      computedMg: 180,
      weightKgUsed: 12,
    });
    expect(result.guidance.ageBand).toMatchObject({
      guidelineId: ageGuidelineId,
      source: 'Test source (age-band)',
      doseMg: 150,
      doseMl: 5,
    });
    // The two methods disagree (180 vs 150) — both still render.
    expect(result.guidance.weightBased.computedMg).not.toBe(result.guidance.ageBand.doseMg);
  });

  it('caps weight-based computedMg at maxMgPerDose', async () => {
    // 15 mg/kg * 12kg = 180, under the 200 cap — bump weight via a fresh patient to exceed it.
    const heavyPatientId = await createPatient(18);
    await logWeight(heavyPatientId, 20); // 15*20 = 300, capped at 200
    const result = await doseCheck(heavyPatientId, { medicationId, medicationEmbodimentId: embodimentId });
    expect(result.guidance.weightBased.computedMg).toBe(200);
  });

  it('flags exceeds_max_per_dose in preview once an amount over the cap is entered', async () => {
    const result = await doseCheck(patientId, {
      medicationId,
      medicationEmbodimentId: embodimentId,
      amountMg: 250,
    });
    const atypical = result.advisories.find((a: any) => a.type === 'atypical_dose');
    expect(atypical.payload.reasons).toContain('exceeds_max_per_dose');
  });

  it('computes nextAllowedAt forward from minIntervalHours', async () => {
    const occurredAt = new Date('2026-01-01T00:00:00.000Z');
    const result = await doseCheck(patientId, {
      medicationId,
      medicationEmbodimentId: embodimentId,
      amountMg: 100,
      occurredAt: occurredAt.toISOString(),
    });
    expect(result.nextAllowedAt).toBe(Math.floor(occurredAt.getTime() / 1000) + 4 * 3600);
  });

  it('logs a weight-based dose: server resolves guidelineId/weightKgUsed, save always succeeds (N-3)', async () => {
    const dose = await logDose(patientId, {
      medicationId,
      medicationEmbodimentId: embodimentId,
      doseSource: 'weight_based',
      amountMg: 180,
      // Client-sent guidelineId/weightKgUsed must be ignored/overridden by the server for weight_based.
      guidelineId: '11111111-1111-4111-8111-111111111111',
      weightKgUsed: 99,
    });
    expect(dose.metadata.guidelineId).toBe(weightGuidelineId);
    expect(dose.metadata.weightKgUsed).toBe(12);
    expect(dose.metadata.ageMonthsUsed).toBeGreaterThanOrEqual(17);
    expect(dose.metadata.isAtypical).toBe(false);
    expect(dose.metadata.nextAllowedAt).toBeGreaterThan(0);
  });

  it('flags interval_too_short when a dose is logged before the prior dose\'s nextAllowedAt', async () => {
    const freshPatientId = await createPatient(18);
    await logWeight(freshPatientId, 12);

    const first = await logDose(freshPatientId, {
      medicationId,
      medicationEmbodimentId: embodimentId,
      doseSource: 'weight_based',
      amountMg: 50,
    });
    expect(first.metadata.isAtypical).toBe(false);

    // Immediately log another — well within the 4h interval.
    const second = await logDose(freshPatientId, {
      medicationId,
      medicationEmbodimentId: embodimentId,
      doseSource: 'weight_based',
      amountMg: 50,
    });
    expect(second.metadata.isAtypical).toBe(true);
    expect(second.metadata.atypicalReason.split(',')).toContain('interval_too_short');
  });

  it('accumulates the daily total across doses and flags exceeds_max_per_day (still always 201 — N-3)', async () => {
    const freshPatientId = await createPatient(18);
    await logWeight(freshPatientId, 12);

    // maxMgPerDay is 600. Three doses of 250mg each (750mg total) should trip it on the last one.
    await logDose(freshPatientId, { medicationId, medicationEmbodimentId: embodimentId, doseSource: 'override', amountMg: 250 });
    await logDose(freshPatientId, { medicationId, medicationEmbodimentId: embodimentId, doseSource: 'override', amountMg: 250 });
    const third = await logDose(freshPatientId, { medicationId, medicationEmbodimentId: embodimentId, doseSource: 'override', amountMg: 250 });

    expect(third.metadata.isAtypical).toBe(true);
    const reasons = third.metadata.atypicalReason.split(',');
    expect(reasons).toContain('exceeds_max_per_day');
    // How the amount was entered is provenance, never a reason (data-model.md → Data integrity rules).
    expect(reasons).not.toContain('override');
  });

  it('does not flag a hand-entered dose under the maximum — taking less is fine by default', async () => {
    const freshPatientId = await createPatient(18);
    await logWeight(freshPatientId, 12);
    const dose = await logDose(freshPatientId, {
      medicationId,
      medicationEmbodimentId: embodimentId,
      doseSource: 'override',
      amountMg: 50,
    });
    expect(dose.metadata.isAtypical).toBe(false);
    expect(dose.metadata.atypicalReason).toBeNull();
  });

  it('still flags a hand-entered dose over the per-dose maximum', async () => {
    const freshPatientId = await createPatient(18);
    await logWeight(freshPatientId, 12);
    const dose = await logDose(freshPatientId, {
      medicationId,
      medicationEmbodimentId: embodimentId,
      doseSource: 'override',
      amountMg: 250,
    });
    expect(dose.metadata.atypicalReason).toBe('exceeds_max_per_dose');
  });

  it('still flags a hand-entered dose given too soon', async () => {
    const freshPatientId = await createPatient(18);
    await logWeight(freshPatientId, 12);
    await logDose(freshPatientId, { medicationId, medicationEmbodimentId: embodimentId, doseSource: 'override', amountMg: 50 });
    const second = await logDose(freshPatientId, {
      medicationId,
      medicationEmbodimentId: embodimentId,
      doseSource: 'override',
      amountMg: 50,
    });
    expect(second.metadata.atypicalReason).toBe('interval_too_short');
  });

  it('flags stale_weight when no weight has ever been recorded', async () => {
    const noWeightPatientId = await createPatient(18);
    const result = await doseCheck(noWeightPatientId, { medicationId, medicationEmbodimentId: embodimentId });
    const staleWeight = result.advisories.find((a: any) => a.type === 'stale_weight');
    expect(staleWeight).toBeDefined();
    expect(staleWeight.payload.daysSince).toBeNull();
  });

  it('flags stale_weight when the latest weight is more than 60 days old (F-3.2)', async () => {
    const stalePatientId = await createPatient(18);
    await logWeight(stalePatientId, 12, 61);
    const result = await doseCheck(stalePatientId, { medicationId, medicationEmbodimentId: embodimentId });
    const staleWeight = result.advisories.find((a: any) => a.type === 'stale_weight');
    expect(staleWeight).toBeDefined();
    expect(staleWeight.payload.daysSince).toBeGreaterThanOrEqual(61);
  });

  it('does not flag stale_weight when the weight is recent', async () => {
    const result = await doseCheck(patientId, { medicationId, medicationEmbodimentId: embodimentId });
    expect(result.advisories.find((a: any) => a.type === 'stale_weight')).toBeUndefined();
  });

  it('flags expired_embodiment when the selected embodiment has expired (F-9.2)', async () => {
    const expiredEmb = await request(app.getHttpServer())
      .post(`/api/medications/${medicationId}/embodiments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'expired suspension', unitType: 'ml' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/embodiments/${expiredEmb.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expiresAt: '2020-01-01T00:00:00.000Z' })
      .expect(200);

    const result = await doseCheck(patientId, { medicationId, medicationEmbodimentId: expiredEmb.body.id });
    const expired = result.advisories.find((a: any) => a.type === 'expired_embodiment');
    expect(expired).toBeDefined();
    expect(expired.sourceType).toBe('embodiment');
    expect(expired.sourceId).toBe(expiredEmb.body.id);
  });

  it('never rejects the save even for a wildly atypical dose (N-3, P1)', async () => {
    const freshPatientId = await createPatient(18);
    await logWeight(freshPatientId, 12);
    await logDose(freshPatientId, { medicationId, medicationEmbodimentId: embodimentId, doseSource: 'override', amountMg: 50 });
    // Immediately log an enormous dose — both interval and magnitude violations at once.
    const res = await logDose(freshPatientId, {
      medicationId,
      medicationEmbodimentId: embodimentId,
      doseSource: 'override',
      amountMg: 5000,
    });
    expect(res.metadata.isAtypical).toBe(true);
    const reasons = res.metadata.atypicalReason.split(',');
    expect(reasons).toEqual(
      expect.arrayContaining(['exceeds_max_per_dose', 'exceeds_max_per_day', 'interval_too_short']),
    );
    expect(reasons).not.toContain('override');
  });

  it('persists advisories, pre-acknowledged by the actor who saved the dose', async () => {
    const freshPatientId = await createPatient(18);
    await logWeight(freshPatientId, 12);
    const dose = await logDose(freshPatientId, {
      medicationId,
      medicationEmbodimentId: embodimentId,
      doseSource: 'override',
      amountMg: 5000,
    });

    const list = await request(app.getHttpServer())
      .get(`/api/patients/${freshPatientId}/advisories`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const atypical = list.body.find((a: any) => a.type === 'atypical_dose' && a.contextId === dose.id);
    expect(atypical).toBeDefined();
    expect(atypical.acknowledgedByUserId).toBeTruthy();
    expect(atypical.acknowledgedAt).toBeGreaterThan(0);
    expect(atypical.severity).toBe('warning');
  });

  it('POST /advisories/:id/ack is idempotent', async () => {
    const freshPatientId = await createPatient(18);
    await logWeight(freshPatientId, 12);
    const dose = await logDose(freshPatientId, {
      medicationId,
      medicationEmbodimentId: embodimentId,
      doseSource: 'override',
      amountMg: 5000,
    });
    const list = await request(app.getHttpServer())
      .get(`/api/patients/${freshPatientId}/advisories`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const advisoryId = list.body.find((a: any) => a.contextId === dose.id).id;

    const first = await request(app.getHttpServer())
      .post(`/api/advisories/${advisoryId}/ack`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/api/advisories/${advisoryId}/ack`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(first.body.acknowledgedByUserId).toBe(second.body.acknowledgedByUserId);
    expect(first.body.acknowledgedAt).toBe(second.body.acknowledgedAt);
  });

  it('enforces patient access control on dose-checks and advisories (404, not 403)', async () => {
    const other = await registerAndLogin(app);
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/dose-checks`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ medicationId })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/advisories`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
  });
  // The caregiver is holding a syringe, not a scale. The age-band card has always carried a
  // volume; the weight-based one used to force the division on them.
  it('derives a drawable mL volume on the weight-based path when an embodiment has a concentration', async () => {
    const check = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/dose-checks`)
      .set('Authorization', `Bearer ${token}`)
      .send({ medicationId, medicationEmbodimentId: embodimentId, amountMg: 180 })
      .expect(201);

    const wb = check.body.guidance.weightBased;
    expect(wb.computedMl).toEqual(expect.any(Number));
    expect(wb.concentrationMgPerMl).toBeGreaterThan(0);
    // Rounded to a syringe graduation -- 0.1 mL at or above 1 mL, 0.05 below -- so computedMl
    // times the concentration is deliberately NOT exactly computedMg.
    const step = wb.computedMl >= 1 ? 0.1 : 0.05;
    expect(Math.abs(wb.computedMl / step - Math.round(wb.computedMl / step))).toBeLessThan(1e-9);
    expect(Math.abs(wb.computedMl * wb.concentrationMgPerMl - wb.computedMg)).toBeLessThanOrEqual(
      (step * wb.concentrationMgPerMl) / 2 + 1e-6,
    );
  });

  it('reports no mL when there is no embodiment to take a concentration from', async () => {
    const check = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/dose-checks`)
      .set('Authorization', `Bearer ${token}`)
      .send({ medicationId, amountMg: 180 })
      .expect(201);

    expect(check.body.guidance.weightBased.computedMl).toBeNull();
    expect(check.body.guidance.weightBased.concentrationMgPerMl).toBeNull();
  });

  // api.md → dose-checks → excludeInterventionId: the correction form's preview must not check a
  // dose against itself, and the field must never reach another patient's doses.
  it('excludes the dose being corrected from its own preview, and ignores a foreign intervention id', async () => {
    const pid = await createPatient(18);
    await logWeight(pid, 10, 1);
    const at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const own = await logDose(pid, {
      performedAt: at,
      medicationId,
      medicationEmbodimentId: embodimentId,
      doseSource: 'weight_based',
      amountMg: 150,
    });
    const body = { medicationId, medicationEmbodimentId: embodimentId, amountMg: 150, occurredAt: at };
    const reasonsOf = (check: any) =>
      check.advisories.find((a: any) => a.type === 'atypical_dose')?.payload.reasons ?? [];

    // Unchanged without the field: the logged dose counts as a prior dose at the same second.
    const plain = await doseCheck(pid, body);
    expect(reasonsOf(plain)).toContain('interval_too_short');
    expect(plain.dailyTotalMg).toBe(300);

    // With it: no interval or total contribution from itself.
    const excluded = await doseCheck(pid, { ...body, excludeInterventionId: own.id });
    expect(reasonsOf(excluded)).not.toContain('interval_too_short');
    expect(excluded.dailyTotalMg).toBe(150);

    // Another patient's dose id: no effect either way, so nothing about it can be inferred.
    const other = await createPatient(18);
    await logWeight(other, 10, 1);
    const foreign = await logDose(other, {
      performedAt: at,
      medicationId,
      medicationEmbodimentId: embodimentId,
      doseSource: 'weight_based',
      amountMg: 150,
    });
    expect(await doseCheck(pid, { ...body, excludeInterventionId: foreign.id })).toEqual(plain);
    const otherPlain = await doseCheck(other, body);
    expect(await doseCheck(other, { ...body, excludeInterventionId: own.id })).toEqual(otherPlain);

    // Same id format as the other ids.
    await request(app.getHttpServer())
      .post(`/api/patients/${pid}/dose-checks`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ...body, excludeInterventionId: 'not-a-uuid' })
      .expect(400);
  });

  // ── Under-dose rule and amount derivation (data-model.md → MedicationGuideline.underDose,
  //    "Data integrity rules"; api.md → Interventions) ─────────────────────────────────────────
  describe('below_full_dose and derived amounts', () => {
    async function newMedication(name: string, embodiment: Record<string, unknown>) {
      const med = await request(app.getHttpServer())
        .post('/api/medications')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `${name}-${Math.random().toString(36).slice(2)}` })
        .expect(201);
      const emb = await request(app.getHttpServer())
        .post(`/api/medications/${med.body.id}/embodiments`)
        .set('Authorization', `Bearer ${token}`)
        .send(embodiment)
        .expect(201);
      return { medId: med.body.id as string, embId: emb.body.id as string };
    }

    async function addGuideline(medId: string, body: Record<string, unknown>) {
      const res = await request(app.getHttpServer())
        .post(`/api/medications/${medId}/guidelines`)
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(201);
      return res.body;
    }

    const weightBased = (underDose?: string) => ({
      source: 'WB source',
      type: 'weight_based',
      mgPerKg: 15,
      maxMgPerDose: 1000,
      maxMgPerDay: 4000,
      minIntervalHours: 4,
      ...(underDose ? { underDose } : {}),
    });
    const ageBand = (underDose?: string) => ({
      source: 'AB source',
      type: 'age_band',
      ageMinMonths: 12,
      ageMaxMonths: 24,
      doseMg: 150,
      maxMgPerDay: 4000,
      frequencyPerDay: 4,
      ...(underDose ? { underDose } : {}),
    });

    /** A fresh 18-month-old weighing 12 kg — so a 15 mg/kg guideline computes 180 mg. */
    async function freshPatient() {
      const pid = await createPatient(18);
      await logWeight(pid, 12);
      return pid;
    }

    /** Preview, then save the same dose at the same instant; both verdicts, for comparison. */
    async function previewThenSave(pid: string, medId: string, embId: string, amounts: Record<string, unknown>) {
      const at = new Date().toISOString();
      const preview = await doseCheck(pid, { medicationId: medId, medicationEmbodimentId: embId, occurredAt: at, ...amounts });
      const saved = await logDose(pid, {
        medicationId: medId,
        medicationEmbodimentId: embId,
        doseSource: 'override',
        performedAt: at,
        ...amounts,
      });
      const atypical = preview.advisories.find((a: any) => a.type === 'atypical_dose');
      return { previewReasons: (atypical?.payload.reasons ?? []) as string[], atypical, saved };
    }

    it('defaults underDose to allowed, and takes flagged on create and PATCH (400 on anything else)', async () => {
      const { medId } = await newMedication('ud-crud', { label: 'liquid', concentrationMgPerMl: 32, unitType: 'ml' });
      const g = await addGuideline(medId, weightBased());
      expect(g.underDose).toBe('allowed');
      const patched = await request(app.getHttpServer())
        .patch(`/api/guidelines/${g.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ underDose: 'flagged' })
        .expect(200);
      expect(patched.body.underDose).toBe('flagged');
      await request(app.getHttpServer())
        .patch(`/api/guidelines/${g.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ underDose: 'sometimes' })
        .expect(400);
      expect((await addGuideline(medId, ageBand('flagged'))).underDose).toBe('flagged');
    });

    it('never flags a smaller dose on an allowed guideline (adult acetaminophen: 500 of "up to 1000")', async () => {
      const { medId, embId } = await newMedication('ud-allowed', { label: 'liquid', concentrationMgPerMl: 32, unitType: 'ml' });
      await addGuideline(medId, weightBased());
      const pid = await freshPatient();
      const { previewReasons, saved } = await previewThenSave(pid, medId, embId, { amountMg: 20 });
      expect(previewReasons).toEqual([]);
      expect(saved.metadata.isAtypical).toBe(false);
    });

    it('does not flag a hand-entered dose with no guideline to compare against', async () => {
      const { embId, medId } = await newMedication('ud-none', { label: 'liquid', concentrationMgPerMl: 32, unitType: 'ml' });
      const pid = await freshPatient();
      const { previewReasons, saved } = await previewThenSave(pid, medId, embId, { amountMg: 5000 });
      expect(previewReasons).toEqual([]);
      expect(saved.metadata.isAtypical).toBe(false);
      expect(saved.metadata.atypicalReason).toBeNull();
    });

    it('weight-based full dose: flags under 90% of the computed dose, passes 90% exactly and above', async () => {
      const { medId, embId } = await newMedication('ud-wb', { label: 'liquid', concentrationMgPerMl: 32, unitType: 'ml' });
      await addGuideline(medId, weightBased('flagged')); // 15 mg/kg × 12 kg = 180 mg → floor 162
      const under = await previewThenSave(await freshPatient(), medId, embId, { amountMg: 150 });
      expect(under.previewReasons).toEqual(['below_full_dose']);
      expect(under.atypical.payload.fullDoseMg).toBe(180);
      expect(under.saved.metadata.atypicalReason).toBe('below_full_dose');

      const edge = await previewThenSave(await freshPatient(), medId, embId, { amountMg: 162 });
      expect(edge.previewReasons).toEqual([]);
      expect(edge.saved.metadata.isAtypical).toBe(false);

      const full = await previewThenSave(await freshPatient(), medId, embId, { amountMg: 175 });
      expect(full.saved.metadata.isAtypical).toBe(false);
    });

    it('age-band full dose: flags under 90% of doseMg, not within the margin', async () => {
      const { medId, embId } = await newMedication('ud-ab', { label: 'liquid', concentrationMgPerMl: 30, unitType: 'ml' });
      await addGuideline(medId, ageBand('flagged')); // doseMg 150 → floor 135
      const under = await previewThenSave(await freshPatient(), medId, embId, { amountMg: 100 });
      expect(under.previewReasons).toEqual(['below_full_dose']);
      expect(under.atypical.payload.fullDoseMg).toBe(150);
      expect(under.saved.metadata.atypicalReason).toBe('below_full_dose');

      const within = await previewThenSave(await freshPatient(), medId, embId, { amountMg: 140 });
      expect(within.previewReasons).toEqual([]);
      expect(within.saved.metadata.isAtypical).toBe(false);
    });

    it('a dose either applicable guideline accepts is not flagged; one both reject is', async () => {
      const { medId, embId } = await newMedication('ud-both', { label: 'liquid', concentrationMgPerMl: 30, unitType: 'ml' });
      await addGuideline(medId, weightBased('flagged')); // floor 162
      await addGuideline(medId, ageBand('flagged')); // floor 135
      const acceptedByAgeBand = await previewThenSave(await freshPatient(), medId, embId, { amountMg: 140 });
      expect(acceptedByAgeBand.saved.metadata.isAtypical).toBe(false);
      const rejectedByBoth = await previewThenSave(await freshPatient(), medId, embId, { amountMg: 100 });
      expect(rejectedByBoth.saved.metadata.atypicalReason).toBe('below_full_dose');
      expect(rejectedByBoth.atypical.payload.fullDoseMg).toBe(150);

      // An allowed guideline alongside a flagged one accepts anything lower.
      const mixed = await newMedication('ud-mixed', { label: 'liquid', concentrationMgPerMl: 30, unitType: 'ml' });
      await addGuideline(mixed.medId, weightBased('flagged'));
      await addGuideline(mixed.medId, ageBand());
      const low = await previewThenSave(await freshPatient(), mixed.medId, mixed.embId, { amountMg: 20 });
      expect(low.saved.metadata.isAtypical).toBe(false);
    });

    it('a full-dose weight-based guideline with no weight on file cannot judge, so does not flag', async () => {
      const { medId, embId } = await newMedication('ud-noweight', { label: 'liquid', concentrationMgPerMl: 30, unitType: 'ml' });
      await addGuideline(medId, weightBased('flagged'));
      const pid = await createPatient(18);
      const { saved } = await previewThenSave(pid, medId, embId, { amountMg: 10 });
      expect(saved.metadata.atypicalReason).toBeNull();
    });

    it('preview and save agree across amounts, sources and derivations', async () => {
      const { medId, embId } = await newMedication('ud-agree', { label: 'liquid', concentrationMgPerMl: 32, unitType: 'ml' });
      await addGuideline(medId, weightBased('flagged')); // 180 mg, max 1000
      const cases: Record<string, unknown>[] = [
        { amountMg: 100 },
        { amountMg: 170 },
        { amountMg: 1500 },
        { amountMl: 2 }, // 64 mg — under the full dose
        { amountMl: 5.6 }, // 179.2 mg
        {},
      ];
      for (const amounts of cases) {
        const { previewReasons, saved } = await previewThenSave(await freshPatient(), medId, embId, amounts);
        const savedReasons = saved.metadata.atypicalReason ? saved.metadata.atypicalReason.split(',') : [];
        expect({ amounts, reasons: previewReasons }).toEqual({ amounts, reasons: savedReasons });
      }
    });

    it('derives amountMg from mL and checks it — 10 mL of 32 mg/mL is 320 mg', async () => {
      const { medId, embId } = await newMedication('derive-ml', { label: 'infant', concentrationMg: 160, concentrationVolumeMl: 5, unitType: 'ml' });
      await addGuideline(medId, { ...weightBased(), maxMgPerDose: 300 });
      const pid = await freshPatient();
      const { previewReasons, atypical, saved } = await previewThenSave(pid, medId, embId, { amountMl: 10 });
      expect(saved.metadata.amountMg).toBe(320);
      expect(saved.metadata.amountMgDerived).toBe(true);
      expect(saved.metadata.amountMl).toBe(10);
      expect(previewReasons).toEqual(['exceeds_max_per_dose']);
      expect(atypical.payload.amountMg).toBe(320);
      expect(saved.metadata.atypicalReason).toBe('exceeds_max_per_dose');

      // It counts toward the next dose's daily total.
      const next = await doseCheck(pid, { medicationId: medId, medicationEmbodimentId: embId, amountMg: 100 });
      expect(next.dailyTotalMg).toBe(420);
    });

    it('derives amountMg from a partial pill count, to the cent', async () => {
      const { medId, embId } = await newMedication('derive-pill', { label: 'tablet', strengthMgPerUnit: 500, unitType: 'tablet' });
      const pid = await freshPatient();
      const dose = await logDose(pid, { medicationId: medId, medicationEmbodimentId: embId, doseSource: 'override', pillCount: 1 / 3 });
      expect(dose.metadata.amountMg).toBe(166.67);
      expect(dose.metadata.amountMgDerived).toBe(true);
    });

    it('derives nothing without the figure it needs, and keeps an entered mg over a volume', async () => {
      const cream = await newMedication('derive-none', { label: 'cream', unitType: 'other' });
      const pid = await freshPatient();
      const none = await logDose(pid, { medicationId: cream.medId, medicationEmbodimentId: cream.embId, doseSource: 'override', amountMl: 3 });
      expect(none.metadata.amountMg ?? null).toBeNull();
      expect(none.metadata.amountMgDerived).toBeUndefined();

      const liquid = await newMedication('derive-both', { label: 'liquid', concentrationMgPerMl: 32, unitType: 'ml' });
      const both = await logDose(await freshPatient(), {
        medicationId: liquid.medId,
        medicationEmbodimentId: liquid.embId,
        doseSource: 'override',
        amountMg: 300,
        amountMl: 10,
      });
      expect(both.metadata.amountMg).toBe(300);
      expect(both.metadata.amountMgDerived).toBeUndefined();
    });

    it('a correction re-derives a derived mg from the new volume, and amountMg: null hands an entered one back', async () => {
      const { medId, embId } = await newMedication('derive-patch', { label: 'liquid', concentrationMgPerMl: 32, unitType: 'ml' });
      const pid = await freshPatient();
      const dose = await logDose(pid, { medicationId: medId, medicationEmbodimentId: embId, doseSource: 'override', amountMl: 5 });
      expect(dose.metadata.amountMg).toBe(160);

      const patch = (body: Record<string, unknown>) =>
        request(app.getHttpServer())
          .patch(`/api/interventions/${dose.id}`)
          .set('Authorization', `Bearer ${token}`)
          .send(body)
          .expect(200)
          .then((r) => r.body);

      const moreMl = await patch({ amountMl: 7.5 });
      expect(moreMl.metadata.amountMg).toBe(240);
      expect(moreMl.metadata.amountMgDerived).toBe(true);

      const typed = await patch({ amountMg: 200 });
      expect(typed.metadata.amountMg).toBe(200);
      expect(typed.metadata.amountMgDerived).toBeUndefined();

      // An entered mg is not overwritten by a volume change...
      const volOnly = await patch({ amountMl: 10 });
      expect(volOnly.metadata.amountMg).toBe(200);
      // ...unless the client hands it back to derivation.
      const handedBack = await patch({ amountMg: null });
      expect(handedBack.metadata.amountMg).toBe(320);
      expect(handedBack.metadata.amountMgDerived).toBe(true);
    });

    it('refuses amountMgDerived in client metadata (RESERVED_METADATA_KEY)', async () => {
      const { medId, embId } = await newMedication('derive-reserved', { label: 'liquid', concentrationMgPerMl: 32, unitType: 'ml' });
      const res = await logDose(
        await freshPatient(),
        { medicationId: medId, medicationEmbodimentId: embId, doseSource: 'override', amountMg: 100, metadata: { amountMgDerived: true } },
        400,
      );
      expect(res.message).toBe('RESERVED_METADATA_KEY');
    });
  });
});
