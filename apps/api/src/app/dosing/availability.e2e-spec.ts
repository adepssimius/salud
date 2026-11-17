import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../testing/create-test-app';

// api.md → "Dosing engine" → "Live availability": every "can give now" on Home and in Quick Log
// reads `canGiveAt`, which honours the daily maximum as well as the interval. Before it existed, a
// patient at the daily cap read "can give now" as soon as the interval since the last dose passed.

const HOUR = 3600;
const DAY = 24 * HOUR;

describe('Live dose availability (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let token: string;
  let medicationId: string;
  let unguidedMedicationId: string;

  const server = () => app.getHttpServer();
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  async function newPatient(name: string) {
    const res = await auth(request(server()).post('/api/patients'))
      .send({ fullName: name, dateOfBirth: '2018-01-01', sexAtBirth: 'female' })
      .expect(201);
    return res.body.id as string;
  }

  async function dose(patientId: string, hoursAgo: number, opts: { medicationId?: string; amountMg?: number; episodeIds?: string[] } = {}) {
    const res = await auth(request(server()).post(`/api/patients/${patientId}/interventions`))
      .send({
        performedAt: new Date(Date.now() - hoursAgo * HOUR * 1000).toISOString(),
        type: 'medication_dose',
        medicationId: opts.medicationId ?? medicationId,
        doseSource: 'override',
        amountMg: opts.amountMg ?? 320,
        episodeIds: opts.episodeIds ?? [],
      })
      .expect(201);
    return res.body;
  }

  async function dashboardRow(patientId: string, medId = medicationId) {
    const res = await auth(request(server()).get('/api/dashboard')).expect(200);
    const row = res.body.lastDoses.find((p: any) => p.patientId === patientId);
    return { body: res.body, dose: row?.doses.find((d: any) => d.medicationId === medId) };
  }

  async function recent(patientId: string, medId = medicationId) {
    const res = await auth(request(server()).get(`/api/patients/${patientId}/recent-medications`)).expect(200);
    return res.body.find((r: any) => r.medicationId === medId);
  }

  beforeAll(async () => {
    ({ app, close } = await createTestApp('dose-availability'));
    const reg = await request(server())
      .post('/api/auth/register')
      .send({ email: `avail-${Date.now()}@example.com`, password: 'password123', displayName: 'Avail User' });
    token = reg.body.token;

    medicationId = (await auth(request(server()).post('/api/medications')).send({ name: 'avail-med' }).expect(201)).body.id;
    // Every 6 hours, at most 1000 mg a day: three 320 mg doses fit (960), a fourth would not (1280).
    await auth(request(server()).post(`/api/medications/${medicationId}/guidelines`))
      .send({ source: 'Avail test (age-band)', type: 'age_band', ageMinMonths: 0, ageMaxMonths: 216, doseMg: 320, frequencyPerDay: 4, maxMgPerDay: 1000 })
      .expect(201);
    unguidedMedicationId = (await auth(request(server()).post('/api/medications')).send({ name: 'avail-unguided' }).expect(201))
      .body.id;
  });

  afterAll(async () => {
    await close();
  });

  it('is the interval when the daily total leaves room — same answer on Home and in Quick Log', async () => {
    const patientId = await newPatient('Interval Kid');
    const d = await dose(patientId, 1);
    const expected = d.performedAt + 6 * HOUR;
    expect(d.metadata.nextAllowedAt).toBe(expected);

    const { dose: row } = await dashboardRow(patientId);
    expect(row.canGiveAt).toBe(expected);
    expect(row.limitedBy).toBe('interval');
    const r = await recent(patientId);
    expect(r.canGiveAt).toBe(expected);
    expect(r.limitedBy).toBe('interval');
  });

  it('waits for the daily window when the interval has passed but a repeat would exceed the max', async () => {
    const patientId = await newPatient('Capped Kid');
    const first = await dose(patientId, 20);
    await dose(patientId, 13);
    const latest = await dose(patientId, 7);
    // A different medication given in between counts toward nothing here.
    await dose(patientId, 2, { medicationId: unguidedMedicationId, amountMg: 5000 });

    // The interval alone would say "can give now": it elapsed an hour ago.
    const nowS = Math.floor(Date.now() / 1000);
    expect(latest.metadata.nextAllowedAt).toBeLessThan(nowS);

    // 960 mg in the window + a 320 mg repeat = 1280 > 1000, until the 20h-old dose ages out.
    const expected = first.performedAt + DAY + 1;
    const { dose: row } = await dashboardRow(patientId);
    expect(row.nextAllowedAt).toBe(latest.metadata.nextAllowedAt);
    expect(row.canGiveAt).toBe(expected);
    expect(row.limitedBy).toBe('daily_max');
    const r = await recent(patientId);
    expect(r.canGiveAt).toBe(expected);
    expect(r.limitedBy).toBe('daily_max');
  });

  it('agrees with the save: a dose at canGiveAt is not flagged, one a minute earlier is', async () => {
    const patientId = await newPatient('Agreement Kid');
    await dose(patientId, 20);
    await dose(patientId, 13);
    await dose(patientId, 7);
    const { dose: row } = await dashboardRow(patientId);
    const check = async (at: number) =>
      (
        await auth(request(server()).post(`/api/patients/${patientId}/dose-checks`))
          .send({ medicationId, amountMg: 320, occurredAt: new Date(at * 1000).toISOString() })
          .expect(201)
      ).body;
    const at = await check(row.canGiveAt);
    expect(at.dailyTotalMg).toBeLessThanOrEqual(1000);
    const before = await check(row.canGiveAt - 60);
    expect(before.dailyTotalMg).toBeGreaterThan(1000);
  });

  it("reads the patient's latest dose for an episode row, not the episode's latest", async () => {
    const patientId = await newPatient('Episode Kid');
    const obs = await auth(request(server()).post(`/api/patients/${patientId}/observations`))
      .send({
        observedAt: new Date(Date.now() - 11 * HOUR * 1000).toISOString(),
        startEpisodeName: 'Avail Fever',
        entries: [{ type: 'temperature', metadata: { value: 38.9, unit: 'C', method: 'oral' } }],
      })
      .expect(201);
    const episodeId = obs.body.episodeIds[0];
    const inEpisode = await dose(patientId, 10, { episodeIds: [episodeId] });
    // The 3 AM dose, logged with no episode.
    const outside = await dose(patientId, 1);

    const { body } = await dashboardRow(patientId);
    const ep = body.activeEpisodes.find((e: any) => e.episodeId === episodeId);
    const m = ep.medications.find((x: any) => x.medicationId === medicationId);
    expect(m.lastDoseAt).toBe(inEpisode.performedAt);
    expect(m.canGiveAt).toBe(outside.performedAt + 6 * HOUR);
    expect(m.limitedBy).toBe('interval');
  });

  it('is null — no guidance, not cannot-give — for a medication with no guideline', async () => {
    const patientId = await newPatient('Unguided Kid');
    await dose(patientId, 1, { medicationId: unguidedMedicationId });
    const { dose: row } = await dashboardRow(patientId, unguidedMedicationId);
    expect(row.canGiveAt).toBeNull();
    expect(row.limitedBy).toBeNull();
    const r = await recent(patientId, unguidedMedicationId);
    expect(r.canGiveAt).toBeNull();
    expect(r.limitedBy).toBeNull();
  });

  it('never computes it for a patient the caller is not on the care team for', async () => {
    const patientId = await newPatient('Private Kid');
    await dose(patientId, 1);
    const other = await request(server())
      .post('/api/auth/register')
      .send({ email: `avail-other-${Date.now()}@example.com`, password: 'password123', displayName: 'Other' });
    const res = await request(server())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${other.body.token}`)
      .expect(200);
    expect(res.body.lastDoses.find((p: any) => p.patientId === patientId)).toBeUndefined();
    await request(server())
      .get(`/api/patients/${patientId}/recent-medications`)
      .set('Authorization', `Bearer ${other.body.token}`)
      .expect(404);
  });
});
