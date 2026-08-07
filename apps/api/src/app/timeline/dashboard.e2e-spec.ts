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
  const email = `dash-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: 'Dashboard User' });
  return { token: reg.body.token, userId: reg.body.user.id };
}

describe('Dashboard (e2e)', () => {
  let app: INestApplication;
  let tmpDir: string;
  let token: string;
  let patientId: string;
  let medicationId: string;
  let embodimentId: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-dashboard-'));
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

    const patientRes = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Dashboard Patient', dateOfBirth: '2019-01-01', sexAtBirth: 'male', myRole: 'parent' })
      .expect(201);
    patientId = patientRes.body.id;

    const med = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'dashboard-test-med' })
      .expect(201);
    medicationId = med.body.id;

    const emb = await request(app.getHttpServer())
      .post(`/api/medications/${medicationId}/embodiments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'dashboard suspension', unitType: 'ml' })
      .expect(201);
    embodimentId = emb.body.id;
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('surfaces an active episode with last observation summary and per-medication last dose', async () => {
    const obs = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/observations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        observedAt: new Date().toISOString(),
        startEpisodeName: 'Dashboard Fever',
        entries: [{ type: 'temperature', metadata: { value: 38.7, unit: 'C', method: 'oral' } }],
      })
      .expect(201);
    const episodeId = obs.body.episodeIds[0];

    const dose = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/interventions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        performedAt: new Date().toISOString(),
        type: 'medication_dose',
        medicationId,
        medicationEmbodimentId: embodimentId,
        doseSource: 'override',
        amountMg: 120,
        episodeIds: [episodeId],
      })
      .expect(201);

    const dashboard = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const ep = dashboard.body.activeEpisodes.find((e: any) => e.episodeId === episodeId);
    expect(ep).toBeDefined();
    expect(ep.patientId).toBe(patientId);
    expect(ep.lastObservationSummary.entries[0].type).toBe('temperature');
    const medSummary = ep.medications.find((m: any) => m.medicationId === medicationId);
    expect(medSummary).toBeDefined();
    expect(medSummary.lastDoseAt).toBe(dose.body.performedAt);
    expect(medSummary.nextAllowedAt).toEqual(dose.body.metadata.nextAllowedAt);
    expect(medSummary.isAtypicalLastDose).toBe(dose.body.metadata.isAtypical);
  });

  it('lists upcoming schedules with an overdue flag', async () => {
    const pastStart = new Date(Date.now() - 3600_000); // an hour ago — immediately overdue
    const sched = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/schedules`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'medication_dose',
        label: 'Overdue test schedule',
        medicationId,
        frequencyHours: 6,
        startAt: pastStart.toISOString(),
      })
      .expect(201);

    const dashboard = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const row = dashboard.body.upcomingSchedules.find((s: any) => s.scheduleId === sched.body.id);
    expect(row).toBeDefined();
    expect(row.overdue).toBe(true);
    expect(row.label).toBe('Overdue test schedule');
  });

  it('surfaces running-low embodiments on the shopping list, and restock clears it', async () => {
    await request(app.getHttpServer())
      .patch(`/api/embodiments/${embodimentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ runningLow: true })
      .expect(200);

    let dashboard = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    let item = dashboard.body.shoppingList.find((s: any) => s.embodimentId === embodimentId);
    expect(item).toBeDefined();
    expect(item.medicationName).toBe('dashboard-test-med');

    await request(app.getHttpServer())
      .post(`/api/embodiments/${embodimentId}/restock`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    dashboard = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    item = dashboard.body.shoppingList.find((s: any) => s.embodimentId === embodimentId);
    expect(item).toBeUndefined();
  });

  it('only aggregates patients the requester is on the care team for', async () => {
    const other = await registerAndLogin(app);
    const dashboard = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${other.token}`)
      .expect(200);
    expect(dashboard.body.activeEpisodes.length).toBe(0);
    expect(dashboard.body.upcomingSchedules.length).toBe(0);
  });
});
