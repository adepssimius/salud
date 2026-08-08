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
  const email = `wywa-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: 'WYWA User' });
  return { token: reg.body.token, userId: reg.body.user.id };
}

describe('While You Were Asleep (e2e)', () => {
  let app: INestApplication;
  let tmpDir: string;
  let owner: { token: string; userId: string };
  let caregiver: { token: string; userId: string };
  let patientId: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-wywa-'));
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
    // Explicit bind (ISSUES #25): without this, supertest rebinds/closes an ephemeral port on
    // every single request instead of once per suite -- the leading suspect for the flake where
    // a request occasionally gets a real but wrong response (401/404 on a route that just worked).
    await app.listen(0);

    owner = await registerAndLogin(app);
    caregiver = await registerAndLogin(app);

    const patient = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ fullName: 'WYWA Patient', dateOfBirth: '2017-06-01', sexAtBirth: 'female', myRole: 'parent' })
      .expect(201);
    patientId = patient.body.id;

    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/care-team`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: caregiver.userId, role: 'nanny' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('enforces patient access control (404, not 403)', async () => {
    const stranger = await registerAndLogin(app);
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/whats-new`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/whats-new/ack`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);
  });

  it('surfaces events, advisories, and due schedules since the watermark, then hides them after ack', async () => {
    // Overdue medication schedule (nextDueAt = now on creation).
    const med = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'wywa-test-med' })
      .expect(201);
    const sched = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/schedules`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        type: 'medication_dose',
        label: 'wywa-test-med q8h',
        medicationId: med.body.id,
        doseMg: 100,
        frequencyHours: 8,
        startAt: new Date().toISOString(),
      })
      .expect(201);

    // A weight entry recorded overnight while the caregiver had never opened the app before
    // (lastSeenAt is null → falls back to the last 24h window).
    const obs = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ observedAt: new Date().toISOString(), entries: [{ type: 'weight', metadata: { kg: 18 } }] })
      .expect(201);

    const before = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/whats-new`)
      .set('Authorization', `Bearer ${caregiver.token}`)
      .expect(200);
    expect(before.body.events.some((e: any) => e.id === obs.body.id)).toBe(true);
    expect(before.body.nowDue.some((s: any) => s.scheduleId === sched.body.id)).toBe(true);

    // Timestamps are epoch-seconds; wait past the second boundary so the ack watermark is
    // unambiguously after the observation's createdAt, regardless of inclusive/exclusive filtering.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const ack = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/whats-new/ack`)
      .set('Authorization', `Bearer ${caregiver.token}`)
      .expect(201);
    expect(ack.body.ackedAt).toBeGreaterThan(0);

    // Immediately after ack, nothing new has happened yet — the just-seen observation drops out.
    const after = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/whats-new`)
      .set('Authorization', `Bearer ${caregiver.token}`)
      .expect(200);
    expect(after.body.events.some((e: any) => e.id === obs.body.id)).toBe(false);
    expect(after.body.since).toBeGreaterThanOrEqual(before.body.since);

    // A second observation logged after the ack shows up on the next fetch.
    const obs2 = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ observedAt: new Date().toISOString(), entries: [{ type: 'weight', metadata: { kg: 18.2 } }] })
      .expect(201);
    const afterSecond = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/whats-new`)
      .set('Authorization', `Bearer ${caregiver.token}`)
      .expect(200);
    expect(afterSecond.body.events.some((e: any) => e.id === obs2.body.id)).toBe(true);
    expect(afterSecond.body.events.some((e: any) => e.id === obs.body.id)).toBe(false);
  });

  it('loading the briefing never acks it on its own — repeated GETs keep returning the same diff', async () => {
    const fresh = await registerAndLogin(app);
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/care-team`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: fresh.userId, role: 'grandparent' })
      .expect(201);

    const obs = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ observedAt: new Date().toISOString(), entries: [{ type: 'note', metadata: { text: 'still coughing' } }] })
      .expect(201);

    const first = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/whats-new`)
      .set('Authorization', `Bearer ${fresh.token}`)
      .expect(200);
    const second = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/whats-new`)
      .set('Authorization', `Bearer ${fresh.token}`)
      .expect(200);
    expect(first.body.events.some((e: any) => e.id === obs.body.id)).toBe(true);
    expect(second.body.events.some((e: any) => e.id === obs.body.id)).toBe(true);
  });
});
