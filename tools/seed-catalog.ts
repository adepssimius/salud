import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { and, eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleMysql } from 'drizzle-orm/mysql2';
import { Client as PgClient } from 'pg';
import mysql from 'mysql2/promise';
import { resolveDatabaseConfig } from '../apps/api/src/app/persistence/database.config';
import { ensureVitalAnalytes } from '../apps/api/src/app/analytes/vital-analytes';
import * as schema from '../apps/api/src/db/schema';
import { parseCatalogFile } from '../apps/api/src/app/medications/catalog-seed/catalog-file';
import {
  applyCatalogSelection,
  loadCatalogState,
  reconcileCatalog,
} from '../apps/api/src/app/medications/catalog-seed/catalog-reconcile';
import type { VitalMetric } from '../libs/shared/types/src/lib/types';

// The catalog data itself lives in catalog/medication-catalog.json -- the same file "Check repo
// catalog" fetches from GitHub (app-spec/development.md -> "The repo catalog file"). This script
// reads the local checkout's copy and adds everything missing through the API's own reconcile
// code, so a dev seed and the button can never disagree about what is missing.
const CATALOG_PATH = path.join(__dirname, '..', 'catalog', 'medication-catalog.json');

async function main() {
  const config = resolveDatabaseConfig();

  if (config.client === 'postgres') {
    const client = new PgClient({ connectionString: config.url });
    await client.connect();
    const db = drizzlePostgres(client, { schema });
    await seedCatalog(db);
    await client.end();
    return;
  }

  if (config.client === 'mysql') {
    const pool = mysql.createPool({ uri: config.url });
    const db = drizzleMysql(pool, { schema });
    await seedCatalog(db);
    await pool.end();
    return;
  }

  const sqlite = new Database(config.sqliteFile);
  const db = drizzleSqlite(sqlite, { schema });
  await seedCatalog(db);
  sqlite.close();
}

async function seedCatalog(db: any) {
  const file = parseCatalogFile(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const rec = reconcileCatalog(file, await loadCatalogState(db));

  // Everything offered, nothing more: only-inserts is the reconcile's own rule, so a medication a
  // caregiver already has (matched by name, case-insensitively) is left exactly as it is, edits and
  // all. The dev databases this runs against are small and local, so no transaction per item.
  const select = [...rec.ops.keys()];
  const result = await applyCatalogSelection((fn) => fn(db), rec, select);

  for (const p of rec.present.filter((p) => p.kind === 'medication')) {
    console.log(`Medication already present (${p.medicationName}); left as is.`);
  }
  for (const id of result.added) console.log(`Added ${id}.`);
  if (!result.added.length) console.log('Catalog already has everything in medication-catalog.json.');

  await seedChartOverlayDefaults(db);
}

// Which dose markers a metric's chart shows by default (data-model.md -> ChartOverlayDefault).
// Seeded here rather than at boot, and beside the medications whose tags these reference: the two
// only mean anything together. A caregiver's delete is permanent unless someone re-runs this
// script deliberately -- the same rule the seeded temperature range follows.
//
// Display defaults only. A row says "show antipyretic doses on the temperature chart", never
// "antipyretics affect temperature" (P6).
const OVERLAY_DEFAULTS: ReadonlyArray<{ metric: VitalMetric; tag: string }> = [
  { metric: 'temperature', tag: 'antipyretic' },
  { metric: 'pain_score', tag: 'analgesic' },
];

async function seedChartOverlayDefaults(db: any) {
  // The vitals are seeded rows; this resolves (and creates, first time) the catalog rows the
  // defaults hang off, using the same helper the API boots with.
  const vitalIds = await ensureVitalAnalytes(db);

  for (const { metric, tag } of OVERLAY_DEFAULTS) {
    const analyteId = vitalIds.get(metric);
    if (!analyteId) {
      console.log(`No seeded ${metric} vital found; skipping its chart overlay default.`);
      continue;
    }
    // Idempotent on the (analyte, kind, value) triple, so a second run adds nothing.
    const existing = await db
      .select()
      .from(schema.chartOverlayDefaults)
      .where(
        and(
          eq(schema.chartOverlayDefaults.analyteId, analyteId),
          eq(schema.chartOverlayDefaults.kind, 'medication_tag'),
          eq(schema.chartOverlayDefaults.value, tag),
        ),
      )
      .limit(1);
    if (existing.length) {
      console.log(`Chart overlay default already seeded (${metric} -> ${tag}); skipping.`);
      continue;
    }
    await db.insert(schema.chartOverlayDefaults).values({
      id: randomUUID(),
      analyteId,
      kind: 'medication_tag',
      value: tag,
    });
    console.log(`Seeded chart overlay default: ${tag} doses show by default on the ${metric} chart.`);
  }
}

main().catch((err) => {
  console.error('Failed to seed medication catalog', err);
  process.exit(1);
});
