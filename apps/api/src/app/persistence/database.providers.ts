import { Provider } from '@nestjs/common';
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
// pg, mysql2 and pglite are loaded lazily below — DB_CLIENT is sqlite by default and always is in
// every production deployment (SQLite is a fully supported self-hosting target, not just a dev
// fallback), so eagerly requiring three more drivers plus their drizzle dialects on every module
// load (measured ~237ms for pg+mysql2 alone) is pure overhead on that path. Type-only imports keep
// the DatabaseConnection union fully typed without pulling any of them in at runtime.
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { Pool as PgPool } from 'pg';
import type mysql from 'mysql2/promise';
import type { PGlite } from '@electric-sql/pglite';
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
      raw: PgPool;
    }
  | {
      client: 'mysql';
      db: MySql2Database;
      raw: mysql.Pool;
    }
  | {
      // Real Postgres compiled to WASM, running in-process — used only by the e2e suite (see
      // apps/api/src/testing/create-test-app.ts). It resolves to the *same* migrations as
      // 'postgres' in migrator.ts: PGlite is Postgres, not a fourth dialect, and must never grow
      // its own migration lineage or its own branch in schema.ts.
      client: 'pglite';
      db: PgliteDatabase;
      raw: PGlite;
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
      const { Pool } = await import('pg');
      const { drizzle: drizzlePostgres } = await import('drizzle-orm/node-postgres');
      // A pooled client, not a single Client — a single Client has no reconnect, so any dropped
      // connection (a Postgres restart, a network blip) would take the whole api process down
      // with it until the pod itself is recycled. See app-spec/persistence.md.
      const pool = new Pool({ connectionString: config.url });
      const db = drizzlePostgres(pool);
      return { client: 'postgres' as DatabaseClient, db, raw: pool };
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
    if (config.client === 'pglite') {
      const { PGlite } = await import('@electric-sql/pglite');
      const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite');
      const pglite = new PGlite(config.url ?? 'memory://');
      const db = drizzlePglite(pglite);
      return { client: 'pglite' as DatabaseClient, db, raw: pglite };
    }
    const sqlite = new Database(config.sqliteFile);
    const db = drizzleSqlite(sqlite);
    return { client: 'sqlite' as DatabaseClient, db, raw: sqlite };
  },
};
