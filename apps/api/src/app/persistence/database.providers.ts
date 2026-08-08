import { Provider } from '@nestjs/common';
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
// pg and mysql2 are loaded lazily below — DB_CLIENT is sqlite by default and always is in every
// test suite, so eagerly requiring both drivers plus both drizzle dialects on every module load
// (measured ~237ms) is pure overhead on that path. Type-only imports keep the DatabaseConnection
// union fully typed without pulling either package in at runtime.
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import type { Client as PgClient } from 'pg';
import type mysql from 'mysql2/promise';
import { DatabaseClient, resolveDatabaseConfig } from './database.config';

export const DATABASE_CONFIG_TOKEN = 'DATABASE_CONFIG_TOKEN';
export const DATABASE_CONNECTION_TOKEN = 'DATABASE_CONNECTION_TOKEN';

type SqliteInstance = ReturnType<typeof drizzleSqlite>;

export type DatabaseConnection =
  | {
      client: 'sqlite';
      db: SqliteInstance;
      raw: Database;
    }
  | {
      client: 'postgres';
      db: NodePgDatabase;
      raw: PgClient;
    }
  | {
      client: 'mysql';
      db: MySql2Database;
      raw: mysql.Pool;
    };

export const databaseConfigProvider: Provider = {
  provide: DATABASE_CONFIG_TOKEN,
  useFactory: () => resolveDatabaseConfig(),
};

export const databaseConnectionProvider: Provider = {
  provide: DATABASE_CONNECTION_TOKEN,
  useFactory: async () => {
    const config = resolveDatabaseConfig();
    if (config.client === 'postgres') {
      const { Client } = await import('pg');
      const { drizzle: drizzlePostgres } = await import('drizzle-orm/node-postgres');
      const client = new Client({ connectionString: config.url });
      await client.connect();
      const db = drizzlePostgres(client);
      return { client: 'postgres' as DatabaseClient, db, raw: client };
    }
    if (config.client === 'mysql') {
      const { default: mysql } = await import('mysql2/promise');
      const { drizzle: drizzleMysql } = await import('drizzle-orm/mysql2');
      const pool = mysql.createPool({
        uri: config.url,
      });
      const db = drizzleMysql(pool);
      return { client: 'mysql' as DatabaseClient, db, raw: pool };
    }
    const sqlite = new Database(config.sqliteFile);
    const db = drizzleSqlite(sqlite);
    return { client: 'sqlite' as DatabaseClient, db, raw: sqlite };
  },
};
