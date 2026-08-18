import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../testing/create-test-app';
import { DatabaseService } from '../persistence/database.service';

describe('Health (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ app, close } = await createTestApp('health'));
  });

  afterAll(async () => {
    await close();
  });

  // Both routes have to work without an Authorization header — kubelet doesn't have one, and a
  // probe that 401s makes the pod permanently NotReady.
  it('GET /api/health reports ok without auth', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /api/health/ready reports ready without auth', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(200);
    // Dialect-aware: create-test-app.ts sets DB_CLIENT from TEST_DB (default 'pglite' — real
    // Postgres in WASM; 'sqlite' is the other supported leg, see app-spec/persistence.md), and
    // readiness reports back whichever one is actually live.
    expect(res.body).toEqual({ status: 'ready', db: process.env.DB_CLIENT ?? 'sqlite' });
  });

  it('GET /api/health/ready returns 503 when the database is unreachable', async () => {
    const dbService = app.get(DatabaseService);
    const ping = jest
      .spyOn(dbService, 'ping')
      .mockRejectedValueOnce(new Error('connection closed'));

    await request(app.getHttpServer()).get('/api/health/ready').expect(503);

    ping.mockRestore();
  });
});
