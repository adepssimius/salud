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
  const email = `react-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const reg = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: 'Reaction User' });
  return { token: reg.body.token, userId: reg.body.user.id };
}

describe('Adverse reactions (e2e)', () => {
  let app: INestApplication;
  let tmpDir: string;
  let token: string;
  let patientId: string;
  let medicationId: string;
  let embodimentId: string;

  async function createPatient() {
    const res = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Reaction Patient', dateOfBirth: '2018-01-01', sexAtBirth: 'female', myRole: 'parent' })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-reactions-'));
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
    patientId = await createPatient();

    const med = await request(app.getHttpServer())
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'reaction-test-med', tags: ['penicillin-class'] })
      .expect(201);
    medicationId = med.body.id;

    const emb = await request(app.getHttpServer())
      .post(`/api/medications/${medicationId}/embodiments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'suspension', concentrationMgPerMl: 40, unitType: 'ml' })
      .expect(201);
    embodimentId = emb.body.id;
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects a reaction with no scope target, or more than one', async () => {
    const none = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/reactions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'x', occurredAt: new Date().toISOString(), severity: 'warning', scopeType: 'medication' })
      .expect(400);
    expect(none.body.message).toBe('INVALID_REACTION_SCOPE');

    const both = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/reactions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        description: 'x',
        occurredAt: new Date().toISOString(),
        severity: 'warning',
        scopeType: 'medication',
        medicationId,
        embodimentId,
      })
      .expect(400);
    expect(both.body.message).toBe('INVALID_REACTION_SCOPE');

    const mismatchedScope = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/reactions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        description: 'x',
        occurredAt: new Date().toISOString(),
        severity: 'warning',
        scopeType: 'medication',
        embodimentId,
      })
      .expect(400);
    expect(mismatchedScope.body.message).toBe('INVALID_REACTION_SCOPE');
  });

  it('creates and lists reactions, newest first', async () => {
    await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/reactions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        description: 'first reaction',
        occurredAt: '2025-01-01T00:00:00Z',
        severity: 'warning',
        scopeType: 'medication',
        medicationId,
      })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/api/patients/${patientId}/reactions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        description: 'second reaction',
        occurredAt: '2025-06-01T00:00:00Z',
        severity: 'danger',
        scopeType: 'medication',
        medicationId,
      })
      .expect(201);
    expect(second.body.severity).toBe('danger');

    const list = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/reactions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body[0].description).toBe('second reaction');
    expect(list.body[1].description).toBe('first reaction');
  });

  it('enforces patient access control on reactions (404, not 403)', async () => {
    const other = await registerAndLogin(app);
    await request(app.getHttpServer())
      .get(`/api/patients/${patientId}/reactions`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(404);
  });

  describe('scope matching in the dosing engine', () => {
    async function freshPatient() {
      const res = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'Scope Test Patient', dateOfBirth: '2018-01-01', sexAtBirth: 'male', myRole: 'parent' })
        .expect(201);
      return res.body.id;
    }

    it('matches an embodiment-scoped reaction only on the exact embodiment', async () => {
      const pid = await freshPatient();
      const emb2 = await request(app.getHttpServer())
        .post(`/api/medications/${medicationId}/embodiments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ label: 'tablet', strengthMgPerUnit: 250, unitType: 'tablet' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/patients/${pid}/reactions`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          description: 'hives from the suspension specifically',
          occurredAt: new Date().toISOString(),
          severity: 'warning',
          scopeType: 'embodiment',
          embodimentId,
        })
        .expect(201);

      const matching = await request(app.getHttpServer())
        .post(`/api/patients/${pid}/dose-checks`)
        .set('Authorization', `Bearer ${token}`)
        .send({ medicationId, medicationEmbodimentId: embodimentId })
        .expect(201);
      expect(matching.body.advisories.some((a: any) => a.type === 'reaction_warning')).toBe(true);

      const nonMatching = await request(app.getHttpServer())
        .post(`/api/patients/${pid}/dose-checks`)
        .set('Authorization', `Bearer ${token}`)
        .send({ medicationId, medicationEmbodimentId: emb2.body.id })
        .expect(201);
      expect(nonMatching.body.advisories.some((a: any) => a.type === 'reaction_warning')).toBe(false);
    });

    it('matches a medication-scoped reaction regardless of embodiment', async () => {
      const pid = await freshPatient();
      await request(app.getHttpServer())
        .post(`/api/patients/${pid}/reactions`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          description: 'reacts to the drug itself',
          occurredAt: new Date().toISOString(),
          severity: 'warning',
          scopeType: 'medication',
          medicationId,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/patients/${pid}/dose-checks`)
        .set('Authorization', `Bearer ${token}`)
        .send({ medicationId })
        .expect(201);
      expect(res.body.advisories.some((a: any) => a.type === 'reaction_warning')).toBe(true);
    });

    it('matches a tag-scoped reaction against the medication class, never inferred beyond the literal tag', async () => {
      const pid = await freshPatient();
      await request(app.getHttpServer())
        .post(`/api/patients/${pid}/reactions`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          description: 'no penicillins, period',
          occurredAt: new Date().toISOString(),
          severity: 'danger',
          scopeType: 'tag',
          tag: 'penicillin-class',
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/patients/${pid}/dose-checks`)
        .set('Authorization', `Bearer ${token}`)
        .send({ medicationId })
        .expect(201);
      const reaction = res.body.advisories.find((a: any) => a.type === 'reaction_danger');
      expect(reaction).toBeDefined();
      expect(reaction.payload.description).toBe('no penicillins, period');

      // A medication that doesn't carry the tag never matches (exact intersection only, P6).
      const untaggedMed = await request(app.getHttpServer())
        .post('/api/medications')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'untagged-med' })
        .expect(201);
      const untagged = await request(app.getHttpServer())
        .post(`/api/patients/${pid}/dose-checks`)
        .set('Authorization', `Bearer ${token}`)
        .send({ medicationId: untaggedMed.body.id })
        .expect(201);
      expect(untagged.body.advisories.some((a: any) => a.type === 'reaction_danger')).toBe(false);
    });

    it('N-3: a danger-class reaction match never blocks the dose save — it persists isAtypical-style, self-acknowledged', async () => {
      const pid = await freshPatient();
      await request(app.getHttpServer())
        .post(`/api/patients/${pid}/reactions`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          description: 'anaphylaxis last time',
          occurredAt: new Date().toISOString(),
          severity: 'danger',
          scopeType: 'medication',
          medicationId,
        })
        .expect(201);

      const dose = await request(app.getHttpServer())
        .post(`/api/patients/${pid}/interventions`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          performedAt: new Date().toISOString(),
          type: 'medication_dose',
          medicationId,
          medicationEmbodimentId: embodimentId,
          doseSource: 'override',
          amountMg: 100,
        })
        .expect(201);
      expect(dose.body.id).toBeDefined();

      const advisories = await request(app.getHttpServer())
        .get(`/api/patients/${pid}/advisories`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const reactionAdvisory = advisories.body.find((a: any) => a.type === 'reaction_danger');
      expect(reactionAdvisory).toBeDefined();
      expect(reactionAdvisory.contextId).toBe(dose.body.id);
      expect(reactionAdvisory.acknowledgedByUserId).toBeTruthy();
    });
  });
});
