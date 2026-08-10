import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { DatabaseService } from '../persistence/database.service';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';

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
    // Explicit bind (ISSUES #25): without this, supertest rebinds/closes an ephemeral port on
    // every single request instead of once per suite -- the leading suspect for the flake where
    // a request occasionally gets a real but wrong response (401/404 on a route that just worked).
    await app.listen(0);
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

  it('rejects a date of birth in the future, on create and on update', async () => {
    const { token } = await registerAndLogin(app);
    const future = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

    const created = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Future Baby', dateOfBirth: future, sexAtBirth: 'female' })
      .expect(400);
    expect(created.body.message).toContain('DATE_IN_FUTURE');

    const ok = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Real Baby', dateOfBirth: '2020-01-01', sexAtBirth: 'female' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/patients/${ok.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dateOfBirth: future })
      .expect(400);
  });

  it('refuses to delete for a care team member who is not the owner', async () => {
    const owner = await registerAndLogin(app);
    const helper = await registerAndLogin(app);

    const createRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ fullName: 'Not Yours', dateOfBirth: '2018-01-01', sexAtBirth: 'female' })
      .expect(201);
    const patientId = createRes.body.id;

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/care-team`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: helper.userId, role: 'babysitter' })
      .expect(201);

    const forbidden = await request(app.getHttpServer())
      .delete(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${helper.token}`)
      .expect(403);
    expect(forbidden.body.message).toBe('NOT_PATIENT_OWNER');

    // Still there, and the non-owner can still read it -- 403 is about this one action.
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}`)
      .set('Authorization', `Bearer ${helper.token}`)
      .expect(200);
  });

  // The leak-regression guard for the check above: a stranger must not be able to tell 403 from
  // 404 and thereby learn the id is real (api.md -> "Resource shape and access control").
  it('still answers 404, not 403, when a non-member tries to delete', async () => {
    const owner = await registerAndLogin(app);
    const stranger = await registerAndLogin(app);

    const createRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ fullName: 'Private', dateOfBirth: '2019-02-02', sexAtBirth: 'male' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .delete(`/api/patients/${createRes.body.id}`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);
    expect(res.body.message).toBe('PATIENT_NOT_FOUND');
  });

  // Route-level 404s can't distinguish "cascaded" from "unreachable because the patient row is
  // gone", so this asserts against the tables directly.
  it('deletes every child row belonging to the patient', async () => {
    const { token, userId } = await registerAndLogin(app);
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

    const patientId = (
      await auth(
        request(app.getHttpServer())
          .post(`/api/patients`)
          .send({ fullName: 'Cascade Me', dateOfBirth: '2015-06-06', sexAtBirth: 'female' }),
      ).expect(201)
    ).body.id;

    // A revision on the patient itself.
    await auth(
      request(app.getHttpServer()).patch(`/api/patients/${patientId}`).send({ notes: 'edited' }),
    ).expect(200);

    // Observation with entries, starting an episode (-> episode + two pivot rows).
    const obsId = (
      await auth(
        request(app.getHttpServer())
          .post(`/api/patients/${patientId}/observations`)
          .send({
            observedAt: new Date().toISOString(),
            startEpisodeName: 'Cascade fever',
            entries: [
              { type: 'temperature', metadata: { value: 38.5, unit: 'C', method: 'oral' } },
              { type: 'weight', metadata: { kg: 18 } },
            ],
          }),
      ).expect(201)
    ).body.id;

    // A revision on the observation.
    await auth(
      request(app.getHttpServer()).patch(`/api/observations/${obsId}`).send({ notes: 'corrected' }),
    );

    // Condition + protocol.
    const conditionId = (
      await auth(
        request(app.getHttpServer())
          .post(`/api/patients/${patientId}/conditions`)
          .send({ name: 'Cascade condition' }),
      ).expect(201)
    ).body.id;
    await auth(
      request(app.getHttpServer())
        .post(`/api/conditions/${conditionId}/protocols`)
        .send({
          name: 'Cascade protocol',
          triggerMetric: 'temperature',
          triggerOperator: 'gte',
          triggerValue: 38,
          instructionText: 'call',
          sourceText: 'test',
        }),
    ).expect(201);

    // Medication + embodiment so an intervention and a schedule have something to point at.
    const medicationId = (
      await auth(
        request(app.getHttpServer())
          .post(`/api/medications`)
          .send({ name: `Cascadamol ${Date.now()}` }),
      ).expect(201)
    ).body.id;

    await auth(
      request(app.getHttpServer())
        .post(`/api/patients/${patientId}/interventions`)
        .send({
          performedAt: new Date().toISOString(),
          type: 'medication_dose',
          medicationId,
          doseSource: 'override',
          amountMg: 100,
        }),
    ).expect(201);

    await auth(
      request(app.getHttpServer())
        .post(`/api/patients/${patientId}/schedules`)
        .send({
          type: 'medication_dose',
          label: 'Cascade q8h',
          medicationId,
          doseMg: 100,
          frequencyHours: 8,
          startAt: new Date().toISOString(),
        }),
    ).expect(201);

    await auth(
      request(app.getHttpServer())
        .post(`/api/patients/${patientId}/reactions`)
        .send({
          description: 'rash',
          occurredAt: new Date().toISOString(),
          severity: 'warning',
          scopeType: 'medication',
          medicationId,
        }),
    ).expect(201);

    await auth(
      request(app.getHttpServer())
        .post(`/api/patients/${patientId}/er-brief/snapshots`)
        .send({}),
    ).expect(201);

    const fileId = (
      await auth(
        request(app.getHttpServer())
          .post(`/api/files`)
          .field('patientId', patientId)
          .attach('file', Buffer.from('not really a jpeg'), {
            filename: 'cascade.jpg',
            contentType: 'image/jpeg',
          }),
      ).expect(201)
    ).body.fileId;
    expect(fileId).toBeTruthy();

    const db = (app.get(DatabaseService) as any).db;
    const countsFor = async () => ({
      observations: (await db.select().from(schema.observations).where(eq(schema.observations.patientId, patientId))).length,
      observationEntries: (
        await db.select().from(schema.observationEntries).where(eq(schema.observationEntries.observationId, obsId))
      ).length,
      interventions: (await db.select().from(schema.interventions).where(eq(schema.interventions.patientId, patientId))).length,
      episodes: (await db.select().from(schema.episodes).where(eq(schema.episodes.patientId, patientId))).length,
      pivot: (await db.select().from(schema.episodesEventsPivot).where(eq(schema.episodesEventsPivot.eventId, obsId))).length,
      conditions: (await db.select().from(schema.conditions).where(eq(schema.conditions.patientId, patientId))).length,
      protocols: (await db.select().from(schema.protocols).where(eq(schema.protocols.conditionId, conditionId))).length,
      schedules: (
        await db.select().from(schema.interventionSchedules).where(eq(schema.interventionSchedules.patientId, patientId))
      ).length,
      reactions: (await db.select().from(schema.adverseReactions).where(eq(schema.adverseReactions.patientId, patientId))).length,
      advisories: (await db.select().from(schema.advisories).where(eq(schema.advisories.patientId, patientId))).length,
      snapshots: (await db.select().from(schema.erBriefSnapshots).where(eq(schema.erBriefSnapshots.patientId, patientId))).length,
      files: (await db.select().from(schema.fileAssets).where(eq(schema.fileAssets.patientId, patientId))).length,
      memberships: (
        await db.select().from(schema.careTeamMemberships).where(eq(schema.careTeamMemberships.patientId, patientId))
      ).length,
      patientRevisions: (
        await db.select().from(schema.revisions).where(eq(schema.revisions.entityId, patientId))
      ).length,
      observationRevisions: (await db.select().from(schema.revisions).where(eq(schema.revisions.entityId, obsId))).length,
      patients: (await db.select().from(schema.patients).where(eq(schema.patients.id, patientId))).length,
    });

    const before = await countsFor();
    // Guard the guard: if the fixture stopped creating children this test would pass vacuously.
    for (const [table, count] of Object.entries(before)) {
      expect([table, count]).toEqual([table, expect.any(Number)]);
      expect(count).toBeGreaterThan(0);
    }

    await auth(request(app.getHttpServer()).delete(`/api/patients/${patientId}`)).expect(200);

    const after = await countsFor();
    for (const [table, count] of Object.entries(after)) {
      expect([table, count]).toEqual([table, 0]);
    }

    // The medication catalog is household-global and must survive the patient it was used for.
    expect(
      (await db.select().from(schema.medications).where(eq(schema.medications.id, medicationId))).length,
    ).toBe(1);
    expect(userId).toBeTruthy();
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
