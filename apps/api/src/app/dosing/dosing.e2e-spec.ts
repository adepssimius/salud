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
    expect(reasons).toContain('override');
  });

  it('flags override as atypical even when the amount and timing are otherwise unremarkable', async () => {
    const freshPatientId = await createPatient(18);
    await logWeight(freshPatientId, 12);
    const dose = await logDose(freshPatientId, {
      medicationId,
      medicationEmbodimentId: embodimentId,
      doseSource: 'override',
      amountMg: 50,
    });
    expect(dose.metadata.isAtypical).toBe(true);
    expect(dose.metadata.atypicalReason).toBe('override');
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
      expect.arrayContaining(['override', 'exceeds_max_per_dose', 'exceeds_max_per_day', 'interval_too_short']),
    );
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
});
