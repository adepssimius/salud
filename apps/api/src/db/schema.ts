// Dialect resolver. `apps/api/src/db/schema.sqlite.ts` and `schema.pg.ts` are two hand-maintained,
// structurally identical table definitions — one against drizzle's sqlite-core, one against
// pg-core. Every service imports table objects from *this* file, never from either dialect module
// directly, so a service never has to know or care which database it's talking to.
//
// The two modules are kept in lockstep by `schema-parity.spec.ts`, which fails the build the
// moment they drift — see CLAUDE.md → Migrations and app-spec/development.md for the "every schema
// change generates two migrations" rule this depends on. SQLite is a fully supported deployment
// target (self-hosting), not a dev-only fallback, so that parity guarantee is load-bearing, not
// cosmetic.
//
// `pglite` (the in-process WASM Postgres used by the e2e suite) resolves to the pg schema — it *is*
// Postgres, just embedded, so it must never get its own dialect branch here or in migrator.ts.
import * as pgSchema from './schema.pg';
import * as sqliteSchema from './schema.sqlite';

const client = process.env.DB_CLIENT ?? process.env.DATABASE_CLIENT ?? 'sqlite';

// The two modules are structurally identical (same table and column names/shapes; guarded by
// schema-parity.spec.ts) but are, unavoidably, two distinct TypeScript types — one built from
// sqlite-core column builders, one from pg-core's. Services already reach for `this.db.db as any`
// at every call site (CLAUDE.md → Conventions) because Drizzle's own multi-dialect `db` union has
// the same problem one layer down, so this cast doesn't remove type safety that existed to begin
// with; it just states, once, at the one place it's decided, that the resolved module's shape is
// the sqlite one.
const schema = (client === 'sqlite' ? sqliteSchema : pgSchema) as unknown as typeof sqliteSchema;

export const {
  users,
  patients,
  conditions,
  protocols,
  careTeamMemberships,
  episodes,
  observations,
  observationEntries,
  interventions,
  episodesEventsPivot,
  analytes,
  analyteRanges,
  medications,
  medicationEmbodiments,
  medicationGuidelines,
  adverseReactions,
  interventionSchedules,
  fileAssets,
  careDocumentStatements,
  advisories,
  erBriefSnapshots,
  revisions,
} = schema;
