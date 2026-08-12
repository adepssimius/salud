import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { DatabaseService } from '../persistence/database.service';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

// Synthetic fixtures (fake patient data) exercising the real pdf-parse integration end to end.
const QUEST_PDF = fs.readFileSync(path.join(__dirname, '__fixtures__', 'quest-sample.pdf'));
const NON_QUEST_PDF = fs.readFileSync(path.join(__dirname, '__fixtures__', 'non-quest.pdf'));

async function registerAndLogin(app: INestApplication) {
  const email = `labs-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: 'Labs User' });
  return { token: reg.body.token, userId: reg.body.user.id };
}

describe('Lab imports (e2e)', () => {
  let app: INestApplication;
  let tmpDir: string;
  let token: string;
  let patientId: string;

  async function uploadPdf(bytes: Buffer, filename: string, contentType: string, asToken = token, forPatient = patientId) {
    const upload = await request(app.getHttpServer())
      .post('/api/files')
      .set('Authorization', `Bearer ${asToken}`)
      .field('patientId', forPatient)
      .attach('file', bytes, { filename, contentType })
      .expect(201);
    return upload.body.fileId as string;
  }

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-labs-'));
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
    // Explicit bind (ISSUES #25) — same reasoning as every other e2e suite.
    await app.listen(0);

    const auth = await registerAndLogin(app);
    token = auth.token;

    const patient = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Labs Patient', dateOfBirth: '1990-01-15', sexAtBirth: 'female', myRole: 'parent' })
      .expect(201);
    patientId = patient.body.id;
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/lab-imports`)
      .send({ fileId: '11111111-1111-4111-8111-111111111111' })
      .expect(401);
  });

  it('404s for a non-member, without confirming the patient exists', async () => {
    const outsider = await registerAndLogin(app);
    const res = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/lab-imports`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ fileId: '11111111-1111-4111-8111-111111111111' })
      .expect(404);
    expect(res.body.message).toBe('PATIENT_NOT_FOUND');
  });

  it('400s LAB_FILE_NOT_FOUND for an unknown fileId and for another patient\'s file, identically', async () => {
    const unknown = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/lab-imports`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fileId: '11111111-1111-4111-8111-111111111111' })
      .expect(400);
    expect(unknown.body.message).toBe('LAB_FILE_NOT_FOUND');

    // A real file, but uploaded to a different patient of the same caregiver: same code,
    // deliberately — distinguishing them would leak that the file exists.
    const otherPatient = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Other Labs Patient', dateOfBirth: '1992-02-02', sexAtBirth: 'male', myRole: 'parent' })
      .expect(201);
    const crossFileId = await uploadPdf(QUEST_PDF, 'labs.pdf', 'application/pdf', token, otherPatient.body.id);
    const crossed = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/lab-imports`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fileId: crossFileId })
      .expect(400);
    expect(crossed.body.message).toBe('LAB_FILE_NOT_FOUND');
  });

  it('400s LAB_PDF_UNPARSEABLE for a non-PDF upload', async () => {
    const pngFileId = await uploadPdf(Buffer.from('fake-png-bytes'), 'photo.png', 'image/png');
    const res = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/lab-imports`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fileId: pngFileId })
      .expect(400);
    expect(res.body.message).toBe('LAB_PDF_UNPARSEABLE');
  });

  it('400s LAB_PDF_UNPARSEABLE for a file claiming to be a PDF but not readable as one', async () => {
    const fakeFileId = await uploadPdf(Buffer.from('%PDF-1.4 but not really'), 'fake.pdf', 'application/pdf');
    const res = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/lab-imports`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fileId: fakeFileId })
      .expect(400);
    expect(res.body.message).toBe('LAB_PDF_UNPARSEABLE');
  });

  it('400s LAB_FORMAT_UNSUPPORTED for a readable PDF no parser recognizes', async () => {
    const otherLabFileId = await uploadPdf(NON_QUEST_PDF, 'other-lab.pdf', 'application/pdf');
    const res = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/lab-imports`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fileId: otherLabFileId })
      .expect(400);
    expect(res.body.message).toBe('LAB_FORMAT_UNSUPPORTED');

    // Forcing an invalid format is a DTO failure, not a parse attempt.
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/lab-imports`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fileId: otherLabFileId, format: 'labcorp' })
      .expect(400);
  });

  it('parses a Quest PDF end-to-end: analytes, header fields, and warnings — persisting nothing', async () => {
    const fileId = await uploadPdf(QUEST_PDF, 'quest-labs.pdf', 'application/pdf');
    const res = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/lab-imports`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fileId })
      .expect(201);

    expect(res.body.fileId).toBe(fileId);
    const parsed = res.body.parsed;
    expect(parsed.format).toBe('quest');
    expect(parsed.labName).toBe('Quest Diagnostics');
    expect(parsed.specimenId).toBe('AB123456C');
    expect(parsed.patientName).toBe('DOE,JANE');

    const ferritin = parsed.analytes.find((a: any) => a.analyte === 'FERRITIN');
    expect(ferritin).toMatchObject({ valueText: '37', value: 37, unit: 'ng/mL', flag: 'L', refLow: 38, refHigh: 380 });
    expect(parsed.analytes.length).toBeGreaterThanOrEqual(15);
    expect(parsed.warnings).toContain('See Note 1');

    // Nothing in the catalog yet: every analyte is new, with no id and a title-cased suggestion.
    expect(res.body.resolutions.length).toBe(parsed.analytes.length);
    expect(res.body.resolutions.every((r: any) => r.status === 'new' && r.analyteId === null)).toBe(true);
    const ferritinResolution = res.body.resolutions.find((r: any) => r.analyte === 'FERRITIN');
    expect(ferritinResolution.displayName).toBe('Ferritin');

    // Stateless: the parse created neither an observation nor a catalog row.
    const observations = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(observations.body.length).toBe(0);
    const catalog = await request(app.getHttpServer())
      .get('/api/analytes')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(catalog.body.length).toBe(0);

    // The uploaded PDF is retained and streamable — the retained-for-troubleshooting guarantee.
    await request(app.getHttpServer())
      .get(`/api/files/${fileId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('reports match, conflict and new_range against this patient\'s reference range, and carries their own ranges', async () => {
    // A patient of their own, so the catalog state this test builds can't leak into the others.
    const patient = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Catalog Patient', dateOfBirth: '1990-01-15', sexAtBirth: 'female', myRole: 'parent' })
      .expect(201);
    const catalogPatientId = patient.body.id;
    const fileId = await uploadPdf(QUEST_PDF, 'quest-labs.pdf', 'application/pdf', token, catalogPatientId);

    const resolved = await request(app.getHttpServer())
      .post('/api/analytes/resolve')
      .set('Authorization', `Bearer ${token}`)
      .send({ analytes: [{ name: 'FERRITIN' }, { name: 'HEMOGLOBIN' }, { name: 'MPV' }] })
      .expect(201);
    const [ferritin, hemoglobin, mpv] = resolved.body.map((r: any) => r.analyteId);

    // The fixture prints ferritin 38-380 and hemoglobin 13.2-17.1, both effective before the
    // 2026-07-20 collection date. MPV gets no range at all.
    await request(app.getHttpServer())
      .post(`/api/patients/${catalogPatientId}/analytes/${ferritin}/ranges`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Reference', kind: 'reference', low: 30, high: 400, effectiveFrom: '2020-01-01T00:00:00.000Z' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/patients/${catalogPatientId}/analytes/${hemoglobin}/ranges`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Reference', kind: 'reference', low: 13.2, high: 17.1, effectiveFrom: '2020-01-01T00:00:00.000Z' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/patients/${catalogPatientId}/analytes/${ferritin}/ranges`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Athletic goal', low: 120, effectiveFrom: '2020-01-01T00:00:00.000Z' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/patients/${catalogPatientId}/lab-imports`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fileId })
      .expect(201);
    const byName = (name: string) => res.body.resolutions.find((r: any) => r.analyte === name);

    // Catalog says 30-400, the report prints 38-380: the caregiver decides, not the app.
    expect(byName('FERRITIN')).toMatchObject({
      analyteId: ferritin,
      displayName: 'Ferritin',
      status: 'conflict',
      catalogRange: { label: 'Reference', low: 30, high: 400 },
    });
    // Identical range: nothing to do.
    expect(byName('HEMOGLOBIN')).toMatchObject({ analyteId: hemoglobin, status: 'match' });
    // Known analyte, nothing in effect: additive, so no prompt.
    expect(byName('MPV')).toMatchObject({ analyteId: mpv, status: 'new_range', catalogRange: null });
    // Never seen before.
    expect(byName('ALBUMIN')).toMatchObject({ analyteId: null, status: 'new' });
  });

  it('compares against the range in effect at collection time, not the newest one', async () => {
    const patient = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Dated Patient', dateOfBirth: '1990-01-15', sexAtBirth: 'female', myRole: 'parent' })
      .expect(201);
    const datedPatientId = patient.body.id;
    const fileId = await uploadPdf(QUEST_PDF, 'quest-labs.pdf', 'application/pdf', token, datedPatientId);

    const albumin = (
      await request(app.getHttpServer())
        .post('/api/analytes/resolve')
        .set('Authorization', `Bearer ${token}`)
        .send({ analytes: [{ name: 'ALBUMIN' }] })
        .expect(201)
    ).body[0].analyteId;

    // What the report printed, effective long before it was drawn...
    await request(app.getHttpServer())
      .post(`/api/patients/${datedPatientId}/analytes/${albumin}/ranges`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Reference', kind: 'reference', low: 3.6, high: 5.1, effectiveFrom: '2020-01-01T00:00:00.000Z' })
      .expect(201);
    // ...and a revised standard that only takes effect after this specimen was collected.
    await request(app.getHttpServer())
      .post(`/api/patients/${datedPatientId}/analytes/${albumin}/ranges`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Reference', kind: 'reference', low: 4.0, high: 5.0, effectiveFrom: '2030-01-01T00:00:00.000Z' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/patients/${datedPatientId}/lab-imports`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fileId })
      .expect(201);
    const albuminResolution = res.body.resolutions.find((r: any) => r.analyte === 'ALBUMIN');
    // Read against the 2020 row, so it matches — the 2030 revision is not yet in effect.
    expect(albuminResolution.status).toBe('match');
    expect(albuminResolution.catalogRange).toMatchObject({ low: 3.6, high: 5.1 });
  });
});
