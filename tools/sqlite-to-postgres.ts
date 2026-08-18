// One-time (per instance) data migration from a SQLite deployment to Postgres. Both are fully
// supported production targets (app-spec/persistence.md → self-hosting vs. this deployment), so
// "outgrew SQLite, moving to Postgres" is a path other self-hosters walk too, not just this
// cluster's cutover — hence a real, documented `yarn` script rather than a throwaway script.
// There is deliberately no reverse (postgres-to-sqlite) direction.
//
// Usage:
//   DATABASE_FILE=/path/to/salud.db DATABASE_URL=postgresql://... yarn migrate:sqlite-to-postgres
//   (add --force to proceed even if the Postgres target already has rows)
//
// What it does, in order:
//   1. Opens both databases directly through Drizzle, using the *same* schema.sqlite.ts/
//      schema.pg.ts modules the app itself runs on — no bespoke row-shape code to keep in sync.
//   2. Pre-flight: scans every FK edge (read straight off schema.pg.ts via getTableConfig, so it
//      can never drift from the real constraint list) for orphaned rows. SQLite here has never
//      enforced foreign keys (the `foreign_keys` pragma is never set — see patients.service.ts),
//      so a real instance can genuinely have them; importing them straight into an FK-enforcing
//      Postgres would abort a big transactional copy halfway through. Reported and refused,
//      not silently dropped — the user decides what to do with them.
//   3. Refuses to run against a non-empty Postgres target unless --force.
//   4. Copies every table in FK-safe order, computed by topologically sorting that same FK graph
//      rather than a hand-maintained list — the order can't go stale as tables are added.
//   5. Verifies row counts match per table; exits non-zero on any mismatch. This is the actual
//      proof the migration is complete, not just that it ran without throwing.
//
// Column values need no conversion: reading through schema.sqlite.ts already hands back native JS
// Date objects for `{ mode: 'timestamp' }` columns and booleans for `{ mode: 'boolean' }` columns
// (Drizzle's own read-side mapping — see persistence/time.ts's header for the epoch-seconds
// wire format this sits behind), and schema.pg.ts's insert side accepts exactly those same JS
// types. JSON-in-text columns are opaque strings on both ends and pass through untouched.
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { getTableConfig as getSqliteTableConfig } from 'drizzle-orm/sqlite-core';
import { Pool } from 'pg';
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres';
import { getTableConfig as getPgTableConfig } from 'drizzle-orm/pg-core';
import * as sqliteSchema from '../apps/api/src/db/schema.sqlite';
import * as pgSchema from '../apps/api/src/db/schema.pg';

const FORCE = process.argv.includes('--force');

const SQLITE_FILE = process.env.DATABASE_FILE;
const DATABASE_URL = process.env.DATABASE_URL;

if (!SQLITE_FILE) {
  console.error('DATABASE_FILE is required — path to the source SQLite file.');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required — postgres connection string for the target.');
  process.exit(1);
}

interface TableEntry {
  exportName: string;
  name: string;
  sqliteTable: any;
  pgTable: any;
}

interface FkEdge {
  childTable: string;
  childColumns: string[];
  parentTable: string;
  parentColumns: string[];
}

function loadTables(): TableEntry[] {
  const sqliteEntries = Object.entries(sqliteSchema) as [string, any][];
  return sqliteEntries.map(([exportName, sqliteTable]) => {
    const pgTable = (pgSchema as any)[exportName];
    if (!pgTable) {
      throw new Error(
        `schema.sqlite.ts exports '${exportName}' but schema.pg.ts does not — ` +
          `schema-parity.spec.ts should have caught this before it got here.`,
      );
    }
    return { exportName, name: getSqliteTableConfig(sqliteTable).name, sqliteTable, pgTable };
  });
}

function loadFkEdges(tables: TableEntry[]): FkEdge[] {
  const edges: FkEdge[] = [];
  for (const t of tables) {
    const config = getPgTableConfig(t.pgTable);
    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      edges.push({
        childTable: t.name,
        childColumns: ref.columns.map((c: any) => c.name),
        parentTable: getPgTableConfig(ref.foreignTable).name,
        parentColumns: ref.foreignColumns.map((c: any) => c.name),
      });
    }
  }
  return edges;
}

// Kahn's algorithm over the FK graph (parent before child) — computed fresh from schema.pg.ts
// every run, so adding a table never requires updating a hand-maintained order here.
function topologicalOrder(tables: TableEntry[], edges: FkEdge[]): TableEntry[] {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const dependsOn = new Map<string, Set<string>>(tables.map((t) => [t.name, new Set()]));
  for (const edge of edges) {
    if (edge.parentTable === edge.childTable) continue; // no self-referencing FKs in this schema
    dependsOn.get(edge.childTable)!.add(edge.parentTable);
  }

  const ordered: TableEntry[] = [];
  const placed = new Set<string>();
  while (placed.size < tables.length) {
    const ready = tables.filter(
      (t) => !placed.has(t.name) && [...dependsOn.get(t.name)!].every((p) => placed.has(p)),
    );
    if (ready.length === 0) {
      const stuck = tables.filter((t) => !placed.has(t.name)).map((t) => t.name);
      throw new Error(`FK graph has a cycle among: ${stuck.join(', ')} — cannot order safely.`);
    }
    // Stable within a batch: preserve schema.sqlite.ts's own export order.
    ready.sort((a, b) => tables.indexOf(a) - tables.indexOf(b));
    for (const t of ready) {
      ordered.push(t);
      placed.add(t.name);
    }
  }
  return ordered;
}

async function main() {
  const tables = loadTables();
  const edges = loadFkEdges(tables);
  const order = topologicalOrder(tables, edges);

  const sqliteRaw = new Database(SQLITE_FILE!, { readonly: true });
  const sqliteDb = drizzleSqlite(sqliteRaw);

  const pgPool = new Pool({ connectionString: DATABASE_URL });
  const pgDb = drizzlePostgres(pgPool);

  try {
    console.log(`Source: ${SQLITE_FILE}`);
    console.log(`Target: ${DATABASE_URL.replace(/:[^:@]*@/, ':***@')}`);
    console.log(`${tables.length} tables, ${edges.length} FK edges.\n`);

    // 1. Pre-flight orphan check. SQLite here never enforces FKs (no PRAGMA foreign_keys=ON), so
    // a real instance can have rows a strict import would reject partway through.
    console.log('Checking for orphaned rows (SQLite never enforced foreign keys)...');
    let orphanCount = 0;
    for (const edge of edges) {
      const child = tables.find((t) => t.name === edge.childTable)!;
      const parent = tables.find((t) => t.name === edge.parentTable)!;
      const childCol = edge.childColumns[0];
      const parentCol = edge.parentColumns[0];
      const rows = sqliteRaw
        .prepare(
          `SELECT COUNT(*) AS n FROM "${child.name}" c ` +
            `WHERE c."${childCol}" IS NOT NULL AND NOT EXISTS ` +
            `(SELECT 1 FROM "${parent.name}" p WHERE p."${parentCol}" = c."${childCol}")`,
        )
        .get() as { n: number };
      if (rows.n > 0) {
        orphanCount += rows.n;
        console.error(
          `  ${rows.n} row(s) in "${child.name}" have a "${childCol}" not present in ` +
            `"${parent.name}"."${parentCol}"`,
        );
      }
    }
    if (orphanCount > 0) {
      console.error(
        `\nRefusing to import: ${orphanCount} orphaned row(s) found. Postgres enforces the ` +
          `foreign keys SQLite never did — clean these up (or decide they're acceptable to drop) ` +
          `before migrating. No changes have been made to either database.`,
      );
      process.exit(1);
    }
    console.log('  none found.\n');

    // 2. Refuse a non-empty target unless --force.
    if (!FORCE) {
      let total = 0;
      for (const t of order) {
        const { rows } = await pgPool.query(`SELECT COUNT(*)::int AS n FROM "${t.name}"`);
        total += rows[0].n;
      }
      if (total > 0) {
        console.error(
          `Refusing to import: the target already has ${total} row(s) across its tables. ` +
            `Pass --force to import anyway (existing rows are not touched or deduplicated — ` +
            `only use this on a target you know is meant to receive this data).`,
        );
        process.exit(1);
      }
    }

    // 3. Copy, in FK-safe order.
    const counts: { table: string; source: number; target: number }[] = [];
    for (const t of order) {
      const rows = await (sqliteDb as any).select().from(t.sqliteTable);
      if (rows.length > 0) {
        // Batched to keep any single statement's parameter count sane on large tables.
        const BATCH = 500;
        for (let i = 0; i < rows.length; i += BATCH) {
          await (pgDb as any).insert(t.pgTable).values(rows.slice(i, i + BATCH));
        }
      }
      console.log(`  ${t.name}: ${rows.length} row(s)`);
      counts.push({ table: t.name, source: rows.length, target: -1 });
    }

    // 4. Verify. This, not "the loop above didn't throw", is the actual proof of completeness.
    console.log('\nVerifying row counts...');
    let mismatch = false;
    for (const c of counts) {
      const { rows } = await pgPool.query(`SELECT COUNT(*)::int AS n FROM "${c.table}"`);
      c.target = rows[0].n;
      const ok = c.target === c.source;
      if (!ok) mismatch = true;
      console.log(
        `  ${c.table}: source=${c.source} target=${c.target} ${ok ? 'OK' : 'MISMATCH'}`,
      );
    }

    if (mismatch) {
      console.error('\nRow count mismatch — the import did not complete cleanly.');
      process.exit(1);
    }
    console.log('\nDone. All row counts match.');
  } finally {
    sqliteRaw.close();
    await pgPool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
