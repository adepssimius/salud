# Development Guide

- Use Yarn for all tooling commands (no `npx`).
- Apply migrations before running the API: `yarn drizzle-kit push --config=drizzle.config.ts` (defaults to SQLite at `data/salud.db`).
- Seed a test user in development with: `yarn seed:test-user`
  - Creates `test@example.com` with password `test` and default unit prefs.
  - Honors DB env config (SQLite by default; `DB_CLIENT`/`DATABASE_URL` for Postgres/MySQL).
- API testing with Bruno:
  - Bruno request definitions live under `bruno/`.
  - Use the provided `auth` collection (`register`, `login`, `me`) against `http://localhost:3000/api` (adjust base URL in Bruno as needed).
