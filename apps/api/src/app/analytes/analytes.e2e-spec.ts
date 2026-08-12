import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { DatabaseService } from '../persistence/database.service';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
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
  let tmpDir: string;
  let token: string;
  let patientId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-analytes-'));
    process.env.DATA_DIR = tmpDir;
    process.env.DB_CLIENT = 'sqlite';
    process.env.JWT_SECRET = 'test-secret';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    const dbService = app.get(DatabaseService);
    await migrate((dbService as any).db, {
      migrationsFolder: path.join(process.cwd(), 'apps/api/src/db/migrations/sqlite'),
    });
    await app.init();
    await app.listen(0); // explicit bind (ISSUES #25), same as every other e2e suite

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
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
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

  it('resolves the reference range effective at a given moment, and is retry-safe on create', async () => {
    const analyte = (
      await request(app.getHttpServer()).post('/api/analytes').set(auth()).send({ name: 'TSH' }).expect(201)
    ).body;

    const older = await request(app.getHttpServer())
      .post(`/api/analytes/${analyte.id}/reference-ranges`)
      .set(auth())
      .send({ refLow: 0.4, refHigh: 4.5, effectiveFrom: '2020-01-01T00:00:00.000Z', source: 'Old standard' })
      .expect(201);
    const newer = await request(app.getHttpServer())
      .post(`/api/analytes/${analyte.id}/reference-ranges`)
      .set(auth())
      .send({ refLow: 0.5, refHigh: 4.0, effectiveFrom: '2025-01-01T00:00:00.000Z', source: 'Revised standard' })
      .expect(201);
    expect(newer.body.id).not.toBe(older.body.id);

    // Posting the same values already in effect returns the existing row instead of stacking.
    const retry = await request(app.getHttpServer())
      .post(`/api/analytes/${analyte.id}/reference-ranges`)
      .set(auth())
      .send({ refLow: 0.5, refHigh: 4.0, effectiveFrom: '2026-06-01T00:00:00.000Z' })
      .expect(201);
    expect(retry.body.id).toBe(newer.body.id);

    const list = await request(app.getHttpServer())
      .get(`/api/analytes/${analyte.id}/reference-ranges`)
      .set(auth())
      .expect(200);
    expect(list.body.length).toBe(2); // newest first
    expect(list.body[0].id).toBe(newer.body.id);

    // A range with no bound and no text is meaningless.
    await request(app.getHttpServer())
      .post(`/api/analytes/${analyte.id}/reference-ranges`)
      .set(auth())
      .send({ effectiveFrom: '2026-01-01T00:00:00.000Z' })
      .expect(400)
      .expect((res) => expect(res.body.message).toBe('ANALYTE_RANGE_EMPTY'));

    // ...and a PATCH must not be able to empty one either.
    await request(app.getHttpServer())
      .patch(`/api/reference-ranges/${newer.body.id}`)
      .set(auth())
      .send({ refLow: null, refHigh: null })
      .expect(400)
      .expect((res) => expect(res.body.message).toBe('ANALYTE_RANGE_EMPTY'));

    await request(app.getHttpServer()).delete(`/api/reference-ranges/${older.body.id}`).set(auth()).expect(200);
    await request(app.getHttpServer())
      .delete('/api/reference-ranges/11111111-1111-4111-8111-111111111111')
      .set(auth())
      .expect(404)
      .expect((res) => expect(res.body.message).toBe('ANALYTE_RANGE_NOT_FOUND'));
  });

  it('upserts a per-patient goal and hides it from non-members', async () => {
    const analyte = (
      await request(app.getHttpServer()).post('/api/analytes').set(auth()).send({ name: 'FERRITIN GOALS' }).expect(201)
    ).body;

    const created = await request(app.getHttpServer())
      .put(`/api/patients/${patientId}/analyte-goals/${analyte.id}`)
      .set(auth())
      .send({ goalLow: 120, note: 'athletic target' })
      .expect(200);
    expect(created.body.goalLow).toBe(120);
    expect(created.body.goalHigh).toBeNull();

    // Second write updates in place — one goal per (patient, analyte).
    const updated = await request(app.getHttpServer())
      .put(`/api/patients/${patientId}/analyte-goals/${analyte.id}`)
      .set(auth())
      .send({ goalLow: 150, note: 'raised' })
      .expect(200);
    expect(updated.body.id).toBe(created.body.id);
    expect(updated.body.goalLow).toBe(150);

    const list = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/analyte-goals`)
      .set(auth())
      .expect(200);
    expect(list.body.length).toBe(1);
    expect(list.body[0].displayName).toBe('Ferritin Goals'); // joined for rendering

    await request(app.getHttpServer())
      .put(`/api/patients/${patientId}/analyte-goals/${analyte.id}`)
      .set(auth())
      .send({ note: 'no bounds' })
      .expect(400)
      .expect((res) => expect(res.body.message).toBe('ANALYTE_GOAL_EMPTY'));

    const outsider = await registerAndLogin(app);
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/analyte-goals`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(404)
      .expect((res) => expect(res.body.message).toBe('PATIENT_NOT_FOUND'));
    await request(app.getHttpServer())
      .put(`/api/patients/${patientId}/analyte-goals/${analyte.id}`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ goalLow: 1 })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/patients/${patientId}/analyte-goals/${analyte.id}`)
      .set(auth())
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/patients/${patientId}/analyte-goals/${analyte.id}`)
      .set(auth())
      .expect(404)
      .expect((res) => expect(res.body.message).toBe('ANALYTE_GOAL_NOT_FOUND'));
  });

  it('returns a patient-scoped history of recorded values with its standards', async () => {
    const analyte = (
      await request(app.getHttpServer()).post('/api/analytes').set(auth()).send({ name: 'HISTORY ANALYTE' }).expect(201)
    ).body;
    await request(app.getHttpServer())
      .post(`/api/analytes/${analyte.id}/reference-ranges`)
      .set(auth())
      .send({ refLow: 10, refHigh: 20, effectiveFrom: '2024-01-01T00:00:00.000Z' })
      .expect(201);
    await request(app.getHttpServer())
      .put(`/api/patients/${patientId}/analyte-goals/${analyte.id}`)
      .set(auth())
      .send({ goalLow: 18 })
      .expect(200);

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
    expect(history.body.ranges.length).toBe(1);
    expect(history.body.goal.goalLow).toBe(18);
    expect(history.body.points.map((p: any) => p.valueText)).toEqual(['12', '17']); // ascending
    expect(typeof history.body.points[0].observedAt).toBe('number'); // epoch seconds

    const outsider = await registerAndLogin(app);
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/analytes/${analyte.id}/history`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(404);
  });

  it('refuses to delete an analyte with recorded results, and takes its ranges and goals when it does', async () => {
    const analyte = (
      await request(app.getHttpServer()).post('/api/analytes').set(auth()).send({ name: 'DELETE ME' }).expect(201)
    ).body;
    await request(app.getHttpServer())
      .post(`/api/analytes/${analyte.id}/reference-ranges`)
      .set(auth())
      .send({ refLow: 1, refHigh: 2, effectiveFrom: '2024-01-01T00:00:00.000Z' })
      .expect(201);
    await request(app.getHttpServer())
      .put(`/api/patients/${patientId}/analyte-goals/${analyte.id}`)
      .set(auth())
      .send({ goalHigh: 5 })
      .expect(200);

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

    // Remove the measurement and the analyte goes, ranges and goals with it (unlike medications,
    // whose own children block — see analyte-dependencies.ts).
    await request(app.getHttpServer())
      .patch(`/api/observations/${observation.body.id}`)
      .set(auth())
      .send({ entries: [{ type: 'note', metadata: { text: 'replaced the lab entry' } }] })
      .expect(200);

    await request(app.getHttpServer()).delete(`/api/analytes/${analyte.id}`).set(auth()).expect(200);
    await request(app.getHttpServer()).get(`/api/analytes/${analyte.id}`).set(auth()).expect(404);
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/analyte-goals`)
      .set(auth())
      .expect(200)
      .expect((res) => expect(res.body.some((g: any) => g.analyteId === analyte.id)).toBe(false));
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/analytes').expect(401);
    await request(app.getHttpServer()).post('/api/analytes').send({ name: 'X' }).expect(401);
  });
});
