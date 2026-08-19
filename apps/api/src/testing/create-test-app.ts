import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppModule } from '../app/app.module';
import { DatabaseService } from '../app/persistence/database.service';

export interface CreateTestAppOptions {
  // Extra env vars to set before the Nest module compiles — e.g. oidc.e2e-spec.ts's
  // AUTHELIA_ISSUER_URL/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET. Applied on top of the base
  // DATA_DIR/DB_CLIENT/JWT_SECRET/DATABASE_URL this helper always sets.
  env?: Record<string, string>;
  // Runs after `createNestApplication()` but before migrations/`init()`/`listen()`, for the
  // handful of suites that need what main.ts applies at boot and every other suite skips —
  // app.security's helmet/CORS/cookie config (oidc.e2e-spec.ts) or app.observability's access
  // logging plus the global ValidationPipe (observability.e2e-spec.ts).
  configureApp?: (app: INestApplication) => void;
}

export interface TestApp {
  app: INestApplication;
  tmpDir: string;
  close(): Promise<void>;
}

/**
 * Boots a full Nest application against a fresh, isolated database for one e2e suite — the
 * `beforeAll`/`afterAll` boilerplate that used to be copy-pasted into all 23 e2e spec files with
 * `DB_CLIENT` hardcoded to `'sqlite'` and migrations driven directly through
 * `drizzle-orm/better-sqlite3/migrator`.
 *
 * Two things changed on purpose, not just moved:
 *
 * - Dialect comes from `TEST_DB` (default `'pglite'` — real Postgres in WASM, in-process, no
 *   Docker required). `TEST_DB=sqlite` runs the exact same suite against SQLite instead. Both are
 *   fully supported production targets (app-spec/persistence.md → self-hosting vs. this
 *   deployment), so `.github/workflows/ci.yml` runs both legs — a green Postgres run alone says
 *   nothing about the SQLite build a self-hoster actually gets.
 * - Migrations run through `DatabaseService.runMigrations()`, the same call `main.ts` makes at
 *   boot, instead of a direct `migrate()` call against a hardcoded `migrations/sqlite` path. The
 *   old pattern meant `migrator.ts`'s dialect dispatch was exercised by zero tests; this closes
 *   that gap along with the sqlite-only setup.
 *
 * The explicit `app.listen(0)` bind is kept even though nothing here needs a real socket close —
 * dropping it reintroduces the flake in ISSUES #25, where supertest rebinds an ephemeral port on
 * every request instead of once per suite.
 */
export async function createTestApp(
  prefix: string,
  options: CreateTestAppOptions = {},
): Promise<TestApp> {
  // Already set by jest-env-setup.ts (a Jest `setupFiles` entry, run before this file — or
  // anything else in the test file's module graph — is even required) precisely so that
  // db/schema.ts's dialect resolver sees the right value at *its* import time, not this one.
  // Re-deriving it here from TEST_DB as a fallback only matters for a caller outside Jest.
  const dialect = process.env.DB_CLIENT ?? process.env.TEST_DB ?? 'pglite';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `salud-${prefix}-`));

  process.env.DATA_DIR = tmpDir;
  process.env.DB_CLIENT = dialect;
  process.env.JWT_SECRET = 'test-secret';
  // Pin the storage driver rather than inheriting the ambient env: a developer with
  // FILE_STORAGE_DRIVER=s3 exported in their shell would otherwise point all 23 e2e suites at a
  // real bucket. Attachments land under the per-suite tmpDir via DATA_DIR above.
  process.env.FILE_STORAGE_DRIVER = 'local';
  delete process.env.FILE_STORAGE_LOCAL_BASE_PATH;
  if (dialect === 'pglite') {
    // A per-suite directory rather than the default in-memory instance, so two suites that
    // happen to run in the same worker process can never see each other's rows.
    process.env.DATABASE_URL = path.join(tmpDir, 'pgdata');
  } else {
    delete process.env.DATABASE_URL;
  }
  for (const [key, value] of Object.entries(options.env ?? {})) {
    process.env[key] = value;
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  options.configureApp?.(app);

  await app.get(DatabaseService).runMigrations();
  await app.init();
  await app.listen(0);

  return {
    app,
    tmpDir,
    async close() {
      await app.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}
