import path from 'path';
import { defineConfig } from 'drizzle-kit';

const client = (process.env.DB_CLIENT ??
  process.env.DATABASE_CLIENT ??
  'sqlite') as 'sqlite' | 'postgres' | 'mysql';

const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const sqliteFile = process.env.DATABASE_FILE ?? path.join(dataDir, 'salud.db');

const outDir = `./apps/api/src/db/migrations/${client}`;

// Point drizzle-kit straight at the dialect-specific schema module rather than the runtime
// resolver in schema.ts — that resolver re-derives the dialect from the same env vars this file
// already reads, and pointing generate/introspect at it too would mean two independent places
// deciding "which schema" from the same input instead of one. SQLite and Postgres are both
// supported deployment targets (app-spec/persistence.md) with independent migration lineages —
// see CLAUDE.md → Migrations: every schema change generates one migration per dialect, and
// schema-parity.spec.ts is what keeps the two schema files themselves from drifting.
const schemaFile =
  client === 'postgres'
    ? './apps/api/src/db/schema.pg.ts'
    : client === 'mysql'
      ? './apps/api/src/db/schema.ts' // mysql has no ported schema — see persistence.md
      : './apps/api/src/db/schema.sqlite.ts';

const base = {
  schema: schemaFile,
  out: outDir,
} as const;

const config =
  client === 'postgres'
    ? {
        ...base,
        dialect: 'postgresql',
        dbCredentials: { url: process.env.DATABASE_URL ?? '' },
      }
    : client === 'mysql'
      ? {
          ...base,
          dialect: 'mysql',
          dbCredentials: { url: process.env.DATABASE_URL ?? '' },
        }
      : {
          ...base,
          dialect: 'sqlite',
          dbCredentials: { url: `file:${sqliteFile}` },
        };

export default defineConfig(config);
