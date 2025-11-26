import path from 'path';
import { defineConfig } from 'drizzle-kit';

const client = (process.env.DB_CLIENT ??
  process.env.DATABASE_CLIENT ??
  'sqlite') as 'sqlite' | 'postgres' | 'mysql';

const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const sqliteFile = process.env.DATABASE_FILE ?? path.join(dataDir, 'salud.db');

const outDir = `./apps/api/src/db/migrations/${client}`;

const base = {
  schema: './apps/api/src/db/schema.ts',
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
