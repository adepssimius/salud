# Tooling and Infrastructure

## API persistence
- Use Drizzle ORM for all database access in the API.
- Database configuration must be provided via environment variables (e.g., connection URL/credentials); default to SQLite when no env overrides are set.
- The code should make it easy to swap databases (e.g., Postgres later) by changing env vars without code changes.
- Any changes to the DB schema must be acompanied by a migration script to ensure no data loss occurs because of the change.

## File storage
- File storage backend must be selectable via environment variables with associated configuration (e.g., bucket/path, credentials).
- Default to local filesystem storage when no env overrides are set.

## Local storage location
- The local storage should be in a /data directory when this application is built into a docker container by default
- The sqlite db file should be stored directly in the /data directory
- Photo uploads should be stored under `/data/attachments` (phase 2 will expand this to additional attachment types such as after-visit summaries).
