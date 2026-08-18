// Runs once per test file, before that file's own module graph is required (Jest's `setupFiles`
// contract) — critically, before its imports transitively pull in `db/schema.ts`.
//
// `db/schema.ts` picks between `schema.sqlite.ts` and `schema.pg.ts` by reading `DB_CLIENT` at
// *module-load* time (see that file's header). `create-test-app.ts` used to set `DB_CLIENT` at
// the top of its exported function — but by the time that function runs (inside a suite's
// `beforeAll`), every top-level `import` in the test file, including any that reach `db/schema.ts`
// (directly, e.g. `import * as schema from '../../db/schema'`, or transitively through
// `AppModule` and its services), has already been evaluated. `DB_CLIENT` was still unset at that
// point, so the resolver silently defaulted to `'sqlite'` regardless of `TEST_DB` — every suite
// ran its queries through sqlite-shaped table objects against a real Postgres/pglite connection,
// which happened to produce mostly-working SQL (the two schemas are structurally identical) but
// wrong timestamp handling, since sqlite's `{ mode: 'timestamp' }` column expects the raw driver
// value to be an epoch-seconds integer, not the `Date` pglite's driver actually returns.
//
// Setting it here, in a file Jest guarantees runs first, closes that gap.
process.env.DB_CLIENT = process.env.TEST_DB ?? 'pglite';
