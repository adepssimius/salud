# Tooling and Infrastructure

## API persistence
- Use Drizzle ORM for all database access in the API.
- Database configuration must be provided via environment variables (e.g., connection URL/credentials); default to SQLite when no env overrides are set.
- Supported DB clients: **SQLite (default) and PostgreSQL are both fully supported**, switched via
  `DB_CLIENT`/`DATABASE_URL` env vars with no code changes required. MySQL is not: the connection
  layer in `database.providers.ts` dials it, but no schema was ever ported — `resolveMigrationsFolder`
  has no `mysql` directory to point at, and `migrator.ts` throws for it. Treat it as unimplemented,
  not merely untested.
  - SQLite is not a dev-only fallback — it is the default, zero-config path a self-hoster gets with
    no environment configuration at all, and stays a first-class deployment target for exactly that
    reason. **This** instance (salud.bpd.sh) runs Postgres; a fresh self-host runs SQLite until its
    operator opts into Postgres. Neither is "the real one."
  - The schema lives in two hand-maintained, structurally identical modules —
    `apps/api/src/db/schema.sqlite.ts` (`sqlite-core`) and `apps/api/src/db/schema.pg.ts` (`pg-core`)
    — resolved by `apps/api/src/db/schema.ts` at import time from `DB_CLIENT`. Every service imports
    table objects from that resolver, never from either dialect module directly.
    `apps/api/src/db/schema-parity.spec.ts` is what keeps the two modules from drifting: it
    diffs table/column/FK shape between them via Drizzle's `getTableConfig` and fails the build on
    any mismatch. It is a release gate, not a lint — a drifted SQLite schema is a broken product for
    every self-hoster, silently, since nothing else would catch it.
  - `apps/api/src/db/migrations/` has two independent lineages, `sqlite/` and `postgres/`. They are
    never cross-applied and never need to agree file-for-file — only the schemas they build need to
    match, which is what the parity test checks. **A schema change generates a migration in both**
    (`yarn drizzle-kit generate` once per `DB_CLIENT` — see `development.md`); the parity test catches
    a schema drifted between the two modules, but nothing catches a migration generated for only one
    of them, so that step is on the author.
  - The Postgres connection is a `pg.Pool`, not a single `pg.Client` — the earlier single-client
    version had no reconnect, so any dropped connection took the whole api process down with it.
  - Test suites (`apps/api/src/testing/create-test-app.ts`) run against `@electric-sql/pglite` by
    default — real Postgres compiled to WASM, in-process, no Docker required — selected via `TEST_DB`
    (`TEST_DB=sqlite` runs the identical suite against SQLite instead). CI runs both legs
    (`.github/workflows/ci.yml`) for the same reason the parity test exists: a Postgres-only green
    run says nothing about the SQLite build a self-hoster actually gets.
  - Column mapping SQLite → Postgres, applied uniformly across `schema.pg.ts`:
    `{ mode: 'timestamp' }` → `timestamp({ withTimezone: true, mode: 'date' })` (both sides return a
    JS `Date`, so `persistence/time.ts`'s `normalizeTs`/`toDate` need no changes); `{ mode: 'boolean' }`
    → `boolean`; `real` → `doublePrecision` (not `real` — Postgres `real` is 4-byte and would lose
    precision on doses/weights); JSON-in-`text` columns stay `text`, deliberately not `jsonb` — that
    would make Drizzle return parsed objects and break every existing `JSON.parse` call site.
  - Foreign keys are **enforced by Postgres** and were never enforced by SQLite here (the
    `foreign_keys` pragma is never set). `patients.service.ts`'s `deletePatientRows` was already
    written FK-safe for exactly this reason — see its header comment — but it's worth remembering
    when adding a new cross-entity write path: SQLite will not catch an ordering bug Postgres would.
  - Moving an existing SQLite instance's data to Postgres is a supported operation, not a one-off
    migration: `yarn migrate:sqlite-to-postgres` (`tools/sqlite-to-postgres.ts`). It pre-flights for
    orphaned rows (possible under SQLite's unenforced FKs, fatal under Postgres's enforced ones),
    copies every table in an FK-safe order computed from the schema itself, and verifies row counts
    match before declaring success.
- Any changes to the DB schema must be acompanied by a migration script to ensure no data loss occurs because of the change.
  - Migrations accumulate and are applied by the API at boot. See `development.md` for why they
    are no longer flattened to a single file.

## File storage
- File storage backend must be selectable via environment variables with associated configuration
  (e.g., bucket/path, credentials).
- Default to local filesystem storage when no env overrides are set.
- Supported storage drivers: **`local` (default) and `s3` are both fully supported**, switched via
  `FILE_STORAGE_DRIVER` with no code changes required.
  - As with SQLite, `local` is not a dev-only fallback — it is the zero-config path a self-hoster
    gets with no environment configuration at all, and stays a first-class deployment target.
    Neither driver is "the real one."
  - `s3` targets the S3 **API**, not the AWS service specifically. Setting `S3_ENDPOINT` points it
    at any S3-compatible object store (Ceph RGW, MinIO, Cloudflare R2, Backblaze B2); leaving it
    unset targets real AWS S3 via region-derived endpoints.
  - The driver contract is `FileStorageDriver` (`apps/api/src/app/storage/file-storage.driver.ts`):
    `write` / `read` / `createReadStream` / `delete`, implemented by `local.driver.ts` and
    `s3.driver.ts`. `StorageService` is a thin facade over whichever one the config selected, so
    every consumer (`files.service.ts`, `lab-imports.service.ts`, `patients.service.ts`) is
    driver-agnostic and no service branches on the driver name.
  - An unknown `FILE_STORAGE_DRIVER`, or `s3` without `S3_BUCKET`, **fails at boot** rather than on
    the first upload — same fail-fast posture as `DATABASE_URL` for postgres, and for the same
    reason: a storage misconfiguration that surfaces hours later looks like data loss.

### Storage environment variables

| Variable | Driver | Default / behavior |
| --- | --- | --- |
| `FILE_STORAGE_DRIVER` | both | `local`. Any value outside `local`/`s3` throws at boot. |
| `FILE_STORAGE_LOCAL_BASE_PATH` | local | `<DATA_DIR>/attachments` |
| `S3_BUCKET` | s3 | **required** — throws at boot if missing |
| `S3_REGION` | s3 | `us-east-1` (what Ceph RGW and MinIO expect) |
| `S3_ENDPOINT` | s3 | unset = real AWS; set = an S3-compatible store |
| `S3_FORCE_PATH_STYLE` | s3 | defaults to `true` when `S3_ENDPOINT` is set, `false` otherwise |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | s3 | both-or-neither; neither = the AWS default credential chain (IRSA, instance profile) |
| `S3_PREFIX` | s3 | optional key prefix, e.g. `salud/attachments/` |

`.env.example` at the repo root is the working copy of this table.

### Switching drivers is a data migration, not a config change

`file_assets.bucket` records which store a blob was written to (the bucket name under `s3`, the
literal `local` otherwise), but **reads always resolve through the currently configured driver** —
nothing dual-reads on that column. Flipping `FILE_STORAGE_DRIVER` on a populated instance without
copying the blobs across leaves every existing attachment unreadable. There is no
`migrate:local-to-s3` tool today; the column exists so one could be written.

## Local storage location
- The local storage should be in a /data directory when this application is built into a docker container by default
- The sqlite db file should be stored directly in the /data directory
- Photo uploads should be stored under `/data/attachments` (phase 2 will expand this to additional attachment types such as after-visit summaries).
- Under the `s3` driver `/data` holds only the SQLite file (if any); attachments leave the volume
  entirely. See `deployment.md` → "State" for what that unlocks.
