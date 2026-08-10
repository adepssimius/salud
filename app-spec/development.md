# Development Guide

- Use Yarn for all tooling commands (no `npx`).
- **Migrations accumulate; they are no longer flattened.** The flatten-and-recreate loop below
  applied while nothing was deployed. Now that a deployed instance holds real data (see
  `deployment.md`), regenerating `0000_*.sql` is destructive: Drizzle records applied migrations
  in `__drizzle_migrations` keyed by each file's hash, so an edited `0000` is a *different*
  migration to a database that already ran the old one — it re-applies against a populated
  schema and fails, or silently diverges. When schema changes:
  - Update `apps/api/src/db/schema.ts`.
  - Generate a **new** migration: `yarn drizzle-kit generate --config=drizzle.config.ts`.
    Never edit or delete a migration that has been applied anywhere but your own machine.
  - Apply locally: `yarn drizzle-kit migrate --config=drizzle.config.ts`.
  - The deployed API applies pending migrations itself at boot, before it starts listening
    (`apps/api/src/main.ts` → `DatabaseService.runMigrations`). The generated SQL ships in the
    image via the `assets` entry in `apps/api/webpack.config.js`; if that copy is ever removed
    the container starts against an empty database and every request 500s.
  - A migration that fails at boot is a full outage for that pod, by design — the alternative is
    serving against a schema the code does not expect. Recover by reverting the image tag in
    k8s-infra, not with `kubectl rollout undo` (Flux would immediately undo the undo).
- Verify new APIs (especially access control) with real curl requests in addition to tests.
- Seed a test user in development with: `yarn seed:test-user`
  - Creates `test@example.com` with password `test` and default unit prefs.
  - Honors DB env config (SQLite by default; `DB_CLIENT`/`DATABASE_URL` for Postgres/MySQL).
- Seed a starter medication catalog with: `yarn seed:catalog` (`tools/seed-catalog.ts`)
  - Acetaminophen and ibuprofen, two embodiments each, and both a weight-based and an age-band
    guideline each — enough for dose guidance, atypical detection and schedules to be exercisable.
    Without it every dose-guidance feature is inert, since the catalog starts empty.
  - Idempotent: skips a medication whose `name` already exists. Honors the same DB env config.
  - **This is a script, never a boot-time seed.** `main.ts` applies migrations at boot but must not
    write rows — a deployed instance's catalog is the household's data, and inserting into it on
    every pod restart is a surprise write nobody asked for.
- API testing with Bruno:
  - Bruno request definitions live under `bruno/`.
- Use the provided `auth` collection (`register`, `login`, `me`) against `http://localhost:3000/api` (adjust base URL in Bruno as needed).
- Always validate critical flows with real API calls (curl/Bruno) using the running server; do not rely solely on automated tests to confirm behavior.
