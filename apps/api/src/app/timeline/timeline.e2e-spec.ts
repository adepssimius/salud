import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { createTestApp } from '../../testing/create-test-app';

async function registerAndLogin(app: INestApplication, displayName = 'Timeline User') {
  const email = `timeline-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName });
  return { token: reg.body.token, userId: reg.body.user.id };
}

describe('Timeline (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let token: string;
  let userId: string;
  let patientId: string;
  let medicationId: string;

  beforeAll(async () => {
    ({ app, close } = await createTestApp('timeline'));

    const auth = await registerAndLogin(app, 'Dana Owner');
    token = auth.token;
    userId = auth.userId;

    const patientRes = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Timeline Patient', dateOfBirth: '2018-01-01', sexAtBirth: 'female', myRole: 'parent' })
      .expect(201);
    patientId = patientRes.body.id;

    const med = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'timeline-test-med', tags: ['antipyretic'] })
      .expect(201);
    medicationId = med.body.id;
  });

  afterAll(async () => {
    await close();
  });

  it('merges observations and interventions, newest first', async () => {
    const obs = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date(Date.now() - 60_000).toISOString(),
        entries: [{ type: 'temperature', metadata: { value: 38.5, unit: 'C', method: 'oral' } }],
      })
      .expect(201);

    const dose = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'medication_dose',
        medicationId,
        doseSource: 'override',
        amountMg: 100,
      })
      .expect(201);

    const timeline = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/timeline`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(timeline.body.patient.id).toBe(patientId);
    const ids = timeline.body.entries.map((e: any) => e.id);
    expect(ids).toContain(obs.body.id);
    expect(ids).toContain(dose.body.id);
    // Newest first: the dose (just now) should sort before the observation (a minute ago).
    expect(ids.indexOf(dose.body.id)).toBeLessThan(ids.indexOf(obs.body.id));

    const doseEntry = timeline.body.entries.find((e: any) => e.id === dose.body.id);
    expect(doseEntry.kind).toBe('intervention');
    expect(doseEntry.type).toBe('medication_dose');
    expect(doseEntry.display.metadata.amountMg).toBe(100);

    const obsEntry = timeline.body.entries.find((e: any) => e.id === obs.body.id);
    expect(obsEntry.kind).toBe('observation');
    expect(obsEntry.type).toBe('temperature');
  });

  it('filters by medicationId', async () => {
    const otherMed = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'other-timeline-med' })
      .expect(201);
    const otherDose = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'medication_dose',
        medicationId: otherMed.body.id,
        doseSource: 'override',
        amountMg: 50,
      })
      .expect(201);

    const filtered = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/timeline?medicationId=${medicationId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const ids = filtered.body.entries.map((e: any) => e.id);
    expect(ids).not.toContain(otherDose.body.id);
  });

  it('filters by medicationTag', async () => {
    const filtered = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/timeline?medicationTag=antipyretic`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const interventionEntries = filtered.body.entries.filter((e: any) => e.kind === 'intervention');
    expect(interventionEntries.length).toBeGreaterThan(0);
    expect(interventionEntries.every((e: any) => e.display.metadata.medicationId === medicationId)).toBe(true);
  });

  it('respects includeObservations=false and includeInterventions=false', async () => {
    const noObs = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/timeline?includeObservations=false`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(noObs.body.entries.some((e: any) => e.kind === 'observation')).toBe(false);

    const noInt = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/timeline?includeInterventions=false`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(noInt.body.entries.some((e: any) => e.kind === 'intervention')).toBe(false);
  });

  it('flags weightPrompt.needsUpdate when no weight has ever been recorded', async () => {
    const timeline = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/timeline`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(timeline.body.weightPrompt.needsUpdate).toBe(true);
    expect(timeline.body.weightPrompt.lastRecordedAt).toBeNull();
  });

  it('clears weightPrompt.needsUpdate once a recent weight is logged', async () => {
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ observedAt: new Date().toISOString(), entries: [{ type: 'weight', metadata: { kg: 15 } }] })
      .expect(201);

    const timeline = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/timeline`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(timeline.body.weightPrompt.needsUpdate).toBe(false);
  });

  it('attributes every entry with a server-resolved recordedBy', async () => {
    const timeline = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/timeline`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const events = timeline.body.entries.filter((e: any) => e.kind !== 'advisory');
    expect(events.length).toBeGreaterThan(0);
    for (const entry of events) {
      expect(entry.recordedBy).toEqual({ id: userId, displayName: 'Dana Owner' });
    }
  });

  it('names each caregiver on their own rows', async () => {
    const other = await registerAndLogin(app, 'Sam Nightshift');
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/care-team`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: other.userId, role: 'co-parent' })
      .expect(201);

    const theirs = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [{ type: 'temperature', metadata: { value: 39.1, unit: 'C', method: 'oral' } }],
      })
      .expect(201);

    const timeline = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/timeline`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const entry = timeline.body.entries.find((e: any) => e.id === theirs.body.id);
    expect(entry.recordedBy).toEqual({ id: other.userId, displayName: 'Sam Nightshift' });
    // The reader's own rows keep their own name — one page, two authors, no bleed.
    expect(
      timeline.body.entries.filter((e: any) => e.recordedBy?.id === userId).length,
    ).toBeGreaterThan(0);
  });

  // Attribution outlives membership (product.md → P3). A caregiver removed from the care team
  // keeps their name on the rows they wrote — the handoff log a household most needs to trust is
  // often the one written by the person who has since left.
  it('keeps recordedBy after the recording caregiver leaves the care team', async () => {
    const leaver = await registerAndLogin(app, 'Robin Departed');
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/care-team`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: leaver.userId, role: 'babysitter' })
      .expect(201);

    const dose = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${leaver.token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'medication_dose',
        medicationId,
        doseSource: 'override',
        amountMg: 240,
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/patients/${patientId}/care-team/${leaver.userId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // They can no longer read the patient…
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/timeline`)
      .set('Authorization', `Bearer ${leaver.token}`)
      .expect(404);

    // …but the dose they gave is still theirs.
    const timeline = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/timeline`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const entry = timeline.body.entries.find((e: any) => e.id === dose.body.id);
    expect(entry.recordedBy).toEqual({ id: leaver.userId, displayName: 'Robin Departed' });
  });

  it('enforces patient access control (404, not 403)', async () => {
    const other = await registerAndLogin(app);
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/timeline`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
  });
});
