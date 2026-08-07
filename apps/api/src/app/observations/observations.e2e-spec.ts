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
  const email = `obs-${Date.now()}@example.com`;
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
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-observations-'));
    process.env.DATA_DIR = tmpDir;
    process.env.DB_CLIENT = 'sqlite';
    process.env.JWT_SECRET = 'test-secret';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
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

    const validFileId = '00000000-0000-4000-8000-000000000000';
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        entries: [
          { type: 'photo', metadata: { fileId: validFileId, bodyLocation: 'Left arm', side: 'left' } },
        ],
      })
      .expect(201);
  });

  it('accepts a valid entry for every observation type', async () => {
    const { token } = await registerAndLogin(app);
    const patientRes = await request(app.getHttpServer())
      .post(`/api/patients`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Every Type Patient', dateOfBirth: '2020-01-01', sexAtBirth: 'female' })
      .expect(201);
    const patientId = patientRes.body.id;

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
        metadata: { fileId: '00000000-0000-4000-8000-000000000001', bodyLocation: 'Chest', side: 'n/a' },
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
