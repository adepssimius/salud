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
  // driver is synchronous and has no `query`, so there is no one call that covers all four. pg,
  // mysql2 and pglite all expose an async `.query(sql)` on their raw handle, so they share the
  // `else` branch.
  async ping(): Promise<void> {
    if (this.connection.client === 'sqlite') {
      this.connection.raw.prepare('select 1').get();
    } else {
      // pg.Pool, mysql2.Pool and PGlite each overload `.query` differently enough that TS can't
      // call it across the narrowed union — same `as any` escape hatch as everywhere else in the
      // service layer (CLAUDE.md → Conventions), just at the connection-raw layer instead of the
      // query-builder layer.
      await (this.connection.raw as any).query('select 1');
    }
  }

  // Run `fn` inside a transaction, whatever the dialect. Deliberately dialect-specific for the
  // same reason `ping()` above is: drizzle's better-sqlite3 `transaction()` is *synchronous* and
  // throws `TypeError: Transaction function cannot return a promise` on an async callback, while
  // `NodePgDatabase.transaction` is async. No single callback shape satisfies both, so the
  // `this.db.db as any` escape hatch used everywhere else cannot paper over the difference.
  //
  // CAUTION on sqlite: the transaction is per-*connection*, and there is exactly one connection
  // for the whole process. If `fn` awaits anything slow, Node is free to run another request's
  // queries on that same connection inside our BEGIN — and a rollback would take their writes
  // with it. Callers must therefore keep the body to a straight run of statements with no reads
  // and no I/O between BEGIN and COMMIT. Do any lookups before calling, and any filesystem work
  // after returning.
  async withTransaction<T>(fn: (db: any) => Promise<T>): Promise<T> {
    if (this.connection.client === 'sqlite') {
      const raw = this.connection.raw;
      raw.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(this.connection.db as any);
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    }
    return await (this.connection.db as any).transaction((tx: any) => fn(tx));
  }

  // Nest calls this on app.close() unconditionally; main.ts additionally calls
  // enableShutdownHooks() so it also fires on SIGTERM/SIGINT. Without it the underlying driver
  // handle (better-sqlite3's fd, pg/mysql's socket, pglite's WASM instance) outlives the
  // container — harmless on POSIX, where a test's afterAll can still unlink an open sqlite file,
  // but wrong for graceful shutdown and for the pg/mysql pool's own connection bookkeeping.
  // pglite's handle is closed, not ended — it isn't a pool of anything.
  async onModuleDestroy() {
    if (this.connection.client === 'sqlite' || this.connection.client === 'pglite') {
      await this.connection.raw.close();
    } else {
      await this.connection.raw.end();
    }
  }
}
