import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  DATABASE_CONNECTION_TOKEN,
  DatabaseConnection,
} from './database.providers';
import { runMigrations } from './migrator';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  constructor(
    @Inject(DATABASE_CONNECTION_TOKEN)
    private readonly connection: DatabaseConnection,
  ) {}

  get client() {
    return this.connection.client;
  }

  get db() {
    return this.connection.db;
  }

  // main.ts calls this before listening so a fresh container/volume gets its schema. The e2e
  // suites drive drizzle's migrator directly against a temp dir instead, so they don't depend
  // on the bundled assets being present.
  async runMigrations() {
    await runMigrations(this.connection);
  }

  // Cheap liveness check for the readiness probe. Deliberately dialect-specific: the sqlite
  // driver is synchronous and has no `query`, so there is no one call that covers all three.
  async ping(): Promise<void> {
    if (this.connection.client === 'sqlite') {
      this.connection.raw.prepare('select 1').get();
    } else {
      await this.connection.raw.query('select 1');
    }
  }

  // Nest calls this on app.close() unconditionally; main.ts additionally calls
  // enableShutdownHooks() so it also fires on SIGTERM/SIGINT. Without it the underlying driver
  // handle (better-sqlite3's fd, pg/mysql's socket) outlives the container — harmless on POSIX,
  // where a test's afterAll can still unlink an open sqlite file, but wrong for graceful shutdown
  // and for the pg/mysql pool's own connection bookkeeping.
  async onModuleDestroy() {
    if (this.connection.client === 'sqlite') {
      this.connection.raw.close();
    } else {
      await this.connection.raw.end();
    }
  }
}
