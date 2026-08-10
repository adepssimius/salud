# Salud — Agent Orientation

Digital care logbook for a single household: track illnesses, observations, medication doses,
and interventions per patient, and share a reliable narrative across trusted caregivers.
Origin story matters for design decisions: parents doing sick-kid handoffs at 3 AM ("did I already
give Tylenol?"), logging from a phone in real time. Mobile-first entry, desktop-friendly analysis.

**`app-spec/` is the source of truth, not the code.** See "Working here" below.

## Stack

| Layer | Choice |
| --- | --- |
| Monorepo | Nx 22, Yarn 1 (`yarn <bin>`, never `npx`), Node 22.13.0 pinned via `.tool-versions` (asdf) |
| API | NestJS 11, `apps/api`, global prefix `/api`, JWT (passport-jwt) + Argon2id |
| DB | Drizzle ORM. SQLite default (better-sqlite3); Postgres/MySQL selectable by env only |
| Web | Angular 20, `apps/web`, standalone components, signals, lazy routes, inline templates + a global style vocabulary in `src/styles.css` |
| Shared | `libs/shared/types` → import as `@salud/shared/types` (plain types, zero decorators) |
| Tests | Jest + supertest (API, incl. `*.e2e-spec.ts`), jest-preset-angular (web), Cypress (`apps/web-e2e`) |
| API docs | Bruno collection in `bruno/` |

## Commands

```bash
yarn start:api && yarn start:web    # api on :3000, web on :4200 (proxies /api via proxy.conf.json)
```

- `yarn test:api` / `yarn test:web` — both green today.
- `yarn lint:api` / `yarn lint:web`, `yarn build:api` / `yarn build:web`, `yarn e2e:api` / `yarn e2e:web`
- `yarn seed:test-user` — creates `test@example.com` / password `test`
- `yarn seed:catalog` — acetaminophen + ibuprofen with embodiments and both guideline types
  (`tools/seed-catalog.ts`, idempotent by medication name). Dose guidance does nothing without it.
- `yarn drizzle-kit generate --config=drizzle.config.ts` then `yarn drizzle-kit migrate --config=drizzle.config.ts`

## Layout

```
app-spec/            # ← the spec. Read before coding.
apps/api/src/
  app/<feature>/     # auth, patients, observations, interventions, episodes, persistence, storage
                     #   <feature>.{controller,service,module}.ts + dto/ + <feature>.e2e-spec.ts
  db/schema.ts       # Drizzle schema (single file, all tables)
  db/migrations/sqlite/
apps/web/src/app/
  core/              # api-client.service, auth.service, auth.interceptor, api.config
  auth/ dashboard/ profile/ patients/ observations/ interventions/    # *.page.ts + *.page.spec.ts
libs/shared/types/src/lib/types.ts    # every shared DTO/domain type lives in this one file
bruno/               # one folder per API area, folder.bru + request .bru files
tools/seed-test-user.ts
data/                # local SQLite + attachments (gitignored)
```

## Implementation status vs. spec

The spec describes the whole Phase-1 product; most of it is now built. Current reality:

**Built** — the API surface is broadly complete; ~15 feature modules under `apps/api/src/app/`.
- Auth: `POST /api/auth/register|login`, `GET /api/auth/me`; `GET|PATCH /api/users/me`, `GET /api/users/search`
- Patients + care team, on the flat `/api/patients` prefix (the old nested `/api/users/:userId/patients`
  migration is **done** — code, web, Bruno and e2e all moved). `/users/me` and `/users/search` stay,
  being genuinely identity-scoped.
- Observations (multi-entry, weight denormalizes onto `patients.latest_weight_kg`), interventions,
  episodes, conditions + protocols, medications/embodiments/guidelines, intervention schedules
  (incl. `POST /api/schedules/:id/log`), adverse reactions, advisories, revisions, files, dosing
  engine (`POST .../dose-checks`), timeline + dashboard, What's-New, ER Brief + frozen snapshots.
- `yarn seed:catalog` seeds a starter medication catalog; without it every dose-guidance feature is
  inert, since the catalog starts empty.
- Web: auth, profile, patient detail + care team, new-observation/intervention, dashboard, timeline,
  episodes, conditions, schedules, medications, What's-New, ER Brief + the public `/brief/:token`.

**Gaps worth knowing**
- **Adverse reactions have no web UI** — `POST|GET /api/patients/:id/reactions` works and drives the
  `reaction_warning`/`reaction_danger` advisories, but the only way to enter one today is curl.
- `apps/api/src/app/api.spec.ts` is a 30-entry `test.todo` plan mirroring the spec — a useful
  checklist of what "done" means per area, and still largely unconverted.
- `medications.brandNames` exists in `schema.ts` and is searched by `GET /api/medications?q=`.

## Conventions to match

- **Types flow one way**: define the interface in `libs/shared/types` first → implement it with a
  `class-validator`-decorated DTO class in `apps/api/src/app/<feature>/dto/` → import the same interface
  in `apps/web`. Both apps fail to compile when they drift. Never put decorators in the lib.
- **Access control is per-service, not middleware.** Every service has a private
  `ensurePatientAccess(patientId, userId)` that checks `care_team_memberships` and throws
  `NotFoundException('PATIENT_NOT_FOUND')`. Call it at the top of every method touching patient data.
  A caller who is not on the care team gets 404, not 403 (intentional — don't leak existence).
- **Errors are machine-readable codes as the message string**: `PATIENT_NOT_FOUND`,
  `OBSERVATION_NOT_FOUND`, `EPISODE_NOT_FOUND`, `AT_LEAST_ONE_ENTRY_REQUIRED`,
  `RESOLVES_MUST_BE_SUBSET_OF_EPISODES`, `EMAIL_TAKEN`, `INVALID_CREDENTIALS`. A new code needs
  three things in the same change: the throw, a row in `app-spec/api.md` → "Error codes", and a
  sentence in `apps/web/src/app/core/error-display.ts`. Skip the third and the code silently
  degrades to that call site's generic fallback instead of reaching the user.
- **`this.db.db as any`** is the established (unlovely) escape hatch for the multi-dialect Drizzle union
  type. Follow it rather than inventing a new abstraction mid-feature.
- **Timestamps**: stored as SQLite integer epoch **seconds**; Drizzle hands back `Date` for
  `{ mode: 'timestamp' }` columns. Cross that boundary with `normalizeTs`/`toDate` from
  `apps/api/src/app/persistence/time.ts` — never hand-roll the coercion, and never copy a row's
  timestamp field straight into a response object. It serializes as an ISO string and nothing
  catches it (that was ISSUES #20, on three mappers at once). API responses use epoch seconds;
  request bodies take ISO datetime strings. `app-spec/api.md` → Conventions is the contract.
- **JSON-in-text columns**: `metadata`, `tags`, `explicit_times`, `unit_preference_at_entry` are
  `text` holding JSON. Services `JSON.stringify` on write and `JSON.parse` on read. No typed metadata
  validation yet (`observations.service.ts:42`).
- **Canonical units at the persistence boundary** (°C, kg, cm, bpm, %, 0–10); the entered unit is
  preserved in metadata for display, and user prefs drive conversion in the UI.
- **Angular pages** are standalone components in a single `*.page.ts` with inline `template:` and
  `styles:`, `inject()` for DI, `signal()` for state. Dark theme, hand-rolled CSS, no UI library.
- **Styling: reach for the global vocabulary first.** `apps/web/src/styles.css` holds the theme
  tokens (`--surface`, `--text-muted`, `--accent`, `--danger-text`, the radii) and the shared classes
  every page uses — `.card`, `.primary`/`.secondary`, `.field`, `.inline-check`, `.muted`, `.small`,
  `.error`, `.link`, `.pill` (+ `-danger`/`-neutral`/`-success`), `.events`, `.row-list`, plus the
  `input`/`h1`/`h2`/`form` defaults. A page's inline `styles:` is for what is genuinely specific to
  that page. Don't re-declare a global rule to change one value — override just that declaration, or
  reconsider whether the difference is intentional.
- **Routes are lazy.** Every entry in `app.routes.ts` uses `loadComponent`, including `login`. A
  static page import puts that page and its dependencies back in the initial bundle.
- **Every new endpoint needs three things**: a Jest/supertest case in `<feature>.e2e-spec.ts`,
  a Bruno request under the matching `bruno/` folder, and a real curl/Bruno check against a running
  server (the spec is explicit that automated tests alone are not sufficient for access control).
- Bruno auth: root + all folders inherit bearer auth; the `auth` folder is the only exception.

## Episode model — the thing to understand first

Episodes are manual frames over the timeline, e.g. "Fever Jan 2025".

- An episode is **started** by an observation/intervention (`startEpisodeName` in the create body) and
  **resolved** by one (`resolvesEpisodeIds`). No direct create/update endpoint.
- `episodes.started_at_type|started_at_id` and `ended_at_type|ended_at_id` point at either an
  observation or an intervention — that polymorphic `id` is deliberately **not** a foreign key.
- Membership lives in `episodes_events_pivot` (`episode_id`, `event_type`, `event_id`,
  `starts_episode`, `resolves_episode`). One event can belong to many episodes, start at most one,
  and resolve several.
- Invariant enforced in services: `resolvesEpisodeIds ⊆ episodeIds`.
- Note the current pivot write pattern inserts a *separate* row for a resolving link rather than
  setting the flag on the existing membership row — so `getById` derives `episodeIds` from
  non-resolving rows and `resolvesEpisodeIds` from resolving rows. Keep that in mind before "fixing" it.

## Migrations

**Migrations accumulate. Do not flatten them.** The old proof-of-concept policy (regenerate a
single `0000_*.sql`, `rm data/salud.db`, re-migrate) ended when salud.bpd.sh went live — Drizzle
keys `__drizzle_migrations` on each file's hash, so an edited `0000` is a different migration to
a database that already ran the old one. On a schema change: update `apps/api/src/db/schema.ts`,
`yarn drizzle-kit generate` a **new** file, `yarn drizzle-kit migrate`. Never edit an applied one.

The generated SQL ships in the API image through the `assets` entry in `apps/api/webpack.config.js`,
and `main.ts` applies pending migrations at boot before it listens. Both halves matter: drop the
asset copy and the container starts against an empty database with no schema and no error until
the first query. The e2e specs run `migrate()` themselves against a temp SQLite dir, so a
stale/missing migration file breaks every API e2e suite at once.

## Deployment

Deployed at **salud.bpd.sh** on the jl-k3s cluster; manifests live in the sibling `k8s-infra`
repo under `apps/salud/`. Two images (`salud-api`, `salud-web`) published to GHCR on every push
to `main` as `main-<run>-<sha>`; Flux image automation commits the bump, so **merging to `main`
is the deploy**. SQLite on a ReadWriteOnce Ceph PVC at `/data`, which is why the api runs one
replica with `strategy: Recreate`. Authelia forward-auth (`group:admins`) gates the host in front
of the app's own JWT login. In production the API fails fast on a missing/weak `JWT_SECRET` and
on an unwritable `/data` rather than degrading silently. Full detail in `app-spec/deployment.md`.

## Known issues backlog

`ISSUES.md` at the repo root tracks known defects and cleanup work, numbered and grouped, with a
status legend (🔴 open · 🟡 partially done · ✅ done) and a suggested working order. It is
explicitly **not** a spec — where an item contradicts `app-spec/`, the spec wins and the item says
so. Read it before starting anything that looks like a cleanup; several entries exist precisely to
stop someone "fixing" a deliberate decision.

## Working here

Read `app-spec/README.md` first; it sets the ground rules and they are strict:

- Treat the specs as source of truth. If code and spec diverge, **update the spec first (with the
  user's approval)** or ask — do not silently make the code the answer.
- If a spec is missing or ambiguous, pause and ask. Do not invent behavior.
- Default to the earliest/lowest phase described unless told otherwise. Phase 1 = the MVP above;
  Phase 2 (doctor directory, appointments, clinician exports, client-side E2E encryption for sharing,
  simplified grandparent view) is context to design toward, not to build.
- Propose a plan before coding; summarize afterward mapping work back to spec sections.
- Do not create commits without explicit consent.

Spec file map: `product.md` (vision, roles, MVP scope) · `data-model.md` (entities, metadata shapes,
integrity rules) · `api.md` (endpoints, bodies, error codes) · `frontend.md` (nav, auth, profile,
entry-form behavior) · `security.md` (auth, Phase-2 key model) · `persistence.md` + `tooling.md`
(Drizzle, env-selectable DB/storage, Bruno) · `repo-structure.md` (Nx layout, type-sharing rules) ·
`development.md` (migrations, seeding, curl verification) · `deployment.md` (cluster topology,
Authelia gate, release flow).
