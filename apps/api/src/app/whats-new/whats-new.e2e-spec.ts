import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { createTestApp } from '../../testing/create-test-app';

async function registerAndLogin(app: INestApplication) {
  const email = `wywa-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: 'WYWA User' });
  return { token: reg.body.token, userId: reg.body.user.id };
}

describe('While You Were Asleep (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let owner: { token: string; userId: string };
  let caregiver: { token: string; userId: string };
  let patientId: string;

  beforeAll(async () => {
    ({ app, close } = await createTestApp('wywa'));

    owner = await registerAndLogin(app);
    caregiver = await registerAndLogin(app);

    const patient = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ fullName: 'WYWA Patient', dateOfBirth: '2017-06-01', sexAtBirth: 'female', myRole: 'parent' })
      .expect(201);
    patientId = patient.body.id;

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/care-team`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: caregiver.userId, role: 'nanny' })
      .expect(201);
  });

  afterAll(async () => {
    await close();
  });

  it('enforces patient access control (404, not 403)', async () => {
    const stranger = await registerAndLogin(app);
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/whats-new`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/whats-new/ack`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);
  });

  it('surfaces events, advisories, and due schedules since the watermark, then hides them after ack', async () => {
    // Overdue medication schedule (nextDueAt = now on creation).
    const med = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'wywa-test-med' })
      .expect(201);
    const sched = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/schedules`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        type: 'medication_dose',
        label: 'wywa-test-med q8h',
        medicationId: med.body.id,
        doseMg: 100,
        frequencyHours: 8,
        startAt: new Date().toISOString(),
      })
      .expect(201);

    // A weight entry recorded overnight while the caregiver had never opened the app before
    // (lastSeenAt is null → falls back to the last 24h window).
    const obs = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ observedAt: new Date().toISOString(), entries: [{ type: 'weight', metadata: { kg: 18 } }] })
      .expect(201);

    const before = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/whats-new`)
      .set('Authorization', `Bearer ${caregiver.token}`)
      .expect(200);
    expect(before.body.events.some((e: any) => e.id === obs.body.id)).toBe(true);
    expect(before.body.nowDue.some((s: any) => s.scheduleId === sched.body.id)).toBe(true);

    // Timestamps are epoch-seconds; wait past the second boundary so the ack watermark is
    // unambiguously after the observation's createdAt, regardless of inclusive/exclusive filtering.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const ack = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/whats-new/ack`)
      .set('Authorization', `Bearer ${caregiver.token}`)
      .expect(201);
    expect(ack.body.ackedAt).toBeGreaterThan(0);

    // Immediately after ack, nothing new has happened yet — the just-seen observation drops out.
    const after = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/whats-new`)
      .set('Authorization', `Bearer ${caregiver.token}`)
      .expect(200);
    expect(after.body.events.some((e: any) => e.id === obs.body.id)).toBe(false);
    expect(after.body.since).toBeGreaterThanOrEqual(before.body.since);

    // A second observation logged after the ack shows up on the next fetch.
    const obs2 = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ observedAt: new Date().toISOString(), entries: [{ type: 'weight', metadata: { kg: 18.2 } }] })
      .expect(201);
    const afterSecond = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/whats-new`)
      .set('Authorization', `Bearer ${caregiver.token}`)
      .expect(200);
    expect(afterSecond.body.events.some((e: any) => e.id === obs2.body.id)).toBe(true);
    expect(afterSecond.body.events.some((e: any) => e.id === obs.body.id)).toBe(false);
  });

  it('loading the briefing never acks it on its own — repeated GETs keep returning the same diff', async () => {
    const fresh = await registerAndLogin(app);
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/care-team`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: fresh.userId, role: 'grandparent' })
      .expect(201);

    const obs = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ observedAt: new Date().toISOString(), entries: [{ type: 'note', metadata: { text: 'still coughing' } }] })
      .expect(201);

    const first = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/whats-new`)
      .set('Authorization', `Bearer ${fresh.token}`)
      .expect(200);
    const second = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/whats-new`)
      .set('Authorization', `Bearer ${fresh.token}`)
      .expect(200);
    expect(first.body.events.some((e: any) => e.id === obs.body.id)).toBe(true);
    expect(second.body.events.some((e: any) => e.id === obs.body.id)).toBe(true);
  });
  // ISSUES #16: the 2 AM entry your partner writes up at 6 AM was invisible to you if you last
  // looked at 5 AM -- precisely the handoff this endpoint exists to cover.
  it('surfaces a backdated entry logged after the watermark, and agrees with the dashboard count', async () => {
    // Its own patient and caregiver, so the suite-level watermark state isn't disturbed.
    const solo = await registerAndLogin(app);
    const created = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${solo.token}`)
      .send({ fullName: 'Backdated Kid', dateOfBirth: '2018-03-03', sexAtBirth: 'male', myRole: 'parent' })
      .expect(201);
    const patientId = created.body.id;
    const token = solo.token;

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/whats-new/ack`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    // Clinically 25 hours ago, written right now.
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date(Date.now() - 25 * 3600_000).toISOString(),
        entries: [{ type: 'temperature', metadata: { value: 38.4, unit: 'C', method: 'oral' } }],
      })
      .expect(201);

    const wywa = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/whats-new`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(wywa.body.events.length).toBe(1);
    // Displayed at its clinical time even though it was selected on log time -- both facts matter.
    expect(wywa.body.events[0].timestamp).toBeLessThan(wywa.body.since);

    // The cross-check that both halves of the fix moved together: the dashboard card's count and
    // this page's list must not disagree.
    const dashboard = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const row = dashboard.body.whatsNew.find((r: any) => r.patientId === patientId);
    expect(row.eventCount).toBe(wywa.body.events.length);
  });
});
