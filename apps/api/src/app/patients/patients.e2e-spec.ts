import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { AppModule } from '../app.module';

async function registerAndLogin(app: INestApplication) {
  const email = `pt-${Date.now()}@example.com`;
  const password = 'password123';

  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({
      email,
      password,
      displayName: 'Patient Owner',
    });
  return { token: reg.body.token, email, userId: reg.body.user.id };
}

describe('Patients (e2e)', () => {
  let app: INestApplication;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-patients-'));
    process.env.DATA_DIR = tmpDir;
    process.env.DB_CLIENT = 'sqlite';
    process.env.JWT_SECRET = 'test-secret';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates, lists, gets, and updates a patient', async () => {
    const { token, userId } = await registerAndLogin(app);

    const createRes = await request(app.getHttpServer())
      .post(`/api/users/${userId}/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Alice Smith',
        dateOfBirth: '2018-01-01',
        sexAtBirth: 'female',
        notes: 'Initial notes',
        myRole: 'grandparent',
      })
      .expect(201);

    const patientId = createRes.body.id;
    expect(patientId).toBeDefined();

    const listRes = await request(app.getHttpServer())
      .get(`/api/users/${userId}/patients`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listRes.body.length).toBeGreaterThan(0);
    expect(listRes.body[0].myRole).toBe('grandparent');

    const getRes = await request(app.getHttpServer())
      .get(`/api/users/${userId}/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(getRes.body.fullName).toBe('Alice Smith');
    expect(getRes.body.myRole).toBe('grandparent');

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/users/${userId}/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'Updated notes' })
      .expect(200);
    expect(patchRes.body.notes).toBe('Updated notes');
  });

  it('cannot access a patient without relationship', async () => {
    const owner = await registerAndLogin(app);
    const other = await registerAndLogin(app);

    const createRes = await request(app.getHttpServer())
      .post(`/api/users/${owner.userId}/patients`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        fullName: 'Private Patient',
        dateOfBirth: '2020-01-01',
        sexAtBirth: 'female',
        myRole: 'parent',
      })
      .expect(201);

    const patientId = createRes.body.id;

    // Other user should not see in list
    const listRes = await request(app.getHttpServer())
      .get(`/api/users/${other.userId}/patients`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(200);
    expect(listRes.body.find((p: any) => p.id === patientId)).toBeUndefined();

    // Other user should get 404 on get (resource not found for them)
    await request(app.getHttpServer())
      .get(`/api/users/${other.userId}/patients/${patientId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
  });

  it('returns the correct patient when creating multiple patients sequentially', async () => {
    const { token, userId } = await registerAndLogin(app);

    const first = await request(app.getHttpServer())
      .post(`/api/users/${userId}/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'First Patient',
        dateOfBirth: '2015-01-01',
        sexAtBirth: 'male',
      })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(`/api/users/${userId}/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Second Patient',
        dateOfBirth: '2016-02-02',
        sexAtBirth: 'female',
      })
      .expect(201);

    expect(first.body.id).not.toBe(second.body.id);
    expect(second.body.fullName).toBe('Second Patient');
  });

  it('rejects malformed patient id', async () => {
    const { token, userId } = await registerAndLogin(app);
    await request(app.getHttpServer())
      .get(`/api/users/${userId}/patients/not-a-uuid`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('deletes a patient', async () => {
    const { token, userId } = await registerAndLogin(app);

    const createRes = await request(app.getHttpServer())
      .post(`/api/users/${userId}/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Delete Me',
        dateOfBirth: '2017-03-03',
        sexAtBirth: 'male',
      })
      .expect(201);

    const patientId = createRes.body.id;

    await request(app.getHttpServer())
      .delete(`/api/users/${userId}/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/users/${userId}/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
