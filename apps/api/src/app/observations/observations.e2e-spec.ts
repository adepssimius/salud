import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { createTestApp } from '../../testing/create-test-app';
import { EpisodesService } from '../episodes/episodes.service';

async function registerAndLogin(app: INestApplication) {
  const email = `obs-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const password = 'password123';
  const displayName = 'Obs User';

  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({
      email,
      password,
      displayName,
    });
  return { token: reg.body.token, email, userId: reg.body.user.id, displayName };
}

describe('Observations (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ app, close } = await createTestApp('observations'));
  });

  afterAll(async () => {
    await close();
  });

  it('creates and lists observations with multiple entries', async () => {
    const { token, userId } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Obs Patient',
        dateOfBirth: '2019-01-01',
        sexAtBirth: 'female',
        myRole: 'parent',
      })
      .expect(201);
    const patientId = patientRes.body.id;

    const createRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        text: 'Feeling warm',
        entries: [
          { type: 'temperature', metadata: { value: 38.2, unit: 'C', method: 'oral' } },
          { type: 'heart_rate', metadata: { bpm: 120 } },
        ],
      })
      .expect(201);

    expect(createRes.body.entries.length).toBe(2);
    // Regression marker for ISSUES #20: createdAt/updatedAt leaked as ISO strings here. The full
    // wire-contract sweep lives in persistence/timestamps.e2e-spec.ts; this just names the file.
    expect(Number.isInteger(createRes.body.createdAt)).toBe(true);
    expect(Number.isInteger(createRes.body.updatedAt)).toBe(true);

    const listRes = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listRes.body.length).toBe(1);
    expect(listRes.body[0].entries.some((e: any) => e.type === 'temperature')).toBe(true);

    const getRes = await request(app.getHttpServer())
      .get(`/api/observations/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(getRes.body.id).toBe(createRes.body.id);
  });

  it('round-trips unitPreferenceAtEntry and defaults it to null when omitted', async () => {
    const { token } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Units Patient', dateOfBirth: '2019-01-01', sexAtBirth: 'female', myRole: 'parent' })
      .expect(201);
    const patientId = patientRes.body.id;

    const prefs = { temp: 'F', weight: 'lb', length: 'in' };
    const withPrefs = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        unitPreferenceAtEntry: prefs,
        entries: [{ type: 'weight', metadata: { kg: 11.34 } }],
      })
      .expect(201);
    expect(withPrefs.body.unitPreferenceAtEntry).toEqual(prefs);

    const getRes = await request(app.getHttpServer())
      .get(`/api/observations/${withPrefs.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(getRes.body.unitPreferenceAtEntry).toEqual(prefs);

    const withoutPrefs = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [{ type: 'heart_rate', metadata: { bpm: 100 } }],
      })
      .expect(201);
    expect(withoutPrefs.body.unitPreferenceAtEntry).toBeNull();

    // A correction must not rewrite the units the original recorder was working in.
    await request(app.getHttpServer())
      .patch(`/api/observations/${withPrefs.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'corrected' })
      .expect(200);
    const afterPatch = await request(app.getHttpServer())
      .get(`/api/observations/${withPrefs.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(afterPatch.body.unitPreferenceAtEntry).toEqual(prefs);
  });

  it('rejects an invalid or partial unitPreferenceAtEntry', async () => {
    const { token } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Units Reject', dateOfBirth: '2019-01-01', sexAtBirth: 'female', myRole: 'parent' })
      .expect(201);
    const patientId = patientRes.body.id;
    const body = (unitPreferenceAtEntry: any) => ({
      observedAt: new Date().toISOString(),
      unitPreferenceAtEntry,
      entries: [{ type: 'heart_rate', metadata: { bpm: 100 } }],
    });

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send(body({ temp: 'K', weight: 'lb', length: 'in' }))
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send(body({ temp: 'F' }))
      .expect(400);
  });

  it('filters by entry type', async () => {
    const { token, userId } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Filter Patient',
        dateOfBirth: '2020-02-02',
        sexAtBirth: 'male',
      })
      .expect(201);
    const patientId = patientRes.body.id;

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [{ type: 'heart_rate', metadata: { bpm: 100 } }],
      })
      .expect(201);

    const tempRes = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/observations?type=temperature`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(tempRes.body.length).toBe(0);
  });

  // The weight bound is the one that matters: the value denormalizes onto the patient and feeds
  // mg/kg dose calculation, so a negative kg is a dosing-input corruption, not a cosmetic one.
  it('rejects out-of-range entry metadata, including a negative weight', async () => {
    const { token } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Bounds', dateOfBirth: '2016-04-04', sexAtBirth: 'male' })
      .expect(201);
    const patientId = patientRes.body.id;

    const post = (entry: any) =>
      request(app.getHttpServer())
        .post(`/api/patients/${patientId}/observations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ observedAt: new Date().toISOString(), entries: [entry] });

    await post({ type: 'weight', metadata: { kg: -5 } }).expect(400);
    await post({ type: 'weight', metadata: { kg: 900 } }).expect(400);
    await post({ type: 'heart_rate', metadata: { bpm: 100000 } }).expect(400);
    await post({ type: 'respiratory_rate', metadata: { breathsPerMin: 0 } }).expect(400);
    // Temperature is range-checked in the unit it was entered in: 39 is a fever in C and
    // hypothermic-to-nonsense in F, so the same number is valid under one unit and not the other.
    await post({ type: 'temperature', metadata: { value: 500, unit: 'C', method: 'oral' } }).expect(400);
    await post({ type: 'temperature', metadata: { value: 39, unit: 'F', method: 'oral' } }).expect(400);
    await post({ type: 'temperature', metadata: { value: 39, unit: 'C', method: 'oral' } }).expect(201);

    // And the patient's denormalized weight is untouched by the rejected entries.
    const patient = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(patient.body.latestWeightKg).toBeNull();
  });

  it('rejects an observedAt in the future', async () => {
    const { token } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Future Obs', dateOfBirth: '2016-04-04', sexAtBirth: 'female' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/patients/${patientRes.body.id}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date(Date.now() + 86_400_000).toISOString(),
        entries: [{ type: 'heart_rate', metadata: { bpm: 100 } }],
      })
      .expect(400);
    expect(res.body.message).toContain('DATE_IN_FUTURE');
  });

  // @ArrayMinSize(1) used to fire first and produce prose the web deliberately never displays, so
  // the documented code was unreachable and the caregiver got a generic fallback instead.
  it('reports AT_LEAST_ONE_ENTRY_REQUIRED for an empty entries array', async () => {
    const { token } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Empty Entries', dateOfBirth: '2016-04-04', sexAtBirth: 'male' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/patients/${patientRes.body.id}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ observedAt: new Date().toISOString(), entries: [] })
      .expect(400);
    // String form, not the class-validator array -- it's an explicit service throw now.
    expect(res.body.message).toBe('AT_LEAST_ONE_ENTRY_REQUIRED');
  });

  it('rejects entries with a missing required metadata field', async () => {
    const { token } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Schema Patient', dateOfBirth: '2020-01-01', sexAtBirth: 'male' })
      .expect(201);
    const patientId = patientRes.body.id;

    // Missing required `method` for a temperature entry.
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [{ type: 'temperature', metadata: { value: 38.0, unit: 'C' } }],
      })
      .expect(400)
      .expect((res) => {
        // Pins the response SHAPE the web's core/error-display.ts mapper is built against: a
        // class-validator failure gives `message` as an ARRAY, and the nested constraint's code
        // arrives path-prefixed with the property name dropped (e.g. "entries.0.OBSERVATION_SCHEMA_INVALID",
        // not "entries.0.metadata: OBSERVATION_SCHEMA_INVALID"). The mapper strips everything up to
        // the last dot, so this exact suffix shape is what it depends on.
        expect(Array.isArray(res.body.message)).toBe(true);
        expect(res.body.message.some((m: string) => m.endsWith('.OBSERVATION_SCHEMA_INVALID'))).toBe(true);
        expect(res.body.message.join(' ')).toContain('OBSERVATION_SCHEMA_INVALID');
      });
  });

  // @IsEnum with an array literal renders "must be one of the following values: " with nothing
  // after it -- class-validator's message helper filters numeric keys, and an array's keys are all
  // numeric. @IsIn interpolates the same array correctly. The second half of this test guards the
  // companion fix: an unknown type used to *also* report OBSERVATION_SCHEMA_INVALID, giving two
  // messages for one mistake, with the misleading one attached to `metadata`.
  it('names the valid entry types on a bad type, and reports it only once', async () => {
    const { token } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Enum Message', dateOfBirth: '2016-04-04', sexAtBirth: 'female' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/patients/${patientRes.body.id}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [{ type: 'bogus', metadata: {} }],
      })
      .expect(400);

    const messages: string[] = res.body.message;
    expect(Array.isArray(messages)).toBe(true);
    const typeMessage = messages.find((m) => m.includes('must be one of the following values'));
    expect(typeMessage).toBeDefined();
    expect(typeMessage).toContain('temperature');
    expect(typeMessage).toContain('photo');
    expect(messages.some((m) => m.includes('OBSERVATION_SCHEMA_INVALID'))).toBe(false);
  });

  it('rejects entries with unrecognized metadata fields', async () => {
    const { token } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Schema Patient 2', dateOfBirth: '2020-01-01', sexAtBirth: 'female' })
      .expect(201);
    const patientId = patientRes.body.id;

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [{ type: 'weight', metadata: { kg: 10, lbs: 22 } }],
      })
      .expect(400);
  });

  it('requires fileId on photo entries', async () => {
    const { token } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Photo Patient', dateOfBirth: '2020-01-01', sexAtBirth: 'male' })
      .expect(201);
    const patientId = patientRes.body.id;

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [{ type: 'photo', metadata: { bodyLocation: 'Left arm', side: 'left' } }],
      })
      .expect(400);

    // A shape-valid UUID naming nothing used to be accepted, and became a permanently broken image
    // in the timeline and the ER Brief. It's caught at write time now.
    const phantom = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [
          {
            type: 'photo',
            metadata: {
              fileId: '11111111-1111-4111-8111-111111111111',
              bodyLocation: 'Left arm',
              side: 'left',
            },
          },
        ],
      })
      .expect(400);
    expect(JSON.stringify(phantom.body.message)).toContain('PHOTO_FILE_NOT_FOUND');

    // A real upload for this patient works.
    const upload = await request(app.getHttpServer())
      .post('/api/files')
      .set('Authorization', `Bearer ${token}`)
      .field('patientId', patientId)
      .attach('file', Buffer.from('fake-photo-bytes'), {
        filename: 'rash.png',
        contentType: 'image/png',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [
          {
            type: 'photo',
            metadata: { fileId: upload.body.fileId, bodyLocation: 'Left arm', side: 'left' },
          },
        ],
      })
      .expect(201);

    // ...but not for a different patient, even one the same caregiver owns. Same code as the
    // phantom case, deliberately: distinguishing them would leak that the file exists.
    const otherPatient = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Other Photo Patient', dateOfBirth: '2019-01-01', sexAtBirth: 'female' })
      .expect(201);

    const crossed = await request(app.getHttpServer())
      .post(`/api/patients/${otherPatient.body.id}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [
          {
            type: 'photo',
            metadata: { fileId: upload.body.fileId, bodyLocation: 'Left arm', side: 'left' },
          },
        ],
      })
      .expect(400);
    expect(JSON.stringify(crossed.body.message)).toContain('PHOTO_FILE_NOT_FOUND');
  });

  it('round-trips lab_result metadata, hydrates labContext, and gates document entries on file ownership', async () => {
    const { token } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Lab Patient', dateOfBirth: '1987-12-30', sexAtBirth: 'male' })
      .expect(201);
    const patientId = patientRes.body.id;

    const analyte = (
      await request(app.getHttpServer())
        .post('/api/analytes')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'CORTISOL, TOTAL' })
        .expect(201)
    ).body;
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/analytes/${analyte.id}/ranges`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'Reference',
        kind: 'reference',
        refText: 'For 8 a.m. Specimen: 4.0-22.0',
        effectiveFrom: '2020-01-01T00:00:00.000Z',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/analytes/${analyte.id}/ranges`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'My target', high: 18, effectiveFrom: '2020-01-01T00:00:00.000Z' })
      .expect(201);

    // Same write-time phantom-file check as photo entries, own code (api.md → error codes).
    const phantom = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [
          { type: 'document', metadata: { fileId: '11111111-1111-4111-8111-111111111111' } },
        ],
      })
      .expect(400);
    expect(JSON.stringify(phantom.body.message)).toContain('DOCUMENT_FILE_NOT_FOUND');

    const upload = await request(app.getHttpServer())
      .post('/api/files')
      .set('Authorization', `Bearer ${token}`)
      .field('patientId', patientId)
      .attach('file', Buffer.from('%PDF-1.4 fake'), {
        filename: 'quest-labs.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    // Lab values are stored as reported. No reference-range fields: the standard lives in the
    // catalog and is attached at read time.
    const labMetadata = {
      analyteId: analyte.id,
      analyte: 'CORTISOL, TOTAL',
      valueText: '16.0',
      value: 16.0,
      unit: 'mcg/dL',
      flag: null,
      panel: 'CORTISOL, TOTAL',
    };
    const createRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [
          { type: 'lab_result', metadata: labMetadata },
          { type: 'document', metadata: { fileId: upload.body.fileId, label: 'Quest labs Jul 2026' } },
        ],
      })
      .expect(201);

    const fetched = await request(app.getHttpServer())
      .get(`/api/observations/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const lab = fetched.body.entries.find((e: any) => e.type === 'lab_result');
    expect(lab.metadata).toEqual(labMetadata); // stored exactly as written
    // ...and the catalog's standard rides alongside it, never inside it.
    expect(lab.labContext.displayName).toBe('Cortisol, Total');
    // Both lineages resolve at this observation's own observedAt — the lab's and the caregiver's.
    const reference = lab.labContext.ranges.find((r: any) => r.kind === 'reference');
    expect(reference.refText).toBe('For 8 a.m. Specimen: 4.0-22.0');
    const own = lab.labContext.ranges.find((r: any) => r.kind === 'custom');
    expect(own).toMatchObject({ label: 'My target', low: null, high: 18 });
    const doc = fetched.body.entries.find((e: any) => e.type === 'document');
    expect(doc.metadata).toEqual({ fileId: upload.body.fileId, label: 'Quest labs Jul 2026' });

    // Reference-range fields on the entry are rejected outright — a range is not measurement data.
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [
          {
            type: 'lab_result',
            metadata: { analyteId: analyte.id, analyte: 'FERRITIN', valueText: '37', refLow: 38 },
          },
        ],
      })
      .expect(400)
      .expect((res) => expect(JSON.stringify(res.body.message)).toContain('OBSERVATION_SCHEMA_INVALID'));

    // A shape-valid analyteId naming nothing is caught at write time, like a phantom fileId.
    const phantomAnalyte = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [
          {
            type: 'lab_result',
            metadata: {
              analyteId: '11111111-1111-4111-8111-111111111111',
              analyte: 'FERRITIN',
              valueText: '37',
            },
          },
        ],
      })
      .expect(400);
    expect(JSON.stringify(phantomAnalyte.body.message)).toContain('ANALYTE_NOT_FOUND');
  });

  it('accepts a valid entry for every observation type', async () => {
    const { token } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Every Type Patient', dateOfBirth: '2020-01-01', sexAtBirth: 'female' })
      .expect(201);
    const patientId = patientRes.body.id;

    const upload = await request(app.getHttpServer())
      .post('/api/files')
      .set('Authorization', `Bearer ${token}`)
      .field('patientId', patientId)
      .attach('file', Buffer.from('fake-photo-bytes'), {
        filename: 'chest.png',
        contentType: 'image/png',
      })
      .expect(201);

    const everyTypeAnalyte = (
      await request(app.getHttpServer())
        .post('/api/analytes')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'FERRITIN EVERY TYPE' })
        .expect(201)
    ).body;

    const entries = [
      { type: 'temperature', metadata: { value: 38.0, unit: 'C', method: 'oral' } },
      { type: 'heart_rate', metadata: { bpm: 110 } },
      { type: 'respiratory_rate', metadata: { breathsPerMin: 22 } },
      { type: 'oxygen_saturation', metadata: { percent: 98 } },
      { type: 'pain_score', metadata: { score: 3 } },
      { type: 'weight', metadata: { kg: 11.2 } },
      { type: 'height', metadata: { cm: 80.5 } },
      {
        type: 'lesion_size',
        metadata: { lengthCm: 2, widthCm: 1, depthCm: null, bodyLocation: 'Left shin', side: 'left' },
      },
      { type: 'symptom', metadata: { tag: 'cough', severity: 'mild' } },
      { type: 'note', metadata: { text: 'General note' } },
      { type: 'tag', metadata: { tag: 'daycare-exposure' } },
      {
        type: 'photo',
        metadata: { fileId: upload.body.fileId, bodyLocation: 'Chest', side: 'n/a' },
      },
      {
        type: 'lab_result',
        metadata: {
          analyteId: everyTypeAnalyte.id,
          analyte: 'FERRITIN',
          valueText: '37',
          value: 37,
          unit: 'ng/mL',
          flag: 'L',
          panel: 'FERRITIN',
        },
      },
      {
        type: 'document',
        metadata: { fileId: upload.body.fileId, label: 'After-visit summary' },
      },
    ];

    const createRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ observedAt: new Date().toISOString(), entries })
      .expect(201);
    expect(createRes.body.entries.length).toBe(entries.length);
  });

  it('enforces patient access and patientId match on get', async () => {
    const owner = await registerAndLogin(app);
    const other = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        fullName: 'Private Obs',
        dateOfBirth: '2018-08-08',
        sexAtBirth: 'female',
      })
      .expect(201);
    const patientId = patientRes.body.id;

    const obsRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [{ type: 'note', metadata: { text: 'Looks tired but no fever' } }],
      })
      .expect(201);
    const obsId = obsRes.body.id;

    // Other user cannot get
    await request(app.getHttpServer())
      .get(`/api/observations/${obsId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);

    // If patientId mismatches in URL, also 404
    await request(app.getHttpServer())
      .get(`/api/patients/${other.userId}/observations/${obsId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(404);
  });

  it('starts and resolves episodes via observations', async () => {
    const { token, userId } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Episode Patient',
        dateOfBirth: '2020-05-05',
        sexAtBirth: 'male',
      })
      .expect(201);
    const patientId = patientRes.body.id;

    const startRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        startEpisodeName: 'Fever',
        entries: [{ type: 'temperature', metadata: { value: 38.5, unit: 'C', method: 'oral' } }],
      })
      .expect(201);

    const episodeId = startRes.body.episodeIds[0];
    expect(episodeId).toBeDefined();

    const listEpisodes = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/episodes?status=active`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listEpisodes.body.find((e: any) => e.id === episodeId)?.status).toBe('active');

    const resolveRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [{ type: 'temperature', metadata: { value: 37.0, unit: 'C', method: 'oral' } }],
        episodeIds: [episodeId],
        resolvesEpisodeIds: [episodeId],
      })
      .expect(201);
    expect(resolveRes.body.resolvesEpisodeIds).toContain(episodeId);

    const resolvedEpisodes = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/episodes?status=resolved`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const resolved = resolvedEpisodes.body.find((e: any) => e.id === episodeId);
    expect(resolved.status).toBe('resolved');
    expect(resolved.endedAtId).toBe(resolveRes.body.id);
    expect(resolved.endedAtType).toBe('observation');
  });

  it('denormalizes a weight entry onto the patient on create', async () => {
    const { token } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Weight Patient', dateOfBirth: '2021-01-01', sexAtBirth: 'female' })
      .expect(201);
    const patientId = patientRes.body.id;

    const observedAt = new Date();
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: observedAt.toISOString(),
        entries: [{ type: 'weight', metadata: { kg: 12.5 } }],
      })
      .expect(201);

    const patientAfter = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(patientAfter.body.latestWeightKg).toBe(12.5);
    // Epoch seconds, like every other timestamp field in the API — not an ISO string.
    expect(patientAfter.body.latestWeightRecordedAt).toBe(Math.floor(observedAt.getTime() / 1000));
  });

  it('denormalizes a weight entry onto the patient when edited via update', async () => {
    const { token } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Weight Update Patient', dateOfBirth: '2021-01-01', sexAtBirth: 'male' })
      .expect(201);
    const patientId = patientRes.body.id;

    const observedAt = new Date();
    const obsRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: observedAt.toISOString(),
        entries: [{ type: 'note', metadata: { text: 'no weight yet' } }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/observations/${obsRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ entries: [{ type: 'weight', metadata: { kg: 9.1 } }] })
      .expect(200);

    const patientAfter = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(patientAfter.body.latestWeightKg).toBe(9.1);
  });

  it('does not let an older, backdated weight regress the denormalized latest weight', async () => {
    const { token } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Recency Guard Patient', dateOfBirth: '2021-01-01', sexAtBirth: 'female' })
      .expect(201);
    const patientId = patientRes.body.id;

    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Log the current (newer) weight first.
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: now.toISOString(),
        entries: [{ type: 'weight', metadata: { kg: 15.0 } }],
      })
      .expect(201);

    // Now log/correct an older observation dated last week with a smaller weight.
    const oldObsRes = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: lastWeek.toISOString(),
        entries: [{ type: 'note', metadata: { text: 'backfilling an old visit' } }],
      })
      .expect(201);

    // Backdated create should not have regressed the patient's latest weight.
    let patientAfter = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(patientAfter.body.latestWeightKg).toBe(15.0);

    // Editing that old (last-week) observation to add a weight entry must not regress it either,
    // even though yesterday's date would otherwise be newer than the observation's own date.
    await request(app.getHttpServer())
      .patch(`/api/observations/${oldObsRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ entries: [{ type: 'weight', metadata: { kg: 13.0 } }] })
      .expect(200);

    patientAfter = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(patientAfter.body.latestWeightKg).toBe(15.0);

    // A yesterday-dated weight is still newer than last week's and should also not overwrite "now".
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: yesterday.toISOString(),
        entries: [{ type: 'weight', metadata: { kg: 14.0 } }],
      })
      .expect(201);

    patientAfter = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(patientAfter.body.latestWeightKg).toBe(15.0);
  });
});

// api.md → PATCH /api/observations/:observationId; data-model.md → "Data integrity rules" →
// Corrections and Patient → "Recomputed on correction"; ISSUES #31–#37, #39.
describe('Correcting an observation (e2e)', () => {
  const HOUR = 3600;
  let app: INestApplication;
  let close: () => Promise<void>;
  let token: string;
  let userId: string;
  let patientId: string;
  const nowSec = () => Math.floor(Date.now() / 1000);
  const iso = (sec: number) => new Date(sec * 1000).toISOString();
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const server = () => app.getHttpServer();

  async function newPatient(name = 'Correction Patient') {
    return (
      await request(server())
        .post('/api/patients')
        .set(auth())
        .send({ fullName: name, dateOfBirth: '2019-01-01', sexAtBirth: 'female', myRole: 'parent' })
        .expect(201)
    ).body.id as string;
  }
  async function observe(body: Record<string, unknown>, pid = patientId) {
    return (
      await request(server())
        .post(`/api/patients/${pid}/observations`)
        .set(auth())
        .send({ observedAt: new Date().toISOString(), entries: [{ type: 'note', metadata: { text: 'x' } }], ...body })
        .expect(201)
    ).body;
  }
  const patch = (id: string, body: Record<string, unknown>, t = token) =>
    request(server()).patch(`/api/observations/${id}`).set(auth(t)).send(body);
  const revisions = async (id: string) =>
    (await request(server()).get(`/api/observations/${id}/revisions`).set(auth()).expect(200)).body as any[];
  const patient = async (pid = patientId) =>
    (await request(server()).get(`/api/patients/${pid}`).set(auth()).expect(200)).body;
  const episode = async (id: string) =>
    (await request(server()).get(`/api/episodes/${id}`).set(auth()).expect(200)).body;

  beforeAll(async () => {
    ({ app, close } = await createTestApp('observation-corrections'));
    ({ token, userId } = await registerAndLogin(app));
    patientId = await newPatient();
  });

  afterAll(async () => {
    await close();
  });

  it('corrects the clinical time, and the timeline re-sorts on it', async () => {
    const t0 = nowSec();
    const older = await observe({ observedAt: iso(t0 - 3 * HOUR), text: 'older' });
    const newer = await observe({ observedAt: iso(t0 - 2 * HOUR), text: 'newer' });

    const res = await patch(older.id, { observedAt: iso(t0 - HOUR) }).expect(200);
    expect(res.body.observedAt).toBe(t0 - HOUR);
    expect(res.body.text).toBe('older'); // omitted fields are left as they are

    const timeline = await request(server()).get(`/api/patients/${patientId}/timeline`).set(auth()).expect(200);
    const ids = timeline.body.entries.map((e: any) => e.id);
    expect(ids.indexOf(older.id)).toBeLessThan(ids.indexOf(newer.id));
  });

  it('refuses a corrected time in the future', async () => {
    const obs = await observe({});
    const res = await patch(obs.id, { observedAt: iso(nowSec() + 2 * HOUR) }).expect(400);
    expect(JSON.stringify(res.body.message)).toContain('DATE_IN_FUTURE');
  });

  it('recomputes latestWeightKg downward and to null when a weight entry is corrected, backdated or removed', async () => {
    const pid = await newPatient('Weight Correction Patient');
    const t0 = nowSec();
    const older = await observe({ observedAt: iso(t0 - 5 * HOUR), entries: [{ type: 'weight', metadata: { kg: 14 } }] }, pid);
    const newest = await observe({ observedAt: iso(t0 - HOUR), entries: [{ type: 'weight', metadata: { kg: 41 } }] }, pid);
    expect((await patient(pid)).latestWeightKg).toBe(41);

    // A mistyped newest weight corrected down.
    await patch(newest.id, { entries: [{ id: newest.entries[0].id, type: 'weight', metadata: { kg: 15 } }] }).expect(200);
    expect((await patient(pid)).latestWeightKg).toBe(15);

    // Backdated before the older one: the older weight is now the newest.
    await patch(newest.id, { observedAt: iso(t0 - 10 * HOUR) }).expect(200);
    let p = await patient(pid);
    expect(p.latestWeightKg).toBe(14);
    expect(p.latestWeightRecordedAt).toBe(t0 - 5 * HOUR);

    // The older one's weight removed: back to the backdated one.
    await patch(older.id, { entries: [{ type: 'note', metadata: { text: 'not a weight after all' } }] }).expect(200);
    p = await patient(pid);
    expect(p.latestWeightKg).toBe(15);
    expect(p.latestWeightRecordedAt).toBe(t0 - 10 * HOUR);

    // The last weight removed: null, both fields.
    await patch(newest.id, { entries: [{ type: 'note', metadata: { text: 'no weight' } }] }).expect(200);
    p = await patient(pid);
    expect(p.latestWeightKg).toBeNull();
    expect(p.latestWeightRecordedAt).toBeNull();
  });

  it('keeps an echoed entry id, and never adopts another observation\'s entry id', async () => {
    const a = await observe({ entries: [{ type: 'heart_rate', metadata: { bpm: 100 } }] });
    const b = await observe({ entries: [{ type: 'heart_rate', metadata: { bpm: 90 } }] });
    const res = await patch(a.id, {
      entries: [
        { id: a.entries[0].id, type: 'heart_rate', metadata: { bpm: 101 } },
        { id: b.entries[0].id, type: 'pain_score', metadata: { score: 3 } },
      ],
    }).expect(200);
    expect(res.body.entries.find((e: any) => e.type === 'heart_rate').id).toBe(a.entries[0].id);
    expect(res.body.entries.find((e: any) => e.type === 'pain_score').id).not.toBe(b.entries[0].id);
    const bAfter = await request(server()).get(`/api/observations/${b.id}`).set(auth()).expect(200);
    expect(bAfter.body.entries).toEqual(b.entries);
  });

  it('round-trips lab_result and document entries (ISSUES #32)', async () => {
    const analyte = (
      await request(server()).post('/api/analytes').set(auth()).send({ name: `FERRITIN ${Math.random()}` }).expect(201)
    ).body;
    const upload = await request(server())
      .post('/api/files')
      .set(auth())
      .field('patientId', patientId)
      .attach('file', Buffer.from('%PDF-1.4 fake'), { filename: 'labs.pdf', contentType: 'application/pdf' })
      .expect(201);
    const lab = { analyteId: analyte.id, analyte: 'FERRITIN', valueText: '40', value: 40, unit: 'ng/mL', flag: null, panel: 'IRON' };
    const created = await observe({
      entries: [
        { type: 'lab_result', metadata: lab },
        { type: 'document', metadata: { fileId: upload.body.fileId, label: 'Labs' } },
      ],
    });
    // Echo exactly what the client has, minus the read-only labContext.
    const echoed = created.entries.map(({ labContext, ...e }: any) => e);
    const res = await patch(created.id, { entries: echoed, text: 'checked' }).expect(200);
    expect(res.body.entries.map(({ labContext, ...e }: any) => e)).toEqual(echoed);
    expect(res.body.text).toBe('checked');
  });

  it('refuses to remove the last entry', async () => {
    const obs = await observe({});
    const res = await patch(obs.id, { entries: [] }).expect(400);
    expect(res.body.message).toBe('AT_LEAST_ONE_ENTRY_REQUIRED');
    expect(await revisions(obs.id)).toEqual([]);
  });

  it.each([
    ['unitPreferenceAtEntry', { temp: 'F', weight: 'lb', length: 'in' }],
    ['recordedByUserId', '11111111-1111-4111-8111-111111111111'],
    ['createdAt', 1700000000],
    ['startEpisodeName', 'New frame'],
    ['startEpisodeConditionId', '11111111-1111-4111-8111-111111111111'],
  ])('refuses %s with FIELD_NOT_CORRECTABLE, naming it', async (field, value) => {
    const obs = await observe({});
    const res = await patch(obs.id, { text: 'also this', [field]: value }).expect(400);
    expect(res.body.message).toBe('FIELD_NOT_CORRECTABLE');
    expect(res.body.fields).toEqual([field]);
    const after = await request(server()).get(`/api/observations/${obs.id}`).set(auth()).expect(200);
    expect(after.body.text).toBeNull();
    expect(await revisions(obs.id)).toEqual([]);
  });

  it('reopens an episode when its resolve link is dropped', async () => {
    const start = await observe({ observedAt: iso(nowSec() - 3 * HOUR), startEpisodeName: 'Fever reopen' });
    const episodeId = start.episodeIds[0];
    const end = await observe({ episodeIds: [episodeId], resolvesEpisodeIds: [episodeId] });
    expect((await episode(episodeId)).status).toBe('resolved');

    const res = await patch(end.id, { resolvesEpisodeIds: [] }).expect(200);
    expect(res.body.episodeIds).toEqual([episodeId]);
    expect(res.body.resolvesEpisodeIds).toEqual([]);
    const ep = await episode(episodeId);
    expect(ep.status).toBe('active');
    expect(ep.endedAtId ?? null).toBeNull();
  });

  it('refuses to unlink the episode an observation started', async () => {
    const start = await observe({ startEpisodeName: 'Started here' });
    const res = await patch(start.id, { episodeIds: [] }).expect(400);
    expect(res.body.message).toBe('CANNOT_UNLINK_STARTED_EPISODE');
  });

  it('refuses a time that would end an episode before it starts, and writes nothing', async () => {
    const t0 = nowSec();
    const start = await observe({ observedAt: iso(t0 - 3 * HOUR), startEpisodeName: 'Ordered frame' });
    const episodeId = start.episodeIds[0];
    const end = await observe({ observedAt: iso(t0 - 2 * HOUR), episodeIds: [episodeId], resolvesEpisodeIds: [episodeId] });

    const res = await patch(end.id, { observedAt: iso(t0 - 4 * HOUR), text: 'moved' }).expect(400);
    expect(res.body.message).toBe('EPISODE_TIME_ORDER_INVALID');
    const after = await request(server()).get(`/api/observations/${end.id}`).set(auth()).expect(200);
    expect(after.body.observedAt).toBe(t0 - 2 * HOUR);
    expect(after.body.text).toBeNull();
    expect(await revisions(end.id)).toEqual([]);

    await patch(start.id, { observedAt: iso(t0 - HOUR) }).expect(400);
  });

  it('re-checks protocols on a corrected value, and does not fire the same protocol twice (ISSUES #37)', async () => {
    const pid = await newPatient('Protocol Correction Patient');
    const cond = await request(server()).post(`/api/patients/${pid}/conditions`).set(auth()).send({ name: 'Port' }).expect(201);
    await request(server())
      .post(`/api/conditions/${cond.body.id}/protocols`)
      .set(auth())
      .send({
        name: 'Fever with port',
        triggerMetric: 'temperature',
        triggerOperator: 'gte',
        triggerValue: 38.5,
        instructionText: 'ER now',
        sourceText: 'Oncology',
      })
      .expect(201);
    const obs = await observe({ entries: [{ type: 'temperature', metadata: { value: 38.0, unit: 'C', method: 'oral' } }] }, pid);
    expect(obs.firedAdvisories).toBeUndefined();

    // A notes-only correction re-checks nothing.
    const notes = await patch(obs.id, { text: 'felt warm' }).expect(200);
    expect(notes.body.firedAdvisories).toBeUndefined();

    const tripped = await patch(obs.id, {
      entries: [{ id: obs.entries[0].id, type: 'temperature', metadata: { value: 40.0, unit: 'C', method: 'oral' } }],
    }).expect(200);
    expect(tripped.body.firedAdvisories).toHaveLength(1);
    expect(tripped.body.firedAdvisories[0].type).toBe('protocol_fired');
    expect(tripped.body.firedAdvisories[0].contextId).toBe(obs.id);

    // Still tripping after a second correction: no second advisory.
    const again = await patch(obs.id, {
      entries: [{ id: obs.entries[0].id, type: 'temperature', metadata: { value: 40.2, unit: 'C', method: 'oral' } }],
    }).expect(200);
    expect(again.body.firedAdvisories).toBeUndefined();

    // Corrected back below the trigger: the advisory stays, nothing new is written.
    await patch(obs.id, {
      entries: [{ id: obs.entries[0].id, type: 'temperature', metadata: { value: 37.0, unit: 'C', method: 'oral' } }],
    }).expect(200);
    const list = await request(server()).get(`/api/patients/${pid}/advisories`).set(auth()).expect(200);
    expect(list.body.filter((a: any) => a.type === 'protocol_fired' && a.contextId === obs.id)).toHaveLength(1);
  });

  it('writes nothing, the revision included, when the transaction fails partway (ISSUES #39)', async () => {
    const pid = await newPatient('Atomic Patient');
    const obs = await observe({ entries: [{ type: 'weight', metadata: { kg: 20 } }], text: 'before' }, pid);
    const episodesService = app.get(EpisodesService);
    const spy = jest
      .spyOn(episodesService, 'applyEventEpisodeCorrection')
      .mockRejectedValueOnce(new Error('simulated failure inside the transaction'));
    try {
      await patch(obs.id, { text: 'after', entries: [{ type: 'weight', metadata: { kg: 9 } }] }).expect(500);
    } finally {
      spy.mockRestore();
    }
    const after = await request(server()).get(`/api/observations/${obs.id}`).set(auth()).expect(200);
    expect(after.body.text).toBe('before');
    expect(after.body.entries).toEqual(obs.entries);
    expect((await patient(pid)).latestWeightKg).toBe(20);
    expect(await revisions(obs.id)).toEqual([]);
  });

  it('captures exactly one revision holding the pre-correction state', async () => {
    const obs = await observe({ text: 'original' });
    await patch(obs.id, { text: 'corrected' }).expect(200);
    const revs = await revisions(obs.id);
    expect(revs).toHaveLength(1);
    expect(revs[0].snapshot.text).toBe('original');
    expect(revs[0].editedByUserId).toBe(userId);
  });

  it('404s a non-member, and lets any care team member correct any entry', async () => {
    const obs = await observe({ text: 'by the owner' });
    const outsider = await registerAndLogin(app);
    const denied = await patch(obs.id, { text: 'nope' }, outsider.token).expect(404);
    expect(denied.body.message).toBe('PATIENT_NOT_FOUND');

    const helper = await registerAndLogin(app);
    await request(server())
      .post(`/api/patients/${patientId}/care-team`)
      .set(auth())
      .send({ userId: helper.userId, role: 'babysitter' })
      .expect(201);
    const res = await patch(obs.id, { text: 'fixed by the babysitter' }, helper.token).expect(200);
    expect(res.body.text).toBe('fixed by the babysitter');
    expect(res.body.recordedByUserId).toBe(userId); // attribution stays with the recorder
    const revs = await revisions(obs.id);
    expect(revs[0].editedByUserId).toBe(helper.userId);
  });
});
