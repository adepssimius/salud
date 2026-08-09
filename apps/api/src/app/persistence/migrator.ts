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
    migrate(connection.db, { migrationsFolder });
  }

  logger.log('Migrations up to date');
}
