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
  const email = `pt-${Date.now()}@example.com`;
  const password = 'password123';
  const displayName = 'Patient Owner';

  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({
      email,
      password,
      displayName,
    });
  return { token: reg.body.token, email, userId: reg.body.user.id, displayName };
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
    app.setGlobalPrefix('api');
    // Run migrations against the temp sqlite db
    const dbService = app.get(DatabaseService);
    await migrate((dbService as any).db, {
      migrationsFolder: path.join(process.cwd(), 'apps/api/src/db/migrations/sqlite'),
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates, lists, gets, and updates a patient', async () => {
    const { token, userId } = await registerAndLogin(app);

    const createRes = await request(app.getHttpServer())
      .post(`/api/patients`)
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
      .get(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listRes.body.length).toBeGreaterThan(0);
    expect(listRes.body[0].myRole).toBe('grandparent');

    const getRes = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(getRes.body.fullName).toBe('Alice Smith');
    expect(getRes.body.myRole).toBe('grandparent');

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'Updated notes' })
      .expect(200);
    expect(patchRes.body.notes).toBe('Updated notes');
  });

  it('cannot access a patient without relationship', async () => {
    const owner = await registerAndLogin(app);
    const other = await registerAndLogin(app);

    const createRes = await request(app.getHttpServer())
      .post(`/api/patients`)
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
      .get(`/api/patients`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(200);
    expect(listRes.body.find((p: any) => p.id === patientId)).toBeUndefined();

    // Other user should get 404 on get (resource not found for them)
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
  });

  it('returns the correct patient when creating multiple patients sequentially', async () => {
    const { token, userId } = await registerAndLogin(app);

    const first = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'First Patient',
        dateOfBirth: '2015-01-01',
        sexAtBirth: 'male',
      })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(`/api/patients`)
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
      .get(`/api/patients/not-a-uuid`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('rejects access to patients belonging to another user (list/get/patch/delete)', async () => {
    const owner = await registerAndLogin(app);
    const other = await registerAndLogin(app);

    const createRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        fullName: 'No Access',
        dateOfBirth: '2013-03-03',
        sexAtBirth: 'female',
        myRole: 'parent',
      })
      .expect(201);
    const patientId = createRes.body.id;

    // list under other user should not include
    const listRes = await request(app.getHttpServer())
      .get(`/api/patients`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(200);
    expect(listRes.body.find((p: any) => p.id === patientId)).toBeUndefined();

    // get/patch/delete under other user should 404
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ fullName: 'Should Fail' })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
  });

  it('rejects valid-but-nonexistent patient id with 404', async () => {
    const { token, userId } = await registerAndLogin(app);
    const nonexistent = '00000000-0000-4000-8000-000000000000';
    await request(app.getHttpServer())
      .get(`/api/patients/${nonexistent}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('allows specifying non-default roles including self', async () => {
    const { token, userId } = await registerAndLogin(app);
    const roles = ['self', 'co-parent', 'nanny', 'grandparent', 'babysitter', 'other'];
    for (const role of roles) {
      const res = await request(app.getHttpServer())
        .post(`/api/patients`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          fullName: `Role ${role}`,
          dateOfBirth: '2012-01-01',
          sexAtBirth: 'male',
          myRole: role,
        })
        .expect(201);
      expect(res.body.myRole).toBe(role);
    }
  });

  it('list returns myRole and includes multiple patients', async () => {
    const { token, userId } = await registerAndLogin(app);
    await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'List A',
        dateOfBirth: '2011-01-01',
        sexAtBirth: 'male',
        myRole: 'parent',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'List B',
        dateOfBirth: '2010-02-02',
        sexAtBirth: 'female',
        myRole: 'co-parent',
      })
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listRes.body.length).toBeGreaterThanOrEqual(2);
    expect(listRes.body.every((p: any) => p.myRole)).toBeTruthy();
  });

  it('deletes a patient', async () => {
    const { token, userId } = await registerAndLogin(app);

    const createRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Delete Me',
        dateOfBirth: '2017-03-03',
        sexAtBirth: 'male',
      })
      .expect(201);

    const patientId = createRes.body.id;

    await request(app.getHttpServer())
      .delete(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('lists initial care team and allows adding another caregiver', async () => {
    const owner = await registerAndLogin(app);
    const other = await registerAndLogin(app);

    const createRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        fullName: 'Care Team Patient',
        dateOfBirth: '2013-05-05',
        sexAtBirth: 'female',
        myRole: 'parent',
      })
      .expect(201);

    const patientId = createRes.body.id;

    const listInitial = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/care-team`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(listInitial.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user: expect.objectContaining({
            id: owner.userId,
            email: owner.email,
            displayName: owner.displayName,
          }),
          role: 'parent',
        }),
      ]),
    );

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/care-team`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: other.userId, role: 'nanny' })
      .expect(201);

    // remove caregiver
    await request(app.getHttpServer())
      .delete(`/api/patients/${patientId}/care-team/${other.userId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.deleted).toBe(true);
      });

    const listAfterRemoval = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/care-team`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(listAfterRemoval.body.find((m: any) => m.user.id === other.userId)).toBeUndefined();

    // cannot remove owner
    await request(app.getHttpServer())
      .delete(`/api/patients/${patientId}/care-team/${owner.userId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(400);

    const listAfter = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/care-team`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(listAfter.body.find((m: any) => m.user.id === owner.userId)).toBeDefined();
    expect(listAfter.body.find((m: any) => m.user.id === other.userId)).toBeUndefined();

    // other (non-member) user still blocked from managing care team
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/care-team`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
  });

  it('prevents removing the owner from the care team', async () => {
    const owner = await registerAndLogin(app);
    const createRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        fullName: 'Owner Protected',
        dateOfBirth: '2014-06-06',
        sexAtBirth: 'male',
        myRole: 'parent',
      })
      .expect(201);
    const patientId = createRes.body.id;

    await request(app.getHttpServer())
      .delete(`/api/patients/${patientId}/care-team/${owner.userId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(400);

    const list = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/care-team`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(list.body.find((m: any) => m.user.id === owner.userId)).toBeDefined();
  });

  it('allows changing the owner and blocks deleting the new owner', async () => {
    const owner = await registerAndLogin(app);
    const newOwner = await registerAndLogin(app);

    const createRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        fullName: 'Transfer Patient',
        dateOfBirth: '2012-08-08',
        sexAtBirth: 'female',
        myRole: 'parent',
      })
      .expect(201);
    const patientId = createRes.body.id;

    // add new owner to care team first
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/care-team`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: newOwner.userId, role: 'parent' })
      .expect(201);

    const updated = await request(app.getHttpServer())
      .patch(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ ownedById: newOwner.userId })
      .expect(200);
    expect(updated.body.ownedById).toBe(newOwner.userId);

    // new owner remains protected from deletion
    await request(app.getHttpServer())
      .delete(`/api/patients/${patientId}/care-team/${newOwner.userId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(400);
  });

  it('prevents multiple self relationships on a care team', async () => {
    const owner = await registerAndLogin(app);
    const self1 = await registerAndLogin(app);
    const self2 = await registerAndLogin(app);

    const createRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        fullName: 'Single Self Patient',
        dateOfBirth: '2013-05-05',
        sexAtBirth: 'female',
        myRole: 'parent',
      })
      .expect(201);

    const patientId = createRes.body.id;

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/care-team`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: self1.userId, role: 'self' })
      .expect(201)
      .expect((res) => {
        expect(res.body.role).toBe('self');
      });

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/care-team`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: self2.userId, role: 'self' })
      .expect(400);

    const list = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/care-team`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    const selfCount = list.body.filter((m: any) => m.role === 'self').length;
    expect(selfCount).toBe(1);
  });

  it('blocks a second self when patient was created with self role', async () => {
    const selfOwner = await registerAndLogin(app);
    const anotherSelf = await registerAndLogin(app);

    const createRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${selfOwner.token}`)
      .send({
        fullName: 'Self Created',
        dateOfBirth: '2011-02-02',
        sexAtBirth: 'male',
        myRole: 'self',
      })
      .expect(201);
    const patientId = createRes.body.id;

    // second self should be rejected
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/care-team`)
      .set('Authorization', `Bearer ${selfOwner.token}`)
      .send({ userId: anotherSelf.userId, role: 'self' })
      .expect(400);

    const list = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/care-team`)
      .set('Authorization', `Bearer ${selfOwner.token}`)
      .expect(200);
    const selfCount = list.body.filter((m: any) => m.role === 'self').length;
    expect(selfCount).toBe(1);
    expect(list.body.find((m: any) => m.user.id === selfOwner.userId)?.role).toBe('self');
  });

  it('sets code status via its own endpoint, stamping attribution server-side', async () => {
    const { token, userId } = await registerAndLogin(app);
    const createRes = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Code Status Patient', dateOfBirth: '2015-01-01', sexAtBirth: 'female' })
      .expect(201);
    const patientId = createRes.body.id;
    expect(createRes.body.codeStatus).toBeNull();
    expect(createRes.body.codeStatusSetByUserId).toBeNull();
    expect(createRes.body.codeStatusSetAt).toBeNull();

    // The general PATCH cannot set code status — it's not part of UpdatePatientDto's shape.
    const generalPatch = await request(app.getHttpServer())
      .patch(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ codeStatus: 'Should not apply' })
      .expect(200);
    expect(generalPatch.body.codeStatus).toBeNull();

    const before = Math.floor(Date.now() / 1000);
    const res = await request(app.getHttpServer())
      .patch(`/api/patients/${patientId}/code-status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ codeStatus: 'Full code' })
      .expect(200);
    expect(res.body.codeStatus).toBe('Full code');
    expect(res.body.codeStatusSetByUserId).toBe(userId);
    expect(res.body.codeStatusSetAt).toBeGreaterThanOrEqual(before);

    // GET reflects the same attribution.
    const get = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(get.body.codeStatus).toBe('Full code');
    expect(get.body.codeStatusSetByUserId).toBe(userId);
  });

  it('enforces patient access control on code-status (404, not 403)', async () => {
    const owner = await registerAndLogin(app);
    const other = await registerAndLogin(app);
    const createRes = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ fullName: 'Locked Patient', dateOfBirth: '2015-01-01', sexAtBirth: 'male' })
      .expect(201);
    const res = await request(app.getHttpServer())
      .patch(`/api/patients/${createRes.body.id}/code-status`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ codeStatus: 'DNR' })
      .expect(404);
    expect(res.body.message).toBe('PATIENT_NOT_FOUND');
  });
});
