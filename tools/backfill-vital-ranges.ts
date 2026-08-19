import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleMysql } from 'drizzle-orm/mysql2';
import { Client as PgClient } from 'pg';
import mysql from 'mysql2/promise';
import { resolveDatabaseConfig } from '../apps/api/src/app/persistence/database.config';
import * as schema from '../apps/api/src/db/schema';
import {
  ensureVitalAnalytes,
  seedPatientVitalRanges,
} from '../apps/api/src/app/analytes/vital-analytes';

/**
 * One-time backfill: give patients that predate the seeded temperature band one of their own.
 *
 * **Run once.** New patients are seeded at creation, so this exists only to catch the ones already
 * in the database. It is deliberately a tool rather than a boot step or a migration:
 *
 * - A boot step would re-seed on every restart, which would turn a caregiver's deliberate delete of
 *   the band into something the app silently undoes — the opposite of the row being theirs.
 * - A migration would need portable UUID and timestamp generation across both dialects, and would
 *   still only run once, which is exactly what running this once achieves.
 *
 * Safe to run twice regardless: `seedPatientVitalRanges` skips any patient that already has a
 * temperature band, whoever created it.
 */
async function main() {
  const config = resolveDatabaseConfig();

  if (config.client === 'postgres') {
    const client = new PgClient({ connectionString: config.url });
    await client.connect();
    await backfill(drizzlePostgres(client, { schema }));
    await client.end();
    return;
  }

  if (config.client === 'mysql') {
    const pool = mysql.createPool({ uri: config.url });
    await backfill(drizzleMysql(pool, { schema }));
    await pool.end();
    return;
  }

  const sqlite = new Database(config.sqliteFile);
  await backfill(drizzleSqlite(sqlite, { schema }));
  sqlite.close();
}

async function backfill(db: any) {
  const metrics = await ensureVitalAnalytes(db);
  console.log(`Vital catalog rows present: ${metrics.size}.`);

  const rows = await db.select({ id: schema.patients.id, fullName: schema.patients.fullName }).from(schema.patients);
  let seeded = 0;
  for (const patient of rows) {
    const before = await db
      .select({ id: schema.analyteRanges.id })
      .from(schema.analyteRanges)
      .where(eq(schema.analyteRanges.patientId, patient.id));
    await seedPatientVitalRanges(db, patient.id);
    const after = await db
      .select({ id: schema.analyteRanges.id })
      .from(schema.analyteRanges)
      .where(eq(schema.analyteRanges.patientId, patient.id));
    if (after.length > before.length) {
      seeded += 1;
      console.log(`  seeded temperature band for ${patient.fullName}`);
    }
  }
  console.log(`Done. ${seeded} of ${rows.length} patient(s) needed a temperature band.`);
}

main().catch((err) => {
  console.error('Failed to backfill vital ranges', err);
  process.exit(1);
});
