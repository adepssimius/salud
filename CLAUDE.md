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

The spec describes the whole Phase-1 product; roughly half is built. Current reality:

**Built**
- Auth: `POST /api/auth/register|login`, `GET /api/auth/me`; `GET|PATCH /api/users/me`, `GET /api/users/search`
- Patients + care team (`POST`, `GET`, `GET/:id`, `PATCH/:id`, `DELETE/:id`, `GET|POST /:id/care-team`,
  `DELETE /:id/care-team/:caregiverId`) — **currently served under the legacy nested prefix
  `/api/users/:userId/patients`; the spec has moved to flat `/api/patients`. See "Route migration" below.**
- Observations: `POST|GET /api/patients/:patientId/observations`, `GET .../observations/:id`,
  `GET|PATCH /api/observations/:id`. Multi-entry, weight entries denormalize onto `patients.latest_weight_kg`.
- Interventions: same route shape as observations.
- Episodes: `GET /api/patients/:patientId/episodes`, `GET /api/episodes/active`. Episodes are created
  and resolved **only** as a side effect of an observation/intervention — there is no `POST /episodes`.
- Web: sign in/up/out, profile (My Profile + Patients tabs), patient detail w/ care team management,
  new-observation and new-intervention pages, placeholder dashboard.

**Specced but not built** — this is where spec work most likely lands:
- Medications, embodiments, guidelines (tables exist in `schema.ts`; no module, no controller, no seed data)
- Intervention schedules (table exists; no module) and `POST /api/schedules/:id/log`
- Files: `POST /api/files`. `StorageService` exists and is provided by `PersistenceModule`, but nothing calls it.
- `GET /api/patients/:patientId/timeline` and `GET /api/dashboard`
- Weight-based / age-band dose recommendation and real atypical-dose detection.
  `interventions.service.ts:143` has a stub that flags atypical only when `doseSource === 'override'`;
  `nextAllowedAt` is always null.
- `GET /api/episodes/:episodeId` (spec'd, not routed)
- `apps/api/src/app/api.spec.ts` is a 29-entry `test.todo` plan mirroring the spec — a good checklist
  of what "done" means per area.

## Route migration (decided, not yet applied)

`api.md` used to document patient CRUD at both `/api/patients/...` and `/api/users/:userId/patients/...`.
That contradiction is **resolved in favor of flat**: patients are top-level resources, one canonical URL
per patient, acting user always from the JWT. The reasoning is written up in `api.md` under
"Resource shape and access control" — access comes from the `care_team_memberships` many-to-many, so
nesting implied a containment the data model doesn't have and gave each patient a different URL per
caregiver. The nested `:userId` was pure redundancy: `assertUser` pinned it to the JWT subject, so it
scoped nothing and added no protection against id probing (v4 UUIDs + the care-team check do that).

The spec is updated; **the code is not migrated yet.** Still to do:

- `patients.controller.ts` — `@Controller('users/:userId/patients')` → `@Controller('patients')`, drop the
  `userId` param and `assertUser`/`USER_FORBIDDEN`, take the actor from `req.user.userId`.
- Web: ~10 call sites in `patient-detail.page.ts`, `new-patient.page.ts`, `profile.page.ts`,
  `new-observation.page.ts`, `new-intervention.page.ts` currently interpolate `currentUserId()`.
- Bruno: 7 files under `bruno/patients/` still use `users/{{userId}}/patients`.
- `patients.e2e-spec.ts` paths.

Note `/users/me` and `/users/search` stay — those are genuinely identity-scoped.

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
  `RESOLVES_MUST_BE_SUBSET_OF_EPISODES`, `EMAIL_TAKEN`, `INVALID_CREDENTIALS`.
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

## Migrations (proof-of-concept policy)

Migrations are deliberately **flattened to one file** while pre-release. On a schema change:
update `apps/api/src/db/schema.ts`, regenerate so a single `0000_*.sql` remains, `rm data/salud.db`,
re-run migrate. Do not accumulate incremental migrations yet. The e2e specs run `migrate()` against a
temp SQLite dir, so a stale/missing migration file breaks every API e2e suite at once.

## Uncommitted work in progress (as of this writing)

The tree has an in-flight refactor, already reflected in the spec files:

1. Observations dropped the `symptomTags: string[]` column-style field; symptom/tag data now lives in
   entries via new entry types `tag` and the reshaped `symptom`/`note` metadata.
2. Temperature metadata went `{ valueC, inputUnit }` → `{ value, unit, method }`.
3. Episode linkage moved from array fields to `episodes_events_pivot`.
4. Migration renamed `0000_overconfident_swarm.sql` → `0000_clumsy_blur.sql` (untracked).
5. `medications.brandNames` is specced in `data-model.md` / `api.md` but **not yet in `schema.ts`**.
6. Both web entry pages carry `TODO` markers: their payloads still use the pre-refactor shape
   (`symptomTags`, `interventionScheduleId`) and need adapting.
7. `interventions.service.ts:155` has a stale `// TODO: write pivot rows` — the pivot writes are in
   fact implemented directly above it.

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
`development.md` (migrations, seeding, curl verification).
