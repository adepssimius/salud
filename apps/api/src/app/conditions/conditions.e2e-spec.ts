import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { createTestApp } from '../../testing/create-test-app';

async function registerAndLogin(app: INestApplication) {
  const email = `cond-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: 'Condition User' });
  return { token: reg.body.token, userId: reg.body.user.id };
}

describe('Conditions & Protocols (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let token: string;
  let patientId: string;

  async function createPatient(authToken: string) {
    const res = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ fullName: 'Condition Patient', dateOfBirth: '2015-01-01', sexAtBirth: 'female', myRole: 'parent' })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    ({ app, close } = await createTestApp('conditions'));

    const auth = await registerAndLogin(app);
    token = auth.token;
    patientId = await createPatient(token);
  });

  afterAll(async () => {
    await close();
  });

  it('creates, lists, gets, updates, and deletes a condition', async () => {
    const create = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/conditions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'ALL treatment',
        diagnosisText: 'Acute lymphoblastic leukemia',
        baselines: ['resting HR runs 110'],
        devices: ['port'],
        contacts: [{ name: 'Dr. Okafor', role: 'Oncologist', phone: '555-1234' }],
      })
      .expect(201);
    expect(create.body.status).toBe('active');
    expect(create.body.baselines).toEqual(['resting HR runs 110']);
    expect(create.body.contacts).toEqual([{ name: 'Dr. Okafor', role: 'Oncologist', phone: '555-1234' }]);
    const conditionId = create.body.id;

    const list = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/conditions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.some((c: any) => c.id === conditionId)).toBe(true);

    const get = await request(app.getHttpServer())
      .get(`/api/conditions/${conditionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(get.body.episodeIds).toEqual([]);
    expect(get.body.scheduleIds).toEqual([]);
    expect(get.body.protocols).toEqual([]);

    const update = await request(app.getHttpServer())
      .patch(`/api/conditions/${conditionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'resolved', devices: ['port', 'G-tube'] })
      .expect(200);
    expect(update.body.status).toBe('resolved');
    expect(update.body.devices).toEqual(['port', 'G-tube']);

    await request(app.getHttpServer())
      .delete(`/api/conditions/${conditionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/conditions/${conditionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('enforces patient access control on conditions (404, not 403)', async () => {
    const other = await registerAndLogin(app);
    const create = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/conditions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Locked condition' })
      .expect(201);
    // A non-member gets the same 404 PATIENT_NOT_FOUND as any other patient-scoped route — the
    // condition existing is not disclosed to someone who isn't on the care team (api.md → "Resource
    // shape and access control").
    const res = await request(app.getHttpServer())
      .get(`/api/conditions/${create.body.id}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
    expect(res.body.message).toBe('PATIENT_NOT_FOUND');
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/conditions`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
  });

  it('creates and updates a protocol under a condition, enforcing access control through it', async () => {
    const other = await registerAndLogin(app);
    const cond = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/conditions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Protocol condition' })
      .expect(201);
    const conditionId = cond.body.id;

    const create = await request(app.getHttpServer())
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
    expect(create.body.active).toBe(true);
    const protocolId = create.body.id;

    await request(app.getHttpServer())
      .get(`/api/protocols/${protocolId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);

    const update = await request(app.getHttpServer())
      .patch(`/api/protocols/${protocolId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ active: false })
      .expect(200);
    expect(update.body.active).toBe(false);

    const conditionAfter = await request(app.getHttpServer())
      .get(`/api/conditions/${conditionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(conditionAfter.body.protocols.length).toBe(1);
    expect(conditionAfter.body.protocols[0].active).toBe(false);

    await request(app.getHttpServer())
      .delete(`/api/protocols/${protocolId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('trips an active protocol on a matching observation and persists a protocol_fired advisory visible on the timeline', async () => {
    const cond = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/conditions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Neutropenia protocol condition' })
      .expect(201);
    const conditionId = cond.body.id;

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

    // Fahrenheit entry converts to Celsius before comparison — 101F ≈ 38.3C, trips the ≥38 trigger.
    const obs = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [{ type: 'temperature', metadata: { value: 101, unit: 'F', method: 'oral' } }],
      })
      .expect(201);
    expect(obs.body.firedAdvisories.length).toBe(1);
    expect(obs.body.firedAdvisories[0].type).toBe('protocol_fired');
    expect(obs.body.firedAdvisories[0].severity).toBe('danger');
    expect(obs.body.firedAdvisories[0].payload.instructionText).toBe(
      'ER immediately, do not give antipyretics first',
    );
    expect(obs.body.firedAdvisories[0].acknowledgedByUserId).toBeTruthy();

    const advisories = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/advisories`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(advisories.body.some((a: any) => a.type === 'protocol_fired')).toBe(true);

    const timeline = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/timeline`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const protocolEntry = timeline.body.entries.find((e: any) => e.kind === 'advisory' && e.type === 'protocol_fired');
    expect(protocolEntry).toBeDefined();
  });

  it('does not trip a protocol below threshold or on a resolved condition', async () => {
    // Isolated patient — a still-active protocol from an earlier test on the shared `patientId`
    // would otherwise also trip on a high-temperature observation and pollute this assertion.
    const isolatedPatient = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Isolated Protocol Patient', dateOfBirth: '2015-01-01', sexAtBirth: 'male', myRole: 'parent' })
      .expect(201);
    const isolatedPatientId = isolatedPatient.body.id;

    const cond = await request(app.getHttpServer())
      .post(`/api/patients/${isolatedPatientId}/conditions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Resolved condition' })
      .expect(201);
    const conditionId = cond.body.id;
    await request(app.getHttpServer())
      .post(`/api/conditions/${conditionId}/protocols`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'High fever',
        triggerMetric: 'temperature',
        triggerOperator: 'gte',
        triggerValue: 39,
        instructionText: 'Call oncology',
        sourceText: 'Dr. Okafor',
      })
      .expect(201);

    const belowThreshold = await request(app.getHttpServer())
      .post(`/api/patients/${isolatedPatientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [{ type: 'temperature', metadata: { value: 37.5, unit: 'C', method: 'oral' } }],
      })
      .expect(201);
    expect(belowThreshold.body.firedAdvisories ?? []).toEqual([]);

    await request(app.getHttpServer())
      .patch(`/api/conditions/${conditionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'resolved' })
      .expect(200);

    const aboveThresholdButResolved = await request(app.getHttpServer())
      .post(`/api/patients/${isolatedPatientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [{ type: 'temperature', metadata: { value: 39.5, unit: 'C', method: 'oral' } }],
      })
      .expect(201);
    expect(aboveThresholdButResolved.body.firedAdvisories ?? []).toEqual([]);
  });
});
