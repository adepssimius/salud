import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { createTestApp } from '../../testing/create-test-app';

async function registerAndLogin(app: INestApplication) {
  const email = `dash-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: 'Dashboard User' });
  return { token: reg.body.token, userId: reg.body.user.id };
}

describe('Dashboard (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let token: string;
  let patientId: string;
  let medicationId: string;
  let embodimentId: string;

  beforeAll(async () => {
    ({ app, close } = await createTestApp('dashboard'));

    const auth = await registerAndLogin(app);
    token = auth.token;

    const patientRes = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Dashboard Patient', dateOfBirth: '2019-01-01', sexAtBirth: 'male', myRole: 'parent' })
      .expect(201);
    patientId = patientRes.body.id;

    const med = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'dashboard-test-med' })
      .expect(201);
    medicationId = med.body.id;

    const emb = await request(app.getHttpServer())
      .post(`/api/medications/${medicationId}/embodiments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'dashboard suspension', unitType: 'ml' })
      .expect(201);
    embodimentId = emb.body.id;
  });

  afterAll(async () => {
    await close();
  });

  it('surfaces an active episode with last observation summary and per-medication last dose', async () => {
    const obs = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        startEpisodeName: 'Dashboard Fever',
        entries: [{ type: 'temperature', metadata: { value: 38.7, unit: 'C', method: 'oral' } }],
      })
      .expect(201);
    const episodeId = obs.body.episodeIds[0];

    const dose = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'medication_dose',
        medicationId,
        medicationEmbodimentId: embodimentId,
        doseSource: 'override',
        amountMg: 120,
        episodeIds: [episodeId],
      })
      .expect(201);

    const dashboard = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const ep = dashboard.body.activeEpisodes.find((e: any) => e.episodeId === episodeId);
    expect(ep).toBeDefined();
    expect(ep.patientId).toBe(patientId);
    expect(ep.lastObservationSummary.entries[0].type).toBe('temperature');
    const medSummary = ep.medications.find((m: any) => m.medicationId === medicationId);
    expect(medSummary).toBeDefined();
    expect(medSummary.medicationName).toBe('dashboard-test-med');
    expect(medSummary.lastDoseAt).toBe(dose.body.performedAt);
    expect(medSummary.nextAllowedAt).toEqual(dose.body.metadata.nextAllowedAt);
    expect(medSummary.isAtypicalLastDose).toBe(dose.body.metadata.isAtypical);
  });

  it('lists upcoming schedules with an overdue flag', async () => {
    const pastStart = new Date(Date.now() - 3600_000); // an hour ago — immediately overdue
    const sched = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/schedules`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'medication_dose',
        label: 'Overdue test schedule',
        medicationId,
        frequencyHours: 6,
        startAt: pastStart.toISOString(),
      })
      .expect(201);

    const dashboard = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const row = dashboard.body.upcomingSchedules.find((s: any) => s.scheduleId === sched.body.id);
    expect(row).toBeDefined();
    expect(row.overdue).toBe(true);
    expect(row.label).toBe('Overdue test schedule');
  });

  it('surfaces running-low embodiments on the shopping list, and restock clears it', async () => {
    await request(app.getHttpServer())
      .patch(`/api/embodiments/${embodimentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ runningLow: true })
      .expect(200);

    let dashboard = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    let item = dashboard.body.shoppingList.find((s: any) => s.embodimentId === embodimentId);
    expect(item).toBeDefined();
    expect(item.medicationName).toBe('dashboard-test-med');

    await request(app.getHttpServer())
      .post(`/api/embodiments/${embodimentId}/restock`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    dashboard = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    item = dashboard.body.shoppingList.find((s: any) => s.embodimentId === embodimentId);
    expect(item).toBeUndefined();
  });

  it('only aggregates patients the requester is on the care team for', async () => {
    const other = await registerAndLogin(app);
    const dashboard = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${other.token}`)
      .expect(200);
    expect(dashboard.body.activeEpisodes.length).toBe(0);
    expect(dashboard.body.upcomingSchedules.length).toBe(0);
    expect(dashboard.body.lastDoses.length).toBe(0);
    expect(dashboard.body.whatsNew.length).toBe(0);
  });

  describe('lastDoses', () => {
    // Its own patient per test, isolated from the shared beforeAll fixture above — these assertions
    // depend on precise timing (a dose N hours ago) and on the patient having no episode at all,
    // which the shared patientId may have picked up from the tests above it.
    async function newPatient() {
      const res = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'Last Doses Patient', dateOfBirth: '2020-01-01', sexAtBirth: 'female', myRole: 'parent' })
        .expect(201);
      return res.body.id as string;
    }

    async function logDose(pid: string, hoursAgo: number, overrides: Record<string, any> = {}) {
      const performedAt = new Date(Date.now() - hoursAgo * 3600_000).toISOString();
      return request(app.getHttpServer())
        .post(`/api/patients/${pid}/interventions`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          performedAt,
          type: 'medication_dose',
          medicationId,
          medicationEmbodimentId: embodimentId,
          doseSource: 'override',
          amountMg: 120,
          ...overrides,
        })
        .expect(201);
    }

    it('surfaces a dose with NO episode — the entire premise of this field', async () => {
      const pid = await newPatient();
      const dose = await logDose(pid, 1); // 1h ago, no episodeIds / startEpisodeName at all

      const dashboard = await request(app.getHttpServer())
        .get('/api/dashboard')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // The old episode-scoped path sees nothing for this patient...
      expect(dashboard.body.activeEpisodes.find((e: any) => e.patientId === pid)).toBeUndefined();

      // ...while the patient-scoped lastDoses field does. This contrast is the fix.
      const row = dashboard.body.lastDoses.find((p: any) => p.patientId === pid);
      expect(row).toBeDefined();
      expect(row.doses.length).toBe(1);
      expect(row.doses[0].medicationId).toBe(medicationId);
      expect(row.doses[0].lastDoseAt).toBe(dose.body.performedAt);
    });

    it('resolves the medication name', async () => {
      const pid = await newPatient();
      await logDose(pid, 1);

      const dashboard = await request(app.getHttpServer())
        .get('/api/dashboard')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const row = dashboard.body.lastDoses.find((p: any) => p.patientId === pid);
      expect(row.doses[0].medicationName).toBe('dashboard-test-med');
    });

    it('applies a hard 24-hour cutoff: excludes a dose from 25h ago, includes one from 23h ago', async () => {
      const pid = await newPatient();
      await logDose(pid, 25);
      const recent = await logDose(pid, 23);

      const dashboard = await request(app.getHttpServer())
        .get('/api/dashboard')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const row = dashboard.body.lastDoses.find((p: any) => p.patientId === pid);
      expect(row.doses.length).toBe(1);
      expect(row.doses[0].lastDoseAt).toBe(recent.body.performedAt);
    });

    it('keeps only the most recent dose per medication', async () => {
      const pid = await newPatient();
      await logDose(pid, 4);
      const latest = await logDose(pid, 2);

      const dashboard = await request(app.getHttpServer())
        .get('/api/dashboard')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const row = dashboard.body.lastDoses.find((p: any) => p.patientId === pid);
      expect(row.doses.length).toBe(1);
      expect(row.doses[0].lastDoseAt).toBe(latest.body.performedAt);
    });

    it('still returns a row with doses: [] for a patient with nothing in the window', async () => {
      const pid = await newPatient();

      const dashboard = await request(app.getHttpServer())
        .get('/api/dashboard')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const row = dashboard.body.lastDoses.find((p: any) => p.patientId === pid);
      expect(row).toBeDefined();
      expect(row.doses).toEqual([]);
    });

    it('passes nextAllowedAt and isAtypicalLastDose through from the dose metadata', async () => {
      const pid = await newPatient();
      const dose = await logDose(pid, 1);

      const dashboard = await request(app.getHttpServer())
        .get('/api/dashboard')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const row = dashboard.body.lastDoses.find((p: any) => p.patientId === pid);
      expect(row.doses[0].nextAllowedAt).toEqual(dose.body.metadata.nextAllowedAt);
      expect(row.doses[0].isAtypicalLastDose).toBe(dose.body.metadata.isAtypical);
    });
  });

  describe('whatsNew', () => {
    // Own patient per test, like lastDoses above but for a sharper reason: the watermark is per
    // (patient, user) and ack MUTATES it, so tests sharing a patient would leak state into each
    // other in whatever order Jest happens to run them.
    async function newPatient(name = 'Whats New Patient') {
      const res = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: name, dateOfBirth: '2020-01-01', sexAtBirth: 'female', myRole: 'parent' })
        .expect(201);
      return res.body.id as string;
    }

    async function logObservation(pid: string, hoursAgo = 0) {
      return request(app.getHttpServer())
        .post(`/api/patients/${pid}/observations`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          observedAt: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
          entries: [{ type: 'temperature', metadata: { value: 38.2, unit: 'C', method: 'oral' } }],
        })
        .expect(201);
    }

    // doseSource: 'override' is flagged atypical, which writes an advisory — that's how these tests
    // get an advisoryCount without needing a protocol producer that doesn't exist yet.
    async function logDose(pid: string, hoursAgo = 0) {
      return request(app.getHttpServer())
        .post(`/api/patients/${pid}/interventions`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          performedAt: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
          type: 'medication_dose',
          medicationId,
          medicationEmbodimentId: embodimentId,
          doseSource: 'override',
          amountMg: 120,
        })
        .expect(201);
    }

    async function whatsNewRow(pid: string, asToken = token) {
      const dashboard = await request(app.getHttpServer())
        .get('/api/dashboard')
        .set('Authorization', `Bearer ${asToken}`)
        .expect(200);
      return dashboard.body.whatsNew.find((w: any) => w.patientId === pid);
    }

    it('counts observations and interventions as events, keeping advisories separate', async () => {
      const pid = await newPatient();
      await logObservation(pid);
      await logDose(pid);

      const row = await whatsNewRow(pid);
      expect(row.eventCount).toBe(2);
      // Not folded into eventCount: the timeline merge carries only protocol_fired advisories, so
      // counting "whatever the timeline returns" would both miss types and double-count that one.
      expect(row.advisoryCount).toBeGreaterThan(0);
    });

    // The direct expression of ISSUES #16, and its inversion is the proof the fix landed. Both
    // rows were *written* seconds ago; only their clinical timestamps are 25h and 23h back. A
    // caregiver who has never looked has not seen either, so both are new to them.
    it('applies the 24h fallback window on log time when never acked', async () => {
      const pid = await newPatient();
      await logObservation(pid, 25);
      await logObservation(pid, 23);

      const row = await whatsNewRow(pid);
      expect(row.eventCount).toBe(2);
    });

    it('still returns a row with zero counts for a patient with nothing new', async () => {
      const pid = await newPatient('Quiet Patient');

      const row = await whatsNewRow(pid);
      expect(row).toBeDefined();
      expect(row.eventCount).toBe(0);
      expect(row.advisoryCount).toBe(0);
      expect(row.nowDueCount).toBe(0);
      // The client hides all-zero rows; the server must still emit them so "nothing changed" stays
      // distinguishable from "this patient fell out of the payload" (api.md → GET /api/dashboard).
    });

    // The test that earns whats-new-window.ts: it fails the moment someone tidies one of the
    // boundary comparisons on either side and the card starts disagreeing with the page.
    it('agrees exactly with GET /patients/:id/whats-new', async () => {
      const pid = await newPatient();

      // Ack first so `since` on both sides is the same *stored* watermark rather than each side
      // taking whatsNewSince's fallback branch and computing its own Math.floor(Date.now()/1000).
      // With lastSeenAt null, row.since (read mid dashboard-aggregation) and wywa.body.since (read
      // on a later, separate request) straddle enough real time that a whole-second boundary
      // landing between them made this an intermittent off-by-one — ISSUES #21, not a bug in
      // either side, just two clocks compared. See the fallback-branch test below for that case.
      await request(app.getHttpServer())
        .post(`/api/patients/${pid}/whats-new/ack`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      await new Promise((r) => setTimeout(r, 1100));

      await logObservation(pid);
      await logDose(pid);

      const row = await whatsNewRow(pid);
      const wywa = await request(app.getHttpServer())
        .get(`/api/patients/${pid}/whats-new`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(row.eventCount).toBe(wywa.body.events.length);
      expect(row.advisoryCount).toBe(wywa.body.advisoriesFired.length);
      expect(row.nowDueCount).toBe(wywa.body.nowDue.length);
      expect(row.since).toBe(wywa.body.since);
    });

    it('agrees on the 24h fallback since when the caregiver has never acked', async () => {
      const pid = await newPatient();
      await logObservation(pid);

      const row = await whatsNewRow(pid);
      const wywa = await request(app.getHttpServer())
        .get(`/api/patients/${pid}/whats-new`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(row.eventCount).toBe(wywa.body.events.length);
      // Unlike the acked case above, there's no stored watermark here — both sides independently
      // compute Math.floor(Date.now()/1000) - 24h moments apart, across a full dashboard
      // aggregation and a second HTTP round trip, so a 1-second disagreement is expected and not a
      // bug. This is the case ISSUES #21 turned out to actually be.
      expect(Math.abs(row.since - wywa.body.since)).toBeLessThanOrEqual(1);
    });

    it('collapses to zero once the caregiver acks', async () => {
      const pid = await newPatient();
      await logObservation(pid);
      expect((await whatsNewRow(pid)).eventCount).toBe(1);

      // Watermarks are epoch seconds and the event boundary is inclusive, so an ack in the same
      // second as the observation would not exclude it.
      await new Promise((r) => setTimeout(r, 1100));
      await request(app.getHttpServer())
        .post(`/api/patients/${pid}/whats-new/ack`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const after = await whatsNewRow(pid);
      expect(after.eventCount).toBe(0);
      expect(after.advisoryCount).toBe(0);
    });

    it('keeps watermarks per caregiver — one acking does not clear it for the other', async () => {
      const pid = await newPatient();
      const other = await registerAndLogin(app);
      await request(app.getHttpServer())
        .post(`/api/patients/${pid}/care-team`)
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: other.userId, role: 'parent' })
        .expect(201);
      await logObservation(pid);

      await new Promise((r) => setTimeout(r, 1100));
      await request(app.getHttpServer())
        .post(`/api/patients/${pid}/whats-new/ack`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect((await whatsNewRow(pid)).eventCount).toBe(0);
      expect((await whatsNewRow(pid, other.token)).eventCount).toBe(1);
    });

    // Events and advisories now key on the same clock (whats-new-window.ts). A dose backdated 25h
    // but logged just now counts as an event *and* fires an advisory — which is the point: the
    // 2 AM dose someone writes up at 6 AM is exactly what a handoff briefing must not drop.
    //
    // This assertion used to say the opposite, with a comment warning against "correcting" the two
    // onto one clock. That was the bug, not the invariant.
    it('counts both the backdated dose and the advisory it fired', async () => {
      const pid = await newPatient();
      await logDose(pid, 25);

      const row = await whatsNewRow(pid);
      expect(row.eventCount).toBe(1);
      expect(row.advisoryCount).toBeGreaterThan(0);
    });
  });
});
