# Tooling and Infrastructure

## API persistence
- Use Drizzle ORM for all database access in the API.
- Database configuration must be provided via environment variables (e.g., connection URL/credentials); default to SQLite when no env overrides are set.
- Supported DB clients: SQLite (default), PostgreSQL, MySQL. Switching should be done via env vars without code changes.
  - **Reality check:** only SQLite is exercised. `apps/api/src/db/schema.ts` is written entirely
    against Drizzle's `sqlite-core`, and `apps/api/src/db/migrations/` contains a `sqlite/`
    directory only. The connection layer in `database.providers.ts` really does dial Postgres and
    MySQL, but the schema objects the services query are SQLite-dialect objects, so those two
    paths have never worked end to end. Treat Postgres as a planned port, not a supported option.
    Note also that the Postgres branch opens a single `pg.Client`, not a pool, with no reconnect.
  - The deployed instance runs SQLite on a persistent volume — see `deployment.md`.
- Any changes to the DB schema must be acompanied by a migration script to ensure no data loss occurs because of the change.
  - Migrations accumulate and are applied by the API at boot. See `development.md` for why they
    are no longer flattened to a single file.

## File storage
- File storage backend must be selectable via environment variables with associated configuration (e.g., bucket/path, credentials).
- Default to local filesystem storage when no env overrides are set.

## Local storage location
- The local storage should be in a /data directory when this application is built into a docker container by default
- The sqlite db file should be stored directly in the /data directory
- Photo uploads should be stored under `/data/attachments` (phase 2 will expand this to additional attachment types such as after-visit summaries).
