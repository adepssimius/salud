import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { createTestApp } from '../../testing/create-test-app';

async function registerAndLogin(app: INestApplication) {
  const email = `med-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: 'Med User' });
  return { token: reg.body.token, userId: reg.body.user.id };
}

describe('Medications (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ app, close } = await createTestApp('medications'));
  });

  afterAll(async () => {
    await close();
  });

  it('rejects unauthenticated access', async () => {
    await request(app.getHttpServer()).get('/api/medications').expect(401);
    await request(app.getHttpServer()).post('/api/medications').send({ name: 'x' }).expect(401);
  });

  it('creates, lists, gets, updates, and deletes a medication', async () => {
    const { token } = await registerAndLogin(app);

    const createRes = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'acetaminophen',
        brandNames: ['Tylenol', 'Panadol'],
        description: 'Antipyretic',
        tags: ['antipyretic', 'analgesic'],
      })
      .expect(201);
    expect(createRes.body.brandNames).toEqual(['Tylenol', 'Panadol']);
    const medicationId = createRes.body.id;

    const getRes = await request(app.getHttpServer())
      .get(`/api/medications/${medicationId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(getRes.body.name).toBe('acetaminophen');

    const listRes = await request(app.getHttpServer())
      .get('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listRes.body.some((m: any) => m.id === medicationId)).toBe(true);

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/medications/${medicationId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'Updated description' })
      .expect(200);
    expect(patchRes.body.description).toBe('Updated description');

    await request(app.getHttpServer())
      .delete(`/api/medications/${medicationId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/medications/${medicationId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('searches by brand name (F-1.2)', async () => {
    const { token } = await registerAndLogin(app);

    await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'ibuprofen', brandNames: ['Motrin', 'Advil'], tags: ['NSAID'] })
      .expect(201);

    const byBrand = await request(app.getHttpServer())
      .get('/api/medications?q=motrin')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(byBrand.body.some((m: any) => m.name === 'ibuprofen')).toBe(true);

    const byGeneric = await request(app.getHttpServer())
      .get('/api/medications?q=ibu')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(byGeneric.body.some((m: any) => m.name === 'ibuprofen')).toBe(true);

    const byTag = await request(app.getHttpServer())
      .get('/api/medications?tag=NSAID')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(byTag.body.some((m: any) => m.name === 'ibuprofen')).toBe(true);

    const noMatch = await request(app.getHttpServer())
      .get('/api/medications?q=xyzzy-not-a-drug')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(noMatch.body.length).toBe(0);
  });

  it('creates and manages embodiments, including cabinet fields', async () => {
    const { token } = await registerAndLogin(app);
    const med = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'cabinet-test-med' })
      .expect(201);

    const embRes = await request(app.getHttpServer())
      .post(`/api/medications/${med.body.id}/embodiments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: '500mg tablet', strengthMgPerUnit: 500, unitType: 'tablet' })
      .expect(201);
    expect(embRes.body.atHome).toBe(false);
    expect(embRes.body.runningLow).toBe(false);
    const embodimentId = embRes.body.id;

    const listRes = await request(app.getHttpServer())
      .get(`/api/medications/${med.body.id}/embodiments`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listRes.body.length).toBe(1);

    // Mark at home with an expiration date.
    const patched = await request(app.getHttpServer())
      .patch(`/api/embodiments/${embodimentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ atHome: true, expiresAt: '2027-03-01T00:00:00.000Z' })
      .expect(200);
    expect(patched.body.atHome).toBe(true);
    expect(new Date(patched.body.expiresAt * 1000).getUTCFullYear()).toBe(2027);

    // Flag running low — attribution should be stamped server-side.
    const flagged = await request(app.getHttpServer())
      .patch(`/api/embodiments/${embodimentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ runningLow: true })
      .expect(200);
    expect(flagged.body.runningLow).toBe(true);
    expect(flagged.body.runningLowFlaggedByUserId).toBeTruthy();
    expect(flagged.body.runningLowFlaggedAt).toBeTruthy();

    // Restock clears the flag and its attribution.
    const restocked = await request(app.getHttpServer())
      .patch(`/api/embodiments/${embodimentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ runningLow: false })
      .expect(200);
    expect(restocked.body.runningLow).toBe(false);
    expect(restocked.body.runningLowFlaggedByUserId).toBeNull();
    expect(restocked.body.runningLowFlaggedAt).toBeNull();

    await request(app.getHttpServer())
      .delete(`/api/embodiments/${embodimentId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('rejects an embodiment on a nonexistent medication', async () => {
    const { token } = await registerAndLogin(app);
    const nonexistent = '00000000-0000-4000-8000-000000000000';
    await request(app.getHttpServer())
      .post(`/api/medications/${nonexistent}/embodiments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'x', unitType: 'tablet' })
      .expect(404);
  });

  it('requires source and enforces per-type required fields on guidelines (N-4)', async () => {
    const { token } = await registerAndLogin(app);
    const med = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'guideline-test-med' })
      .expect(201);

    // Missing source entirely.
    await request(app.getHttpServer())
      .post(`/api/medications/${med.body.id}/guidelines`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'weight_based', mgPerKg: 15, maxMgPerDose: 1000, maxMgPerDay: 4000, minIntervalHours: 4 })
      .expect(400);

    // weight_based missing mgPerKg.
    await request(app.getHttpServer())
      .post(`/api/medications/${med.body.id}/guidelines`)
      .set('Authorization', `Bearer ${token}`)
      .send({ source: 'Test Source', type: 'weight_based', maxMgPerDose: 1000, maxMgPerDay: 4000, minIntervalHours: 4 })
      .expect(400);

    // age_band missing doseMg.
    await request(app.getHttpServer())
      .post(`/api/medications/${med.body.id}/guidelines`)
      .set('Authorization', `Bearer ${token}`)
      .send({ source: 'Test Source', type: 'age_band', ageMinMonths: 12, ageMaxMonths: 23, maxMgPerDay: 800, frequencyPerDay: 4 })
      .expect(400);

    // Valid weight_based guideline.
    const weightBased = await request(app.getHttpServer())
      .post(`/api/medications/${med.body.id}/guidelines`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        source: 'AAP Clinical Report (2011)',
        type: 'weight_based',
        mgPerKg: 15,
        maxMgPerDose: 1000,
        maxMgPerDay: 4000,
        minIntervalHours: 4,
      })
      .expect(201);
    expect(weightBased.body.source).toBe('AAP Clinical Report (2011)');

    // Valid age_band guideline.
    const ageBand = await request(app.getHttpServer())
      .post(`/api/medications/${med.body.id}/guidelines`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        source: 'Manufacturer label',
        type: 'age_band',
        ageMinMonths: 12,
        ageMaxMonths: 23,
        doseMg: 160,
        doseMl: 5,
        maxMgPerDay: 800,
        frequencyPerDay: 4,
      })
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get(`/api/medications/${med.body.id}/guidelines`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listRes.body.length).toBe(2);

    const getRes = await request(app.getHttpServer())
      .get(`/api/guidelines/${ageBand.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(getRes.body.doseMg).toBe(160);

    const patched = await request(app.getHttpServer())
      .patch(`/api/guidelines/${ageBand.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'Updated notes' })
      .expect(200);
    expect(patched.body.notes).toBe('Updated notes');

    await request(app.getHttpServer())
      .delete(`/api/guidelines/${weightBased.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('links a guideline to a specific embodiment', async () => {
    const { token } = await registerAndLogin(app);
    const med = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'scoped-guideline-med' })
      .expect(201);
    const emb = await request(app.getHttpServer())
      .post(`/api/medications/${med.body.id}/embodiments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'suspension', concentrationMgPerMl: 32, unitType: 'ml' })
      .expect(201);

    const guideline = await request(app.getHttpServer())
      .post(`/api/medications/${med.body.id}/guidelines`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        medicationEmbodimentId: emb.body.id,
        source: 'Test',
        type: 'weight_based',
        mgPerKg: 15,
        maxMgPerDose: 1000,
        maxMgPerDay: 4000,
        minIntervalHours: 4,
      })
      .expect(201);
    expect(guideline.body.medicationEmbodimentId).toBe(emb.body.id);
  });
  it('rejects a duplicate medication name, case-insensitively', async () => {
    const { token } = await registerAndLogin(app);
    const name = `Ibuprofen ${Date.now()}`;
    await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name })
      .expect(201);

    // Two identical entries are indistinguishable in the typeahead and can carry different
    // guidelines -- a hazard at 3 AM.
    const dup = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: name.toLowerCase() })
      .expect(409);
    expect(dup.body.message).toBe('MEDICATION_NAME_TAKEN');

    const other = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Paracetamol ${Date.now()}` })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/medications/${other.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name })
      .expect(409);

    // Renaming to the name it already has is a no-op, not a conflict.
    await request(app.getHttpServer())
      .patch(`/api/medications/${other.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: other.body.name })
      .expect(200);
  });

  it('rejects an inverted age band, on create and on a partial update', async () => {
    const { token } = await registerAndLogin(app);
    const med = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Bandamol ${Date.now()}` })
      .expect(201);

    const inverted = await request(app.getHttpServer())
      .post(`/api/medications/${med.body.id}/guidelines`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        source: 'label',
        type: 'age_band',
        ageMinMonths: 72,
        ageMaxMonths: 24,
        doseMg: 160,
        frequencyPerDay: 4,
        maxMgPerDay: 800,
      })
      .expect(400);
    expect(JSON.stringify(inverted.body.message)).toContain('GUIDELINE_AGE_RANGE_INVALID');

    const valid = await request(app.getHttpServer())
      .post(`/api/medications/${med.body.id}/guidelines`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        source: 'label',
        type: 'age_band',
        ageMinMonths: 24,
        ageMaxMonths: 72,
        doseMg: 160,
        frequencyPerDay: 4,
        maxMgPerDay: 800,
      })
      .expect(201);

    // The half a DTO constraint can't see: only one side supplied, checked against the merged row.
    const partial = await request(app.getHttpServer())
      .patch(`/api/guidelines/${valid.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ageMinMonths: 999 })
      .expect(400);
    expect(partial.body.message).toBe('GUIDELINE_AGE_RANGE_INVALID');

    await request(app.getHttpServer())
      .patch(`/api/guidelines/${valid.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ageMinMonths: 36 })
      .expect(200);
  });
  it('refuses to delete a catalog row that something still points at, and says what', async () => {
    const { token } = await registerAndLogin(app);

    const med = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Dependamol ${Date.now()}` })
      .expect(201);

    const emb = await request(app.getHttpServer())
      .post(`/api/medications/${med.body.id}/embodiments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'suspension', unitType: 'ml', concentrationMgPerMl: 32 })
      .expect(201);

    const guideline = await request(app.getHttpServer())
      .post(`/api/medications/${med.body.id}/guidelines`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        source: 'label',
        type: 'weight_based',
        medicationEmbodimentId: emb.body.id,
        mgPerKg: 15,
        maxMgPerDose: 1000,
        minIntervalHours: 4,
        maxMgPerDay: 4000,
      })
      .expect(201);

    const blockedMed = await request(app.getHttpServer())
      .delete(`/api/medications/${med.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(blockedMed.body.message).toBe('MEDICATION_IN_USE');
    expect(blockedMed.body.dependents).toEqual({ embodiments: 1, guidelines: 1 });

    const blockedEmb = await request(app.getHttpServer())
      .delete(`/api/embodiments/${emb.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(blockedEmb.body.message).toBe('EMBODIMENT_IN_USE');
    expect(blockedEmb.body.dependents).toEqual({ guidelines: 1 });

    // Delete downward and each level frees the next -- which is the point of blocking rather than
    // cascading: the caller walks the tree and sees what they're destroying.
    await request(app.getHttpServer())
      .delete(`/api/guidelines/${guideline.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/embodiments/${emb.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/medications/${med.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('honours atHome, runningLow and expiresAt on embodiment create, stamping the attribution', async () => {
    const { token, userId } = await registerAndLogin(app);
    const med = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Cabinetamol ${Date.now()}` })
      .expect(201);

    const expiresAt = new Date(Date.now() + 90 * 86_400_000).toISOString();
    const created = await request(app.getHttpServer())
      .post(`/api/medications/${med.body.id}/embodiments`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'suspension',
        unitType: 'ml',
        concentrationMgPerMl: 32,
        atHome: true,
        runningLow: true,
        expiresAt,
      })
      .expect(201);

    // These used to be silently stripped by whitelist:true, so the caller got a 201 with both
    // flags false and no indication anything had been dropped.
    expect(created.body.atHome).toBe(true);
    expect(created.body.runningLow).toBe(true);
    expect(created.body.runningLowFlaggedByUserId).toBe(userId);
    expect(created.body.runningLowFlaggedAt).toEqual(expect.any(Number));
    expect(created.body.expiresAt).toEqual(expect.any(Number));
  });
});
