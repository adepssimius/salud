import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { createTestApp } from '../../testing/create-test-app';
import { titleCaseAnalyte } from './analytes.service';

async function registerAndLogin(app: INestApplication) {
  const email = `analytes-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: 'Analytes User' });
  return { token: reg.body.token, userId: reg.body.user.id };
}

describe('Analytes (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let token: string;
  let patientId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    ({ app, close } = await createTestApp('analytes'));

    const user = await registerAndLogin(app);
    token = user.token;
    const patient = await request(app.getHttpServer())
      .post('/api/patients')
      .set(auth())
      .send({ fullName: 'Analyte Patient', dateOfBirth: '1987-12-30', sexAtBirth: 'male', myRole: 'parent' })
      .expect(201);
    patientId = patient.body.id;
  });

  afterAll(async () => {
    await close();
  });

  describe('titleCaseAnalyte', () => {
    it('title-cases words but leaves medical abbreviations alone', () => {
      expect(titleCaseAnalyte('FERRITIN')).toBe('Ferritin');
      expect(titleCaseAnalyte('WHITE BLOOD CELL COUNT')).toBe('White Blood Cell Count');
      expect(titleCaseAnalyte('TESTOSTERONE, TOTAL, MALES (ADULT), IA')).toBe(
        'Testosterone, Total, Males (Adult), IA',
      );
      // No vowel, or two letters: an abbreviation, not a word.
      expect(titleCaseAnalyte('MCV')).toBe('MCV');
      expect(titleCaseAnalyte('MCHC')).toBe('MCHC');
      expect(titleCaseAnalyte('VITAMIN D,25-OH,TOTAL,IA')).toBe('Vitamin D,25-OH,Total,IA');
      expect(titleCaseAnalyte('% SATURATION')).toBe('% Saturation');
    });
  });

  it('creates an analyte with a title-cased display name and rejects a case-insensitive duplicate', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/analytes')
      .set(auth())
      .send({ name: 'HEMOGLOBIN', unit: 'g/dL' })
      .expect(201);
    expect(created.body.displayName).toBe('Hemoglobin');
    expect(created.body.name).toBe('HEMOGLOBIN'); // stored verbatim
    expect(created.body.unit).toBe('g/dL');

    const dupe = await request(app.getHttpServer())
      .post('/api/analytes')
      .set(auth())
      .send({ name: '  hemoglobin ' })
      .expect(409);
    expect(dupe.body.message).toBe('ANALYTE_NAME_TAKEN');

    // Renaming to its own current name is a no-op, not a conflict.
    await request(app.getHttpServer())
      .patch(`/api/analytes/${created.body.id}`)
      .set(auth())
      .send({ name: 'HEMOGLOBIN', displayName: 'Hgb' })
      .expect(200)
      .expect((res) => expect(res.body.displayName).toBe('Hgb'));
  });

  it('searches by printed name and display name', async () => {
    await request(app.getHttpServer())
      .post('/api/analytes')
      .set(auth())
      .send({ name: 'ABSOLUTE EOSINOPHILS' })
      .expect(201);
    const byPrinted = await request(app.getHttpServer())
      .get('/api/analytes?q=eosino')
      .set(auth())
      .expect(200);
    expect(byPrinted.body.some((a: any) => a.name === 'ABSOLUTE EOSINOPHILS')).toBe(true);
    const byDisplay = await request(app.getHttpServer()).get('/api/analytes?q=Absolute Eos').set(auth()).expect(200);
    expect(byDisplay.body.length).toBe(1);
  });

  it('resolves names to ids, creating what is missing, idempotently and in input order', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/analytes/resolve')
      .set(auth())
      .send({
        analytes: [
          { name: 'FERRITIN', unit: 'ng/mL', panel: 'FERRITIN' },
          { name: 'IRON, TOTAL', unit: 'mcg/dL', panel: 'IRON AND TOTAL IRON BINDING CAPACITY' },
        ],
      })
      .expect(201);
    expect(first.body.map((r: any) => r.name)).toEqual(['FERRITIN', 'IRON, TOTAL']);
    expect(first.body.every((r: any) => r.created)).toBe(true);
    expect(first.body[0].displayName).toBe('Ferritin');

    // The report's context lands on the newly created row — a bare "Iron, Total" would say less.
    const created = await request(app.getHttpServer())
      .get(`/api/analytes/${first.body[1].analyteId}`)
      .set(auth())
      .expect(200);
    expect(created.body.panel).toBe('IRON AND TOTAL IRON BINDING CAPACITY');
    expect(created.body.unit).toBe('mcg/dL');

    // Same names in different case: same ids, created now false, and the context a second report
    // prints does NOT overwrite what the catalog already says.
    const second = await request(app.getHttpServer())
      .post('/api/analytes/resolve')
      .set(auth())
      .send({
        analytes: [
          { name: 'ferritin', panel: 'SOMETHING ELSE' },
          { name: 'Iron, Total', unit: 'mmol/L', panel: 'ANOTHER PANEL' },
        ],
      })
      .expect(201);
    expect(second.body[0].analyteId).toBe(first.body[0].analyteId);
    expect(second.body[1].analyteId).toBe(first.body[1].analyteId);
    expect(second.body.every((r: any) => r.created)).toBe(false);
    const unchanged = await request(app.getHttpServer())
      .get(`/api/analytes/${first.body[1].analyteId}`)
      .set(auth())
      .expect(200);
    expect(unchanged.body.panel).toBe('IRON AND TOTAL IRON BINDING CAPACITY');
    expect(unchanged.body.unit).toBe('mcg/dL');
  });

  it('finds an analyte by the panel it is reported under', async () => {
    await request(app.getHttpServer())
      .post('/api/analytes')
      .set(auth())
      .send({ name: '% SATURATION', panel: 'IRON AND TOTAL IRON BINDING CAPACITY' })
      .expect(201);
    // "% Saturation" never says "iron" itself — the panel is what makes it findable.
    const found = await request(app.getHttpServer()).get('/api/analytes?q=iron').set(auth()).expect(200);
    expect(found.body.some((a: any) => a.name === '% SATURATION')).toBe(true);
  });

  it('resolves each lineage independently at a given moment, and is retry-safe on create', async () => {
    const analyte = (
      await request(app.getHttpServer()).post('/api/analytes').set(auth()).send({ name: 'TSH' }).expect(201)
    ).body;
    const rangesUrl = `/api/patients/${patientId}/analytes/${analyte.id}/ranges`;

    const older = await request(app.getHttpServer())
      .post(rangesUrl)
      .set(auth())
      .send({
        label: 'Reference',
        kind: 'reference',
        low: 0.4,
        high: 4.5,
        effectiveFrom: '2020-01-01T00:00:00.000Z',
        source: 'Old standard',
      })
      .expect(201);
    const newer = await request(app.getHttpServer())
      .post(rangesUrl)
      .set(auth())
      .send({
        label: 'Reference',
        kind: 'reference',
        low: 0.5,
        high: 4.0,
        effectiveFrom: '2025-01-01T00:00:00.000Z',
        source: 'Revised standard',
      })
      .expect(201);
    expect(newer.body.id).not.toBe(older.body.id);

    // Posting the same values already in effect in that lineage returns the existing row.
    const retry = await request(app.getHttpServer())
      .post(rangesUrl)
      .set(auth())
      .send({ label: 'Reference', kind: 'reference', low: 0.5, high: 4.0, effectiveFrom: '2026-06-01T00:00:00.000Z' })
      .expect(201);
    expect(retry.body.id).toBe(newer.body.id);

    // A DIFFERENT lineage with the same dates is its own standard, not a duplicate: one-sided,
    // custom-kind, and it must not collide with the reference rows above.
    const goal = await request(app.getHttpServer())
      .post(rangesUrl)
      .set(auth())
      .send({ label: 'Athletic goal', low: 2.0, effectiveFrom: '2025-01-01T00:00:00.000Z' })
      .expect(201);
    expect(goal.body.id).not.toBe(newer.body.id);
    expect(goal.body.kind).toBe('custom');
    expect(goal.body.high).toBeNull();

    const list = await request(app.getHttpServer()).get(rangesUrl).set(auth()).expect(200);
    expect(list.body.length).toBe(3); // newest first, all lineages
    expect(list.body[0].effectiveFrom).toBeGreaterThanOrEqual(list.body[1].effectiveFrom);

    // A range with no bound and no text is meaningless.
    await request(app.getHttpServer())
      .post(rangesUrl)
      .set(auth())
      .send({ label: 'Empty', effectiveFrom: '2026-01-01T00:00:00.000Z' })
      .expect(400)
      .expect((res) => expect(res.body.message).toBe('ANALYTE_RANGE_EMPTY'));

    // ...and a PATCH must not be able to empty one either.
    await request(app.getHttpServer())
      .patch(`/api/analyte-ranges/${newer.body.id}`)
      .set(auth())
      .send({ low: null, high: null })
      .expect(400)
      .expect((res) => expect(res.body.message).toBe('ANALYTE_RANGE_EMPTY'));

    await request(app.getHttpServer()).delete(`/api/analyte-ranges/${older.body.id}`).set(auth()).expect(200);
    await request(app.getHttpServer())
      .delete('/api/analyte-ranges/11111111-1111-4111-8111-111111111111')
      .set(auth())
      .expect(404)
      .expect((res) => expect(res.body.message).toBe('ANALYTE_RANGE_NOT_FOUND'));
  });

  it('keeps one patient\'s ranges out of another\'s, and out of a non-member\'s reach', async () => {
    const analyte = (
      await request(app.getHttpServer()).post('/api/analytes').set(auth()).send({ name: 'FERRITIN SCOPED' }).expect(201)
    ).body;

    // A second patient of the same caregiver: the analyte is shared, the ranges are not.
    const otherPatient = (
      await request(app.getHttpServer())
        .post('/api/patients')
        .set(auth())
        .send({ fullName: 'Second Patient', dateOfBirth: '2015-05-05', sexAtBirth: 'female', myRole: 'parent' })
        .expect(201)
    ).body;

    const mine = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/analytes/${analyte.id}/ranges`)
      .set(auth())
      .send({ label: 'Athletic goal', low: 120, effectiveFrom: '2026-01-01T00:00:00.000Z' })
      .expect(201);
    expect(mine.body.patientId).toBe(patientId);

    const theirs = await request(app.getHttpServer())
      .get(`/api/patients/${otherPatient.id}/analytes/${analyte.id}/ranges`)
      .set(auth())
      .expect(200);
    expect(theirs.body).toEqual([]); // a goal set for one person is not the other's

    const outsider = await registerAndLogin(app);
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/analytes/${analyte.id}/ranges`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(404)
      .expect((res) => expect(res.body.message).toBe('PATIENT_NOT_FOUND'));
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/analytes/${analyte.id}/ranges`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ label: 'Sneaky', low: 1, effectiveFrom: '2026-01-01T00:00:00.000Z' })
      .expect(404);
    // By-id routes find the patient through the row, and answer the same 404 a bad id gets —
    // the row's existence isn't confirmed to someone with no business with that patient.
    await request(app.getHttpServer())
      .patch(`/api/analyte-ranges/${mine.body.id}`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ low: 999 })
      .expect(404)
      .expect((res) => expect(res.body.message).toBe('ANALYTE_RANGE_NOT_FOUND'));
    await request(app.getHttpServer())
      .delete(`/api/analyte-ranges/${mine.body.id}`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(404);
  });

  it('returns a patient-scoped history of recorded values with its standards', async () => {
    const analyte = (
      await request(app.getHttpServer()).post('/api/analytes').set(auth()).send({ name: 'HISTORY ANALYTE' }).expect(201)
    ).body;
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/analytes/${analyte.id}/ranges`)
      .set(auth())
      .send({ label: 'Reference', kind: 'reference', low: 10, high: 20, effectiveFrom: '2024-01-01T00:00:00.000Z' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/analytes/${analyte.id}/ranges`)
      .set(auth())
      .send({ label: 'My target', low: 18, effectiveFrom: '2024-01-01T00:00:00.000Z' })
      .expect(201);

    for (const [observedAt, valueText] of [
      ['2025-03-01T09:00:00.000Z', '12'],
      ['2026-03-01T09:00:00.000Z', '17'],
    ]) {
      await request(app.getHttpServer())
        .post(`/api/patients/${patientId}/observations`)
        .set(auth())
        .send({
          observedAt,
          entries: [
            {
              type: 'lab_result',
              metadata: {
                analyteId: analyte.id,
                analyte: 'HISTORY ANALYTE',
                valueText,
                value: Number(valueText),
                unit: 'ng/mL',
              },
            },
          ],
        })
        .expect(201);
    }

    const history = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/analytes/${analyte.id}/history`)
      .set(auth())
      .expect(200);
    expect(history.body.analyte.id).toBe(analyte.id);
    // Both lineages come back — the lab's and the caregiver's, told apart by kind.
    expect(history.body.ranges.length).toBe(2);
    expect(history.body.ranges.map((r: any) => r.label).sort()).toEqual(['My target', 'Reference']);
    expect(history.body.ranges.find((r: any) => r.kind === 'custom').low).toBe(18);
    expect(history.body.points.map((p: any) => p.valueText)).toEqual(['12', '17']); // ascending
    expect(typeof history.body.points[0].observedAt).toBe('number'); // epoch seconds

    const outsider = await registerAndLogin(app);
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/analytes/${analyte.id}/history`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(404);
  });

  it('refuses to delete an analyte with recorded results, and takes every patient\'s ranges when it does', async () => {
    const analyte = (
      await request(app.getHttpServer()).post('/api/analytes').set(auth()).send({ name: 'DELETE ME' }).expect(201)
    ).body;
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/analytes/${analyte.id}/ranges`)
      .set(auth())
      .send({ label: 'Reference', kind: 'reference', low: 1, high: 2, effectiveFrom: '2024-01-01T00:00:00.000Z' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/analytes/${analyte.id}/ranges`)
      .set(auth())
      .send({ label: 'My target', high: 5, effectiveFrom: '2024-01-01T00:00:00.000Z' })
      .expect(201);

    const observation = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set(auth())
      .send({
        observedAt: '2026-01-01T09:00:00.000Z',
        entries: [
          { type: 'lab_result', metadata: { analyteId: analyte.id, analyte: 'DELETE ME', valueText: '3' } },
        ],
      })
      .expect(201);

    const blocked = await request(app.getHttpServer()).delete(`/api/analytes/${analyte.id}`).set(auth()).expect(409);
    expect(blocked.body.message).toBe('ANALYTE_IN_USE');
    expect(blocked.body.dependents).toEqual({ labResults: 1 });

    // Remove the measurement and the analyte goes, every patient's ranges with it (unlike
    // medications, whose own children block — see analyte-dependencies.ts).
    await request(app.getHttpServer())
      .patch(`/api/observations/${observation.body.id}`)
      .set(auth())
      .send({ entries: [{ type: 'note', metadata: { text: 'replaced the lab entry' } }] })
      .expect(200);

    await request(app.getHttpServer()).delete(`/api/analytes/${analyte.id}`).set(auth()).expect(200);
    await request(app.getHttpServer()).get(`/api/analytes/${analyte.id}`).set(auth()).expect(404);
    // The ranges went with it: the route now 404s on the analyte itself.
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/analytes/${analyte.id}/ranges`)
      .set(auth())
      .expect(404);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/analytes').expect(401);
    await request(app.getHttpServer()).post('/api/analytes').send({ name: 'X' }).expect(401);
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/analytes/11111111-1111-4111-8111-111111111111/ranges`)
      .expect(401);
  });
});
