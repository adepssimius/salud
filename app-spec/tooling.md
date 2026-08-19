# Tooling and Infrastructure

## API persistence
- Use Drizzle ORM for all database access in the API.
- Database configuration must be provided via environment variables (e.g., connection URL/credentials); default to SQLite when no env overrides are set.
- Supported database clients: SQLite (default), PostgreSQL, MySQL. Swapping clients should require only env var changes.
- Any changes to the DB schema must be accompanied by a migration script to prevent data loss.
- Use `yarn drizzle-kit ...` for migration generation/application.

## File storage
- File storage backend must be selectable via environment variables with associated configuration (e.g., bucket/path, credentials).
- Default to local filesystem storage when no env overrides are set.
- Two drivers ship and both are fully supported: `local` (default, filesystem) and `s3` (any
  S3-compatible object store — AWS, Ceph RGW, MinIO, R2), selected by `FILE_STORAGE_DRIVER`.
  `persistence.md` → "File storage" is the authoritative description: the driver contract, the full
  env var table, the fail-fast boot validation, and why switching drivers on a populated instance
  is a data migration rather than a config change.

## API documentation/testing
- Use Bruno collections under `bruno/` to document and exercise APIs.
- Each area/folder should include:
  - `folder.bru` to define the folder.
  - Request `.bru` files using `{{protocol}}://{{host}}:{{port}}/{{apiPrefix}}` (from `bruno/bruno.json` environments) and inheriting auth where applicable (bearer tokens).
- Root `bruno/bruno.json` defines environments and variables (e.g., `host`, `port`, `token`). The current `bruno/` layout is the reference format.
- When implementing new API endpoints, add:
  - Automated tests (Jest/supertest) covering happy/error paths per spec.
  - Bruno requests under the appropriate folder using env vars and token capture when applicable.
- Bruno auth inheritance: the root collection and all folders/requests should inherit bearer auth except the `auth` folder (register/login) which should not require auth; child requests under other folders should not override auth unless necessary.
