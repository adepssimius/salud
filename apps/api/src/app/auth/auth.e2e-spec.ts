import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { DatabaseService } from '../persistence/database.service';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-auth-'));
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
    // Explicit bind (ISSUES #25): without this, supertest rebinds/closes an ephemeral port on
    // every single request instead of once per suite -- the leading suspect for the flake where
    // a request occasionally gets a real but wrong response (401/404 on a route that just worked).
    await app.listen(0);
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('registers, logs in, and returns me', async () => {
    const email = `user-${Date.now()}@example.com`;
    const password = 'password123';

    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email,
        password,
        displayName: 'Test User',
        preferredTempUnit: 'F',
        preferredLengthUnit: 'cm',
        preferredWeightUnit: 'kg',
      })
      .expect(201);

    const token = registerRes.body.token;
    expect(token).toBeDefined();

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(201);

    const loginToken = loginRes.body.token;
    expect(loginToken).toBeDefined();

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${loginToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.user.email).toBe(email);
      });
  });

  it('returns the error code as a plain string message on a wrong password', async () => {
    // Pins the response SHAPE the web's core/error-display.ts mapper is built against: an explicit
    // throw gives `message` as a string holding the code, not an array and not framework prose. A
    // future global exception filter changing this would silently break every mapped sentence.
    const email = `wrongpw-${Date.now()}@example.com`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email,
        password: 'correct-password',
        displayName: 'Test User',
        preferredTempUnit: 'F',
        preferredLengthUnit: 'cm',
        preferredWeightUnit: 'kg',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401)
      .expect((res) => {
        expect(typeof res.body.message).toBe('string');
        expect(res.body.message).toBe('INVALID_CREDENTIALS');
      });
  });

  it('updates profile prefs and name', async () => {
    const email = `profile-${Date.now()}@example.com`;
    const password = 'password123';

    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email,
        password,
        displayName: 'Profile User',
        preferredTempUnit: 'F',
        preferredLengthUnit: 'cm',
        preferredWeightUnit: 'kg',
      })
      .expect(201);

    const token = registerRes.body.token;

    await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        displayName: 'Updated Name',
        preferredTempUnit: 'C',
        preferredLengthUnit: 'in',
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.user.displayName).toBe('Updated Name');
        expect(res.body.user.preferredTempUnit).toBe('C');
        expect(res.body.user.preferredLengthUnit).toBe('in');
      });
  });

  it('requires auth for /users/me', async () => {
    await request(app.getHttpServer()).get('/api/users/me').expect(401);
    await request(app.getHttpServer()).patch('/api/users/me').send({ displayName: 'Nope' }).expect(401);
  });

  it('keeps profile changes isolated per user', async () => {
    const aEmail = `iso-a-${Date.now()}@example.com`;
    const bEmail = `iso-b-${Date.now()}@example.com`;
    const password = 'password123';

    const regA = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: aEmail, password, displayName: 'User A' })
      .expect(201);
    const tokenA = regA.body.token;

    await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ displayName: 'User A Updated' })
      .expect(200);

    const regB = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: bEmail, password, displayName: 'User B' })
      .expect(201);
    const tokenB = regB.body.token;

    // User B should still see their own profile unchanged
    await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.user.displayName).toBe('User B');
      });

    // User A profile remains as updated
    await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.user.displayName).toBe('User A Updated');
      });
  });

  it('reports password mode by default in this test environment', async () => {
    await request(app.getHttpServer())
      .get('/api/auth/config')
      .expect(200)
      .expect({ mode: 'password' });
  });

  it('refuses register and login once OIDC is the active login path', async () => {
    // The regression this guards: once the forward-auth perimeter is gone (deployment.md →
    // "Access control"), an un-gated register endpoint is a completely open, internet-reachable
    // account-creation endpoint. authMode() reads NODE_ENV/OIDC_ENABLED fresh on every call, so
    // toggling them around a single request is enough -- no app restart needed.
    const originalNodeEnv = process.env.NODE_ENV;
    const originalOidcEnabled = process.env.OIDC_ENABLED;
    process.env.NODE_ENV = 'production';
    process.env.OIDC_ENABLED = 'true';
    try {
      await request(app.getHttpServer())
        .get('/api/auth/config')
        .expect(200)
        .expect({ mode: 'oidc' });

      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email: `blocked-${Date.now()}@example.com`, password: 'password123', displayName: 'Nope' })
        .expect(403)
        .expect((res) => {
          expect(res.body.message).toBe('PASSWORD_AUTH_DISABLED');
        });

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'anyone@example.com', password: 'whatever' })
        .expect(403)
        .expect((res) => {
          expect(res.body.message).toBe('PASSWORD_AUTH_DISABLED');
        });
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalOidcEnabled === undefined) delete process.env.OIDC_ENABLED;
      else process.env.OIDC_ENABLED = originalOidcEnabled;
    }
  });

  it('searches users by email', async () => {
    const email = `search-${Date.now()}@example.com`;
    const password = 'password123';

    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, displayName: 'Search User' })
      .expect(201);
    const token = registerRes.body.token;

    const searchRes = await request(app.getHttpServer())
      .get('/api/users/search')
      .query({ email })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(searchRes.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email, displayName: 'Search User' }),
      ]),
    );
  });
});
