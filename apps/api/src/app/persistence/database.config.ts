import path from 'path';
import { resolveDataDir } from './paths';

export type DatabaseClient = 'sqlite' | 'postgres' | 'mysql' | 'pglite';

export interface DatabaseConfig {
  client: DatabaseClient;
  sqliteFile: string;
  url?: string;
}

export function resolveDatabaseConfig(): DatabaseConfig {
  const client = (process.env.DB_CLIENT ??
    process.env.DATABASE_CLIENT ??
    'sqlite') as DatabaseClient;

  if (client === 'postgres' || client === 'mysql') {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is required when DB client is postgres or mysql');
    }
    return {
      client,
      sqliteFile: '',
      url,
    };
  }

  // pglite (real Postgres in WASM, in-process — the e2e default; see create-test-app.ts) takes a
  // data directory, not a connection string, but DATABASE_URL is reused for it so the test harness
  // can set one env var regardless of dialect. Unset means an in-memory instance.
  if (client === 'pglite') {
    return {
      client,
      sqliteFile: '',
      url: process.env.DATABASE_URL ?? 'memory://',
    };
  }

  const dataDir = resolveDataDir();
  const sqliteFile =
    process.env.DATABASE_FILE ?? path.join(dataDir, 'salud.db');

  return {
    client: 'sqlite',
    sqliteFile,
  };
}
