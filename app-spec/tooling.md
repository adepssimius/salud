# Tooling and Infrastructure

## API persistence
- Use Drizzle ORM for all database access in the API.
- Database configuration must be provided via environment variables (e.g., connection URL/credentials); default to SQLite when no env overrides are set.
- Supported database clients: SQLite (default), PostgreSQL, MySQL. Swapping clients should require only env var changes.
- Any changes to the DB schema must be accompanied by a migration script to prevent data loss.

## File storage
- File storage backend must be selectable via environment variables with associated configuration (e.g., bucket/path, credentials).
- Default to local filesystem storage when no env overrides are set.
