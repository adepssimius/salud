# Development Guide

- Use Yarn for all tooling commands (no `npx`).
- Migrations are flattened (single file) during this proof-of-concept phase. When schema changes:
  - Update the existing migration to match `apps/api/src/db/schema.ts`.
  - Delete the local SQLite DB (`rm data/salud.db`).
  - Re-run migrations: `yarn drizzle-kit migrate --config=drizzle.config.ts`.
- Seed a test user in development with: `yarn seed:test-user`
  - Creates `test@example.com` with password `test` and default unit prefs.
  - Honors DB env config (SQLite by default; `DB_CLIENT`/`DATABASE_URL` for Postgres/MySQL).
- API testing with Bruno:
  - Bruno request definitions live under `bruno/`.
- Use the provided `auth` collection (`register`, `login`, `me`) against `http://localhost:3000/api` (adjust base URL in Bruno as needed).
- Always validate critical flows with real API calls (curl/Bruno) using the running server; do not rely solely on automated tests to confirm behavior.
