import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { DatabaseService } from '../persistence/database.service';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

describe('Health (e2e)', () => {
  let app: INestApplication;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-health-'));
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
    await app.listen(0);
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
    expect(res.body).toEqual({ status: 'ready', db: 'sqlite' });
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
