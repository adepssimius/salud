import path from 'path';
import { resolveDataDir } from './paths';

export type DatabaseClient = 'sqlite' | 'postgres' | 'mysql';

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

  const dataDir = resolveDataDir();
  const sqliteFile =
    process.env.DATABASE_FILE ?? path.join(dataDir, 'salud.db');

  return {
    client: 'sqlite',
    sqliteFile,
  };
}
