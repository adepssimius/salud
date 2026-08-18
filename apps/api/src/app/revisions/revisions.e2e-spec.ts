import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { createTestApp } from '../../testing/create-test-app';

async function registerAndLogin(app: INestApplication) {
  const email = `revisions-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: 'Revisions User' });
  return { token: reg.body.token, userId: reg.body.user.id };
}

describe('Revisions / corrections (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let token: string;
  let patientId: string;

  beforeAll(async () => {
    ({ app, close } = await createTestApp('revisions'));

    const auth = await registerAndLogin(app);
    token = auth.token;

    const patient = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Revisions Patient', dateOfBirth: '2015-04-01', sexAtBirth: 'male', myRole: 'parent' })
      .expect(201);
    patientId = patient.body.id;
  });

  afterAll(async () => {
    await close();
  });

  it('captures no revisions until the first PATCH, then a snapshot of the pre-update state on every PATCH', async () => {
    const create = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        text: 'original note',
        entries: [{ type: 'note', metadata: { text: 'first pass' } }],
      })
      .expect(201);
    const observationId = create.body.id;

    const before = await request(app.getHttpServer())
      .get(`/api/observations/${observationId}/revisions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(before.body).toEqual([]);

    await request(app.getHttpServer())
      .patch(`/api/observations/${observationId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'corrected note' })
      .expect(200);

    const afterFirst = await request(app.getHttpServer())
      .get(`/api/observations/${observationId}/revisions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(afterFirst.body.length).toBe(1);
    expect(afterFirst.body[0].entityType).toBe('observation');
    expect(afterFirst.body[0].entityId).toBe(observationId);
    expect(afterFirst.body[0].snapshot.text).toBe('original note');
    expect(afterFirst.body[0].editedByUserId).toBe(create.body.recordedByUserId);

    // editedAt is epoch-seconds; wait past the second boundary so "newest first" ordering below
    // isn't a coin flip between two revisions timestamped in the same second.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    await request(app.getHttpServer())
      .patch(`/api/observations/${observationId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'corrected again' })
      .expect(200);

    const afterSecond = await request(app.getHttpServer())
      .get(`/api/observations/${observationId}/revisions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(afterSecond.body.length).toBe(2);
    // Newest first — the most recent pre-update snapshot ("corrected note") comes before the
    // original ("original note").
    expect(afterSecond.body[0].snapshot.text).toBe('corrected note');
    expect(afterSecond.body[1].snapshot.text).toBe('original note');
  });

  it('captures an intervention revision on PATCH', async () => {
    const create = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'dressing_change',
        bodyLocation: 'left knee',
        side: 'left',
        notes: 'first dressing',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/interventions/${create.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'changed dressing type' })
      .expect(200);

    const revisions = await request(app.getHttpServer())
      .get(`/api/interventions/${create.body.id}/revisions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(revisions.body.length).toBe(1);
    expect(revisions.body[0].entityType).toBe('intervention');
    expect(revisions.body[0].snapshot.notes).toBe('first dressing');
  });

  it('captures a condition revision on PATCH', async () => {
    const create = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/conditions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Eczema', diagnosisText: 'atopic dermatitis' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/conditions/${create.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ diagnosisText: 'atopic dermatitis, flaring' })
      .expect(200);

    const revisions = await request(app.getHttpServer())
      .get(`/api/conditions/${create.body.id}/revisions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(revisions.body.length).toBe(1);
    expect(revisions.body[0].entityType).toBe('condition');
    expect(revisions.body[0].snapshot.diagnosisText).toBe('atopic dermatitis');
  });

  it('captures a patient revision on the general PATCH but not on the dedicated code-status PATCH', async () => {
    await request(app.getHttpServer())
      .patch(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'allergic to penicillin' })
      .expect(200);

    const revisions = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/revisions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(revisions.body.length).toBe(1);
    expect(revisions.body[0].entityType).toBe('patient');

    // Code status has its own attribution trail (codeStatusSetByUserId/At) — it deliberately
    // does not also write a generic revision row.
    await request(app.getHttpServer())
      .patch(`/api/patients/${patientId}/code-status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ codeStatus: 'Full code' })
      .expect(200);

    const revisionsAfter = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/revisions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(revisionsAfter.body.length).toBe(1);
  });

  it('enforces patient access control on the revisions read (404, not 403)', async () => {
    const stranger = await registerAndLogin(app);
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/revisions`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);
  });
});
