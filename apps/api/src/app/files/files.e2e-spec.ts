import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { DatabaseService } from '../persistence/database.service';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

async function registerAndLogin(app: INestApplication) {
  const email = `files-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: 'Files User' });
  return { token: reg.body.token, userId: reg.body.user.id };
}

describe('Files (e2e)', () => {
  let app: INestApplication;
  let tmpDir: string;
  let token: string;
  let patientId: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-files-'));
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
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
