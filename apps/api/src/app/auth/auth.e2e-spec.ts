import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { AppModule } from '../app.module';

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
    await app.init();
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
});
