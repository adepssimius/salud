import { Provider } from '@nestjs/common';
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePostgres, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleMysql, MySql2Database } from 'drizzle-orm/mysql2';
import { Client as PgClient } from 'pg';
import mysql from 'mysql2/promise';
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
      const client = new PgClient({ connectionString: config.url });
      await client.connect();
      const db = drizzlePostgres(client);
      return { client: 'postgres' as DatabaseClient, db, raw: client };
    }
    if (config.client === 'mysql') {
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
