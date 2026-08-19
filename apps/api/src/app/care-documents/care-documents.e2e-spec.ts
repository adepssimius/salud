import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../testing/create-test-app';

async function registerAndLogin(app: INestApplication, label: string) {
  const email = `caredoc-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: `Care Doc ${label}` });
  return { token: reg.body.token, userId: reg.body.user.id };
}

describe('Care documents (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let token: string;
  let userId: string;
  let patientId: string;
  let fileId: string;

  async function uploadFile(forPatientId: string, authToken = token) {
    const res = await request(app.getHttpServer())
      .post('/api/files')
      .set('Authorization', `Bearer ${authToken}`)
      .field('patientId', forPatientId)
      .attach('file', Buffer.from('%PDF-1.4 living will'), {
        filename: 'living-will.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    return res.body.fileId;
  }

  beforeAll(async () => {
    ({ app, close } = await createTestApp('care-documents'));
    const auth = await registerAndLogin(app, 'owner');
    token = auth.token;
    userId = auth.userId;

    const patient = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Doc Patient', dateOfBirth: '2016-05-05', sexAtBirth: 'male', myRole: 'parent' })
      .expect(201);
    patientId = patient.body.id;
    fileId = await uploadFile(patientId);
  });

  afterAll(async () => {
    await close();
  });

  // The tri-state's whole point: absence of a record is not a statement that none exists.
  it('starts with all three kinds null — "not recorded", not "none"', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/care-documents`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({ livingWill: null, advanceDirective: null, medicalPoa: null });
  });

  it('records an affirmative "none" as an attributed statement, distinct from null', async () => {
    const res = await request(app.getHttpServer())
      .put(`/api/patients/${patientId}/care-documents/advance_directive`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'none' })
      .expect(200);

    expect(res.body.advanceDirective).toMatchObject({
      kind: 'advance_directive',
      status: 'none',
      fileId: null,
      setByUserId: userId,
      setByName: 'Care Doc owner',
    });
    expect(typeof res.body.advanceDirective.setAt).toBe('number');
    // Untouched kinds stay null — recording one says nothing about the others.
    expect(res.body.livingWill).toBeNull();
    expect(res.body.medicalPoa).toBeNull();
  });

  it('records an on-file document with its name and content type', async () => {
    const res = await request(app.getHttpServer())
      .put(`/api/patients/${patientId}/care-documents/living_will`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'on_file', fileId })
      .expect(200);

    expect(res.body.livingWill).toMatchObject({
      kind: 'living_will',
      status: 'on_file',
      fileId,
      originalName: 'living-will.pdf',
      contentType: 'application/pdf',
    });
  });

  it('keeps PoA holder details, and rejects them on the other kinds', async () => {
    const poa = await request(app.getHttpServer())
      .put(`/api/patients/${patientId}/care-documents/medical_poa`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'none', holderName: 'Aunt Ada', holderPhone: '555-0100' })
      .expect(200);
    expect(poa.body.medicalPoa).toMatchObject({ holderName: 'Aunt Ada', holderPhone: '555-0100' });

    // Rejected rather than silently dropped — the caller must not believe it stored a contact.
    await request(app.getHttpServer())
      .put(`/api/patients/${patientId}/care-documents/living_will`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'on_file', fileId, holderName: 'Aunt Ada' })
      .expect(400);
  });

  it('enforces the status/fileId pairing in both directions', async () => {
    await request(app.getHttpServer())
      .put(`/api/patients/${patientId}/care-documents/living_will`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'on_file' })
      .expect(400);

    await request(app.getHttpServer())
      .put(`/api/patients/${patientId}/care-documents/living_will`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'none', fileId })
      .expect(400);
  });

  it('rejects an unknown kind rather than storing an unreadable statement', async () => {
    await request(app.getHttpServer())
      .put(`/api/patients/${patientId}/care-documents/last_will`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'none' })
      .expect(400);
  });

  // Write-side reference check: a broken fileId is caught here, not discovered at triage.
  it('rejects a fileId belonging to another patient with CARE_DOCUMENT_FILE_NOT_FOUND', async () => {
    const other = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Other Patient', dateOfBirth: '2019-02-02', sexAtBirth: 'female', myRole: 'parent' })
      .expect(201);
    const otherFileId = await uploadFile(other.body.id);

    const res = await request(app.getHttpServer())
      .put(`/api/patients/${patientId}/care-documents/living_will`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'on_file', fileId: otherFileId })
      .expect(400);
    expect(res.body.message).toBe('CARE_DOCUMENT_FILE_NOT_FOUND');

    const missing = await request(app.getHttpServer())
      .put(`/api/patients/${patientId}/care-documents/living_will`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'on_file', fileId: '00000000-0000-4000-8000-000000000000' })
      .expect(400);
    expect(missing.body.message).toBe('CARE_DOCUMENT_FILE_NOT_FOUND');
  });

  // Append-only: superseding a statement must not destroy what was stated before, or when.
  it('appends rather than updates, so history keeps every prior statement', async () => {
    const kindPath = `/api/patients/${patientId}/care-documents/medical_poa`;
    await request(app.getHttpServer())
      .put(kindPath)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'on_file', fileId, holderName: 'Uncle Bob' })
      .expect(200);

    const history = await request(app.getHttpServer())
      .get(`${kindPath}/history`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Newest first: the 'on_file' statement just written, then the earlier 'none'.
    expect(history.body.length).toBeGreaterThanOrEqual(2);
    expect(history.body[0]).toMatchObject({ status: 'on_file', holderName: 'Uncle Bob' });
    expect(history.body.some((s: any) => s.status === 'none' && s.holderName === 'Aunt Ada')).toBe(true);
  });

  /**
   * Ordering must survive two writes inside the same second.
   *
   * SQLite stores timestamps as integer seconds, so back-to-back statements share a `setAt` and
   * ordering on the clock is a coin flip — between a document and the statement that superseded
   * it, on a surface the ER Brief shows to triage. Postgres's microsecond precision hides the bug,
   * which is why this test matters on the SQLite leg specifically.
   */
  it('keeps the last write current when two statements land in the same second', async () => {
    const kindPath = `/api/patients/${patientId}/care-documents/living_will`;

    await request(app.getHttpServer())
      .put(kindPath)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'on_file', fileId })
      .expect(200);

    // Immediately corrected — a caregiver fixing a mis-click, the realistic same-second case.
    const corrected = await request(app.getHttpServer())
      .put(kindPath)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'none' })
      .expect(200);

    expect(corrected.body.livingWill.status).toBe('none');

    const reread = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/care-documents`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(reread.body.livingWill.status).toBe('none');

    const history = await request(app.getHttpServer())
      .get(`${kindPath}/history`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(history.body[0].status).toBe('none');
    expect(history.body[1].status).toBe('on_file');
  });

  it('404s every route for a caregiver who is not on the care team', async () => {
    const stranger = await registerAndLogin(app, 'stranger');

    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/care-documents`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);

    await request(app.getHttpServer())
      .put(`/api/patients/${patientId}/care-documents/living_will`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ status: 'none' })
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/care-documents/living_will/history`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get(`/api/patients/${patientId}/care-documents`).expect(401);
  });
});
