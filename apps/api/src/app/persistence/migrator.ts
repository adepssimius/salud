import fs from 'fs';
import path from 'path';
import { Logger } from '@nestjs/common';
import { DatabaseConnection } from './database.providers';

/**
 * Where the generated `.sql` lives depends on how the process was started:
 *
 * - In the container (and under `nx serve`, which also runs from `dist/api`) webpack has copied
 *   `apps/api/src/db/migrations` to `assets/migrations` next to `main.js` — see the `assets`
 *   entry in `apps/api/webpack.config.js`. Without that copy the image has no schema at all and
 *   every query 500s on a fresh volume.
 * - Under Jest the code runs from source, so fall back to the repo path.
 *
 * `MIGRATIONS_DIR` overrides both, and points at the dialect directory itself.
 */
export function resolveMigrationsFolder(client: DatabaseConnection['client']): string {
  const override = process.env.MIGRATIONS_DIR;
  if (override) return override;

  const bundled = path.join(__dirname, 'assets', 'migrations', client);
  if (fs.existsSync(bundled)) return bundled;

  return path.join(process.cwd(), 'apps/api/src/db/migrations', client);
}

/**
 * Applies any pending migrations. Drizzle records what it has already run in
 * `__drizzle_migrations`, keyed by the hash of each file, so this is idempotent — but it also
 * means a regenerated `0000_*.sql` is a *different* migration to a database that has already
 * seen the old one. See app-spec/development.md on why the flattened-migration policy stops
 * applying once an instance holds real data.
 *
 * The dialect migrators are imported lazily for the same reason the drivers are in
 * `database.providers.ts`: sqlite is the only one used in practice and loading all three costs
 * real startup time.
 */
export async function runMigrations(connection: DatabaseConnection): Promise<void> {
  const logger = new Logger('Migrator');
  const migrationsFolder = resolveMigrationsFolder(connection.client);
  logger.log(`Applying ${connection.client} migrations from ${migrationsFolder}`);

  if (connection.client === 'postgres') {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await migrate(connection.db, { migrationsFolder });
  } else if (connection.client === 'mysql') {
    const { migrate } = await import('drizzle-orm/mysql2/migrator');
    await migrate(connection.db, { migrationsFolder });
  } else {
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
    await runSqliteMigrations(connection, () => migrate(connection.db, { migrationsFolder }), logger);
  }

  logger.log('Migrations up to date');
}

/**
 * Runs the sqlite migrations with foreign-key enforcement suspended, then verifies the result.
 *
 * SQLite cannot drop a column's NOT NULL (or otherwise alter a column) in place, so drizzle-kit
 * emits the standard table-rebuild for those: create `__new_x`, copy the rows, `DROP TABLE x`,
 * rename. That drop is what needs foreign keys off — every table referencing `x` still points at
 * the rows being dropped, and `users` alone has ~18 referencing columns.
 *
 * **The pragma has to be set here, outside the transaction, and this is the whole point of this
 * function.** Two things make the obvious alternatives silently wrong:
 *
 *  - `PRAGMA foreign_keys=OFF` *inside* the migration file is a documented no-op: drizzle wraps
 *    every migration in one `BEGIN`/`COMMIT` (`sqlite-core/dialect.cjs`), and SQLite ignores that
 *    pragma inside a transaction. drizzle-kit generates exactly this, so a generated rebuild is
 *    broken out of the box.
 *  - `PRAGMA defer_foreign_keys=ON` *does* apply inside a transaction, but doesn't help either:
 *    deferred enforcement is a counter, and `DROP TABLE`'s implicit deletes increment it while the
 *    later `RENAME` never decrements it. The migration then fails at `COMMIT` instead of at the
 *    drop — same outage, less obvious stack trace.
 *
 * This shipped broken once (migration 0006, the OIDC `users` rebuild): it crash-looped the
 * production pod at boot while passing every test, because a from-empty database has no rows and
 * therefore no foreign key to violate. `migrations.e2e-spec.ts` now runs this path against a
 * populated database specifically to keep that from recurring.
 */
async function runSqliteMigrations(
  connection: DatabaseConnection,
  migrate: () => void,
  logger: Logger,
): Promise<void> {
  const raw = connection.raw as { pragma(source: string): unknown };
  // Read rather than assume: better-sqlite3 turns foreign keys on by default, but a caller that
  // has already turned them off should get them left off.
  const wasEnabled = isForeignKeysEnabled(raw);

  if (wasEnabled) raw.pragma('foreign_keys = OFF');
  try {
    migrate();

    // Belt and braces: with enforcement off, a genuinely broken migration would leave dangling
    // references behind instead of failing. Health records are the wrong place to find that out
    // later, so check before handing the database to the app — and while still able to say which
    // rows are wrong.
    const violations = raw.pragma('foreign_key_check') as unknown[];
    if (violations.length) {
      throw new Error(
        `Migrations left ${violations.length} foreign key violation(s): ${JSON.stringify(violations.slice(0, 5))}`,
      );
    }
  } finally {
    if (wasEnabled) raw.pragma('foreign_keys = ON');
  }
  logger.log('Foreign key integrity verified after migration');
}

function isForeignKeysEnabled(raw: { pragma(source: string): unknown }): boolean {
  const result = raw.pragma('foreign_keys') as Array<{ foreign_keys: number }> | number;
  // better-sqlite3 returns a row array by default, but `simple: true` callers see a scalar.
  if (Array.isArray(result)) return result[0]?.foreign_keys === 1;
  return result === 1;
}
