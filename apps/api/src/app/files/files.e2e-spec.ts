import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { createTestApp } from '../../testing/create-test-app';

async function registerAndLogin(app: INestApplication) {
  const email = `files-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: 'Files User' });
  return { token: reg.body.token, userId: reg.body.user.id };
}

describe('Files (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;
  let token: string;
  let patientId: string;

  beforeAll(async () => {
    ({ app, close } = await createTestApp('files'));

    const auth = await registerAndLogin(app);
    token = auth.token;

    const patient = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Files Patient', dateOfBirth: '2019-01-01', sexAtBirth: 'male', myRole: 'parent' })
      .expect(201);
    patientId = patient.body.id;
  });

  afterAll(async () => {
    await close();
  });

  it('uploads a file via multipart and streams it back byte-for-byte', async () => {
    const bytes = Buffer.from('fake-png-bytes-for-a-rash-photo');

    const upload = await request(app.getHttpServer())
      .post('/api/files')
      .set('Authorization', `Bearer ${token}`)
      .field('patientId', patientId)
      .attach('file', bytes, { filename: 'rash.png', contentType: 'image/png' })
      .expect(201);

    expect(upload.body.fileId).toBeTruthy();
    expect(upload.body.url).toBe(`/api/files/${upload.body.fileId}`);

    const download = await request(app.getHttpServer())
      .get(`/api/files/${upload.body.fileId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(download.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(download.body, bytes)).toBe(0);
  });

  it('lists a patient\'s files with originalName, newest first, and 404s for non-members', async () => {
    const upload = await request(app.getHttpServer())
      .post('/api/files')
      .set('Authorization', `Bearer ${token}`)
      .field('patientId', patientId)
      .attach('file', Buffer.from('%PDF-1.4 fake-lab-report'), {
        filename: 'Quest_Labs_Jul2026.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/files`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    const row = list.body.find((f: any) => f.id === upload.body.fileId);
    expect(row).toBeDefined();
    expect(row.originalName).toBe('Quest_Labs_Jul2026.pdf');
    expect(row.contentType).toBe('application/pdf');
    expect(typeof row.sizeBytes).toBe('number');
    expect(typeof row.createdAt).toBe('number'); // epoch seconds, per Conventions

    // Non-member: 404 PATIENT_NOT_FOUND, same non-leak shape as every patient-scoped read.
    const outsider = await registerAndLogin(app);
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/files`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(404);
  });

  // The surface is content-agnostic by design (api.md → Files): nothing about it is image- or
  // PDF-specific, and the local/s3 drivers both store opaque bytes. This is the regression guard
  // for anyone tempted to add a MIME allowlist at the controller.
  it('round-trips an arbitrary non-image, non-PDF file with its content type intact', async () => {
    const bytes = Buffer.from('date,weight_kg\n2026-08-18,18.4\n');

    const upload = await request(app.getHttpServer())
      .post('/api/files')
      .set('Authorization', `Bearer ${token}`)
      .field('patientId', patientId)
      .attach('file', bytes, { filename: 'weights.csv', contentType: 'text/csv' })
      .expect(201);

    const download = await request(app.getHttpServer())
      .get(`/api/files/${upload.body.fileId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    // Express appends `; charset=utf-8` to text/* types on its way out, so match the prefix.
    // The stored value is the uploaded one verbatim, as the listing assertion below shows.
    expect(download.headers['content-type']).toMatch(/^text\/csv/);
    // Superagent parses a text/* response into `text` rather than buffering it, unlike the
    // image/pdf cases above — the byte-for-byte check is the same, just off a different field.
    expect(download.text).toBe(bytes.toString());

    const list = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/files`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.find((f: any) => f.id === upload.body.fileId).contentType).toBe('text/csv');
  });

  // Multer's 20 MB limit answers with framework prose and no error code — api.md → Error codes
  // lists it among the three surfaces clients must recognize by shape rather than code-match.
  it('rejects an upload over the 20 MB limit with a 413', async () => {
    const tooBig = Buffer.alloc(20 * 1024 * 1024 + 1, 0);

    await request(app.getHttpServer())
      .post('/api/files')
      .set('Authorization', `Bearer ${token}`)
      .field('patientId', patientId)
      .attach('file', tooBig, { filename: 'huge.bin', contentType: 'application/octet-stream' })
      .expect(413);
  });

  it('rejects an upload with no patientId', async () => {
    await request(app.getHttpServer())
      .post('/api/files')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('x'), { filename: 'x.png', contentType: 'image/png' })
      .expect(400);
  });

  it('rejects an upload with no file', async () => {
    await request(app.getHttpServer())
      .post('/api/files')
      .set('Authorization', `Bearer ${token}`)
      .field('patientId', patientId)
      .expect(400);
  });

  it('404s identically for a missing file and one owned by another patient (no access leak)', async () => {
    const missing = await request(app.getHttpServer())
      .get('/api/files/11111111-1111-4111-8111-111111111111')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    expect(missing.body.message).toBe('FILE_NOT_FOUND');

    const other = await registerAndLogin(app);
    const upload = await request(app.getHttpServer())
      .post('/api/files')
      .set('Authorization', `Bearer ${token}`)
      .field('patientId', patientId)
      .attach('file', Buffer.from('y'), { filename: 'y.png', contentType: 'image/png' })
      .expect(201);

    const forbidden = await request(app.getHttpServer())
      .get(`/api/files/${upload.body.fileId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
    expect(forbidden.body.message).toBe('PATIENT_NOT_FOUND');
  });

  it('requires authentication to upload or stream', async () => {
    await request(app.getHttpServer())
      .post('/api/files')
      .field('patientId', patientId)
      .attach('file', Buffer.from('z'), { filename: 'z.png', contentType: 'image/png' })
      .expect(401);

    await request(app.getHttpServer()).get('/api/files/11111111-1111-4111-8111-111111111111').expect(401);
  });
});
