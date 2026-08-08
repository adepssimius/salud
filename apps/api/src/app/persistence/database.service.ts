import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  DATABASE_CONNECTION_TOKEN,
  DatabaseConnection,
} from './database.providers';

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
