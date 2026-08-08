# Salud — Known Issues & Cleanup Backlog

Working backlog from a codebase review (2026-08-07). **Not a spec** — `app-spec/` remains the source
of truth for product behavior. Where an item contradicts a spec, that's called out as drift and the
spec wins (per `app-spec/README.md`: update the spec first, with approval, or ask).

Every file/line reference below was verified against the tree on 2026-08-07. Items marked
**[verified]** were re-confirmed by grep at write time; a few original review claims turned out to be
wrong and are corrected inline.

**Status legend:** 🔴 open · 🟡 partially done · ✅ done

---

## Quick wins — under an hour combined

### 1. ✅ Episode checkboxes render unstyled on both entry pages
**Where:** `apps/web/src/app/observations/new-observation.page.ts` (3 uses of `.inline-check`, 1 of
`.episode-list`), `apps/web/src/app/interventions/new-intervention.page.ts` (2 and 1).

**Problem:** Neither page defines either class in its `styles:` block. Angular component styles are
scoped, so the checkbox sits detached from its label — the "Resolve selected episodes" checkbox
floats as a bare box in the middle of the form. Visible in any browser session today.

**Correction to original review:** I claimed "grep confirms zero definitions." Not quite —
`.inline-check` *is* defined once, in `medications/medication-detail.page.ts:241`, and `.episode-list`
is defined in `dashboard.page.ts`. Because component styles are scoped, neither definition reaches the
entry pages. `.episode-list` is defined nowhere that uses it on the entry pages.

**Fixed 2026-08-07:** Added `.inline-check`, `.episode-list`, and a checkbox reset to both entry
pages. Two things the original fix sketch missed:
- `.inline-check` needs an explicit `flex-direction: row`. On `<label class="field inline-check">`
  the `.field` rule's `flex-direction: column` wins on that property regardless of rule order, so
  copying the `medication-detail.page.ts` version verbatim would not have fixed the layout.
- The pages' generic `input, select, textarea` rule was also applying text-field padding and a
  background to the checkboxes, which is what made them render as detached boxes. Added
  `.inline-check input[type='checkbox'] { padding: 0; margin: 0; width: auto; }`.

Left in the two pages rather than hoisted to global CSS; #11 will hoist them.

---

### 2. ✅ Stale label on the intervention form
**Where:** `apps/web/src/app/interventions/new-intervention.page.ts:79` **[verified]**

**Problem:** Label reads "Resolves episodes (comma separated)" but wraps a checkbox, not a text
input — leftover from a pre-refactor design where episode IDs were typed by hand.

**Fixed 2026-08-07:** Replaced with a `<label class="field inline-check">` matching the observation
page's shape; dropped the redundant sibling span. Also moved the neighbouring "Start new episode"
label's `*ngIf` from its `<input>` onto the `<label>` — with the input conditionally removed, the
label wrapped no control, which `label-has-associated-control` flags (again matching the observation
page, which already did it that way).

---

### 3. ✅ No 401 handling in the auth interceptor (spec drift)
**Where:** `apps/web/src/app/core/auth.interceptor.ts` — zero occurrences of `catchError` or `401`
**[verified]**

**Problem:** The interceptor only attaches the bearer token. When a token expires mid-session every
request fails and each page surfaces its own generic message ("Could not save observation."), leaving
the caregiver stuck with no path back to sign-in. `app-spec/frontend.md` (App shell & routing)
explicitly promises the interceptor "handles logout on invalid tokens" — **the code does not do what
the spec says.**

**Fixed 2026-08-07:** `catchError` → `auth.logout()` on 401, then rethrow so callers still see the
error. Two guards: only when a token was actually attached, and never for `/auth/login` or
`/auth/register` (a wrong password answers 401 and must not end the session or bounce the user off
the login page). New `auth.interceptor.spec.ts` covers all six cases. Verified live: poisoning
`localStorage.salud_jwt` and navigating redirects to `/login` with the stale token cleared, while a
wrong password stays put and shows an error.

**Note:** This one was a genuine spec/code divergence, so no spec change was needed — the code was wrong.

---

### 7. ✅ Accessibility errors — `lint:web` failures
**Where:** `app.html` (3), `app.spec.ts:17` (1), **plus 6 more the original review missed** in
`patients/patient-detail.page.ts:203,219` and `profile/profile.page.ts:90`.

**Problem:** `yarn lint:web` failed. Click handlers on non-interactive elements: not
keyboard-reachable, not focusable (`click-events-have-key-events`, `interactive-supports-focus`),
plus `no-empty-function` on a spec stub.

**Correction to original review:** I reported the profile menu as "the only two real failures."
There were **10 errors across 4 files** — the earlier terminal output was truncated and I read the
tail as the whole. `npx eslint . --format json` gives the reliable count.

**Fixed 2026-08-07:**
- **Profile menu restructured**, not just retagged. The dropdown (a link + a button) was nested
  *inside* the clickable div — swapping that div for a `<button>` would have nested interactive
  elements inside a button, which is invalid and worse than the original bug. Now a `.profile-wrap`
  div holds a real `<button>` toggle and the menu as its *sibling*, with `aria-haspopup`,
  `aria-expanded`, and a focus-visible ring.
- **Outside-click moved off `<main>`** to a `@HostListener('document:click')` in `app.ts`; added
  Escape-to-close. The toggle keeps `stopPropagation` so opening doesn't immediately re-close.
- **Modal backdrop** (`patient-detail`) → `<button aria-label="Close dialog">`; modal got
  `role="dialog" aria-modal="true"`.
- **Clickable `<li>` rows** (caregiver search results, profile patient list) → inner `<button>`,
  following the `row-link` pattern `dashboard.page.ts` already used.
- `app.spec.ts` stub → `jest.fn()`, plus 3 new tests (toggle is a BUTTON, menu opens and is not a
  child of the button, Escape closes).

**Result:** `yarn lint:web` passes — 0 errors, 101 warnings (all pre-existing `no-explicit-any` /
non-null assertions). Verified by keyboard in the browser: the toggle takes focus, Tab reaches
"Edit profile" then "Log out", Escape and outside-click both close.

---

### 14. ✅ `bruno/patients/get.bru` is broken two ways
**Where:** `bruno/patients/get.bru` **[verified]**

**Problem:** Two independent bugs:
1. The pre-request script contains `if (!const patientId = bru.getRequestVar('patientId')) {` —
   a `const` declaration inside a condition. **Invalid JavaScript**; the request throws on run.
2. The URL hardcodes `patients/6b389c6d-84a5-4e78-8fff-867e7caa50f4` instead of `{{patientId}}`, so
   even with the script fixed it would fetch the wrong (long-deleted) patient.

`bruno/patients/update.bru:20` similarly pins `patientId: d85d5367-ce33-4d91-a955-9345f67dec99` as a
request var.

**Why it matters:** `CLAUDE.md` requires a working Bruno request per endpoint as one of the three
things every endpoint needs. This one has never run.

**Fixed 2026-08-07:** `get.bru` URL now uses `{{patientId}}` and its script follows the working
`runRequest` fallback pattern from `get-revisions.bru`. `update.bru`'s pinned var is disabled with
`~` (matching `delete.bru`) and given the same fallback, so both requests work standalone.

Verified: a script that extracts every `script:pre-request` / `script:post-response` block in
`bruno/` and runs `node --check` on it now passes for all **61** blocks; the old `get.bru` line fails
that same check. Confirmed by curl that the dynamic id returns 200 while the previously hardcoded
UUID returns 404.

---

## Correctness / UX gaps

### 4. ✅ Raw JSON leaks into caregiver- and clinician-facing event lists
**Where:** `describeEvent()` duplicated in three pages **[verified]** —
`whats-new/whats-new.page.ts`, `er-brief/er-brief.page.ts`, `er-brief/shared-brief.page.ts`.

**Problem:** Observation entries rendered as `temperature: {"value":38.1,"unit":"C","method":"oral"}`.
The ER Brief is read by triage staff under time pressure; the shared-brief route is a public link
handed to a clinician. Neither should show a JSON blob.

**Fixed 2026-08-07** as part of the #4/#5/#12 batch — see #12 for the extraction. Verified live: the
whats-new page for an observation entered as 38.4 °C now reads `"Temp 101.1 °F (oral)"` (caregiver
prefers °F), and every event line checked in the browser was free of `{`/`"`.

---

### 5. ✅ Unit preferences are honored on input but ignored on display
**Where:** display side — `timeline/timeline.page.ts:103` hardcoded `°C`; all three `describeEvent()`
copies printed stored values with no conversion.

**Status:** Input was fixed 2026-08-07 (typed entry forms milestone). Display was fixed 2026-08-07 in
this batch — `core/event-display.ts`'s `entrySummary`/`describeEvent` convert every value to
`unitsFor(auth.user())`, and `timeline.page.ts` normalizes the temperature curve and tooltip to
`tempUnit()` per `product.md:49` ("graphs normalize to the preferred unit"). Temperature keeps the
asymmetry the spec calls for: it's *stored* as entered with its own `unit` field, and the formatter
reads `metadata.unit` as the conversion source rather than assuming °C.

**Verified live:** an observation recorded as 38.4 °C, viewed by a caregiver with `preferredTempUnit:
'F'`, shows "Temp 101.1 °F (oral)" on the whats-new page and a "101.1°F" tooltip on the timeline
chart. The public `/brief/:token` route (no signed-in viewer) correctly falls back to canonical units
instead of erroring — confirmed weight still shows "11.34 kg" there, unconverted.

---

### 6. ✅ Machine-readable error codes are thrown away
**Where:** 32 sites across the web app (not 13 as originally estimated), 27 discarding the server
body entirely and 5 leaking the raw code straight to the user.

**Problem:** The API deliberately returns codes as the message string (`PATIENT_NOT_FOUND`,
`RESOLVES_MUST_BE_SUBSET_OF_EPISODES`, `SCHEDULE_EPISODE_CONDITION_CONFLICT`,
`AT_LEAST_ONE_ENTRY_REQUIRED`, `EMAIL_TAKEN`, `OBSERVATION_SCHEMA_INVALID`, …) — an intentional design
per `CLAUDE.md`. The web either discarded it and showed "Could not save observation.", or — at 5
sites — showed the raw code verbatim. `INVALID_CREDENTIALS` was literally on the login screen.

**Fixed 2026-08-07:** New `apps/web/src/app/core/error-display.ts` — a catalog of all 28 codes to
plain sentences (mirroring `core/event-display.ts`'s conventions), plus `errorText(err, fallback,
overrides?)`. The rule is binary: a recognized code gets its sentence, **everything else — prose, an
unmapped future code — falls back to the caller's own fallback text.** That's what closes the leak
permanently: an unmapped code degrades safely instead of reaching the screen.

All 32 sites wired; the 5 leaking `err?.error?.message ??` sites had that pattern removed outright.
`PATIENT_NOT_FOUND`'s sentence is deliberately silent on *why* (no "permission", "access", or "care
team") since the API answers 404 rather than 403 specifically to avoid confirming a patient exists —
a permission-flavored sentence would leak exactly that. `USER_NOT_FOUND` gets one context-specific
override (owner transfer vs. the default care-team-add wording), since one sentence can't serve all
three of its status codes well.

**Found and fixed alongside it — 3 saves that failed completely silently** (no message, no cleared
spinner): adding a medication, saving the profile form, and logging a quick weight from the dose
form. None of these were in the original 13-message estimate; they surfaced during the sweep for
sites that never set a message at all.

**Verified live:** wrong password now shows "That email and password do not match an account..."
instead of `INVALID_CREDENTIALS`; a corrupted token still redirects cleanly via the interceptor with
no competing error text; `EMAIL_TAKEN` and the `PATIENT_NOT_FOUND` sentence (via a nonexistent patient
id) both render correctly, the latter never implying permission; the medication-create and
profile-save failures now show their messages with the API killed mid-session. The array-form
`OBSERVATION_SCHEMA_INVALID` case and the quick-weight failure couldn't be reproduced by clicking —
the typed entry forms (M6) now structurally prevent that validation error from ever reaching the
server, and the quick-weight widget only appears after a live advisory call succeeds — so those two
are proven by their unit/e2e tests only (`error-display.spec.ts`'s 39 cases, plus the two API e2e
shape assertions pinning the exact response format the mapper depends on).

**Spec updated first:** `api.md`'s error catalog was badly drifted — 9 codes documented against 28
thrown, plus two documented codes that don't exist (`REACTION_NOT_FOUND` is never thrown;
`ATYPICAL_DOSE` is an advisory type in a 200 body, not an error). Rewritten with the full 28-code
table and the previously-undocumented response shapes (string vs. array, path-prefixing, the three
prose-only surfaces). `frontend.md` gained a new "Errors & failure messages" section codifying the
rule for future call sites.

---

## Utility gaps

### 8. ✅ The founding 3 AM question isn't answered on the dashboard
**Problem:** "Did I already give Tylenol?" is the origin story in `CLAUDE.md`. Today the answer was
buried: last-dose info appeared only inside an active-episode card (`dashboard.page.ts`, `.med-row`),
in small text, as an absolute timestamp ("Last dose 8/6/26, 11:14 PM").

**Correction to original review — the fix was NOT "mostly presentational."** The claim "the data is
already in `GET /api/dashboard`" was false, twice over: (1) `DashboardMedicationSummary` carried
`medicationId` but no name — unrenderable; (2) all last-dose data flowed through
`episodes(status='active') → episodes_events_pivot → interventions`, so a dose logged with **no
episode had no pivot row and was invisible in the entire payload**, a resolved episode's doses
vanished, and a patient with no active episode showed nothing at all. The 3 AM Tylenol case — kid
feels warm, give Tylenol, no episode — was exactly the case that rendered nothing. This needed real
API work, not styling; re-sized from Medium to Medium-large.

**Fixed 2026-08-07:** New patient-scoped, episode-agnostic `lastDoses` field on `GET /api/dashboard`
— most recent dose of each medication in the last 24 hours, one row per accessible patient always
(including `doses: []`, rendered as an explicit "Nothing given in the last 24 hours." — the negative
*is* the answer at 3 AM). Bounded in SQL since `interventions` has no `medication_id` column
(lives in the metadata JSON blob); one batched medication-name lookup shared with the existing
episode-scoped rows rather than two N+1 passes.

New `core/relative-time.ts` (`timeAgo`/`timeUntil`/`relativeTime`/`nextDoseLabel`, 13 unit tests
incl. every ladder boundary as an adjacent pair) powers the strip and replaced every absolute
timestamp already on the dashboard (schedule due, last observed, episode last dose, next allowed).
The duplicate untested `formatRelativeAge` in `patient-detail.page.ts` was retired in favor of it —
one behavioral delta (a status set under a day ago now reads e.g. "5h ago" instead of the previously
ambiguous "today"), flagged and approved rather than slipped in. What's New and the ER Brief were
deliberately left on absolute times — the ER Brief is a clinical print document where triage staff
need the actual time, not its age.

**Verified live:** created a patient that will never have an episode, logged a Tylenol dose with no
`episodeIds`, and confirmed `GET /api/dashboard` returns `activeEpisodes: []` for that patient
alongside `lastDoses[…].doses[0].medicationName == "Tylenol"` — that contrast is the proof. Also
confirmed a 25h-old dose is excluded, a dose-free patient gets `doses: []`, and the browser renders
the strip correctly with the countdown omitted when no guideline supplies an interval.

---

### 9. ✅ No episode detail view in the web app
**Correction to original review:** I said `GET /api/episodes/:episodeId` is "spec'd but not routed."
**That's stale** — it exists at `apps/api/src/app/episodes/episodes.controller.ts:26` **[verified]**.
The API side was done; it needed one addition (`getById` now returns the same derived
`startedAt`/`endedAt` the list route does, plus raw `observationIds`/`interventionIds`).

**Route landed flat, not nested:** `episodes/:id`, not `patients/:id/episodes/:episodeId` — matches
the other top-level resource routes (`/conditions/:id`, `/medications/:id`) and keeps the URL stable
regardless of how the caregiver navigated in.

**No direct resolve endpoint, by design:** the new page's "Resolve this episode" action doesn't call
one — it hands off to `/observations/new?patientId=&resolveEpisodeId=`, which pre-selects and
pre-checks "resolve" on the matching episode, because episodes only close as a side effect of a
logged observation (see `CLAUDE.md` → Episode model).

**Events come from the existing episode-filtered timeline**, not new server-side aggregation —
`GET /patients/:patientId/timeline?episodeId=` already existed and already resolves medication names
and hydrated entries, so the page makes two requests (`GET /episodes/:id` + that route) instead of
duplicating `TimelineService` logic behind a circular module dependency.

Wired click-through from all 4 places an episode was previously visible but not navigable: timeline
bands, the dashboard's active-episode cards, condition-detail's nested episodes, and the (caregiver,
non-frozen) ER Brief's prior-episodes list.

---

### 10. ✅ Dashboard makes N+1 requests for the WYWA counts
**Correction to the original fix:** it said to touch `WhatsNewService`/`DashboardService`. But
`/api/dashboard` is served by `TimelineService.getDashboard`, and the module graph runs
`WhatsNewModule → TimelineModule`. Injecting `WhatsNewService` into `TimelineService` inverts that
edge into a cycle needing `forwardRef` on both sides (no precedent anywhere in `apps/api`) — and
looping `getWhatsNew` per patient server-side would only *relocate* the N+1, at higher cost, since
each call fully hydrates a timeline to produce three integers.

**The server cost was also worse than stated:** ~6-8 queries per patient. Counts don't need
hydration. `buildWhatsNewSummaries` answers every patient in **three batched queries, flat** —
an OR of per-patient windows (watermarks differ, so a shared `min(since)` collapses to the 24h
fallback the moment anyone has never acked). `nowDueCount` costs zero: `getDashboard` already
fetches every active schedule for every accessible patient. The watermark rides free on the
care-team query `accessiblePatients` already runs. Client went **N+2 → 1 request**.

**Shared definitions, not shared implementation.** The two consumers can't share code (one needs
rows, one needs a scalar), but the four boundary rules now live in one place,
`whats-new/whats-new-window.ts` — a plain module, not a Nest provider, precisely so it can't
recreate the cycle. A card that says "3 new events" over a page showing 4 is a caregiver-trust bug;
an e2e test cross-asserts the dashboard counts against `GET /patients/:id/whats-new`.

**Emit shape:** one row per accessible patient, all-zero rows included — same contract as
`lastDoses`. The "only show non-empty" rule is the *client's*, and is now a `computed()`.

**Folded in:** the card no longer reads "0 new events · 1 advisory fired" (every clause is
conditional); `load()`/`restock()` surface failures via `errorText` instead of rendering a blank
page; and the spec's default mock was hardened — it answered every URL with the dashboard payload,
which is why 8 of 10 tests never exercised the WYWA path at all.

---

## Clarity / maintainability

### 11. ✅ ~2,000 lines of duplicated inline CSS
**Correction to the original review — the bundle was the wrong justification.** The budget is
`type: initial`, which counts JS and CSS bytes identically, and `styles.css` is an entry point and
therefore always initial. Moving rules into it moves those bytes *back* into the budget; only real
deduplication helps at all, and the whole inline CSS pool (66.7 kB raw) was smaller than the overage.
The 542.95 kB figure was also stale — it was **572.56 kB, 72.56 kB over**.

**The actual cause was eager routing.** `app.routes.ts` imported all 21 pages statically, so every
page plus `@angular/forms` shipped in the initial bundle. Lazy-loading them took initial from
**572.56 kB → 303.40 kB** — from 72 kB over budget to 196 kB under, and `yarn build:web` is
warning-free for the first time. `nx-welcome.ts` was deleted too, but it saves **zero** initial bytes
(see #15a).

**The CSS work then stands on its own merits**, which is maintainability: **2,885 → 1,700 lines of
inline CSS (41% removed)** against a 272-line `styles.css`. There is now one place to change the
theme.

Shipped in ordered, individually-verifiable commits: tokens → class renames → the global vocabulary
→ per-page adoption. Tokens first (provably no rendered change), then `.card`/`.pill` renamed where
one name meant several things, then the globals added as dead rules — a component style out-specifies
a global one, so pages could adopt one at a time with no flag day.

**Two latent bugs fixed as side effects:**
- `* { box-sizing: border-box }` lived in `app.css`, which is scoped to the shell, so **no routed
  page ever got it**. Declared widths were untruthful — the new-observation card said
  `max-width: 720px` and measured 762px.
- `medication-detail`'s checkboxes rendered as bloated filled squares; its own `input, select` rule
  was hitting them. Same bug #1 fixed on the entry pages, which this page never got. The global
  checkbox reset is unscoped, so it also discharges #1's "left in the two pages… #11 will hoist them".

**Normalized drift** (the call was: collapse to the majority, keep deliberate differences):
button paddings (six variants), `.small` (three sizes), `.muted` (two greys), `.field` gap, the
`.secondary` border alpha, and profile's rogue cyan-bordered button. Deliberate exceptions kept: the
auth pages' larger type, er-brief's inverted `.link` and 2rem clinical header, er-brief's
`@media print`, profile's breakpoint.

**Traps worth knowing if you touch this again** — none are visible in a diff:
1. A local rule whose declarations *all* match the global still changes rendering if the global
   declares *more*. Four pages had `h1 { margin: 0 }` and would have silently gained a font-size.
2. Deleting `display: flex` from an `.actions` rule that never set `justify-content` hands it the
   global's `flex-end`. Bit dashboard, schedule-detail and patient-detail.
3. A grouped `.primary, .secondary, .tiny { border: none }` keeps stripping `.secondary`'s outline
   once its own border rule is removed as redundant. Narrow the group to the variants that have no
   global.

---

### 12. ✅ Event-formatting helpers copy-pasted across three pages
**Where:** `describeEvent()` and `photoFileIds()` in `whats-new.page.ts`, `er-brief.page.ts`,
`shared-brief.page.ts` **[verified]** — plus a fourth, better implementation as `entrySummary()` in
`new-observation.page.ts`.

**Problem:** Four formatters for the same data, three of them wrong (#4).

**Fixed 2026-08-07:** New `apps/web/src/app/core/event-display.ts` exports `entrySummary`,
`describeEvent`, `photoFileIds`, plus the conversion primitives (`convertTemp`, `fromKg`, `fromCm`,
`unitsFor`). All four pages import it — `new-observation.page.ts`'s local `entrySummary` and the
other three pages' local `describeEvent`/`photoFileIds` are gone. `unitsFor(user)` takes an optional
`UserProfile | null` and returns canonical units when there's no viewer, which is what makes the
public `shared-brief.page.ts` (no `AuthService`) safe to wire in without special-casing it.

15 new unit tests in `event-display.spec.ts` cover the conversions, every entry type (never emits
`{`/`"`), the F↔C round trips, and the no-viewer fallback. All 4 host-page specs pass unmodified
(their assertions didn't depend on exact wording) except `new-observation.page.spec.ts` and
`timeline.page.spec.ts`, which had 2 tests asserting the old field name/string format — updated,
plus a new test proving the timeline curve converts under an explicit `AuthService` override.

---

### 13. ✅ `normalizeTs` redefined in 14 API services
**Correction to original review:** I said ~8. It is **14** **[verified]** — and two more services
inline the same expression without naming it.

**Fixed 2026-08-07** as `apps/api/src/app/persistence/time.ts`, exporting `normalizeTs` and its
reverse twin `toDate`. There are now **zero** `instanceof Date` expressions in the API outside that
module: 14 definitions and 8 inline copies collapsed into one.

**Three things the issue understated:**
- **The inline copies were 8, not 2** — `observations` ×4, `interventions` ×3, plus the reverse
  coercion. Unnamed copies are the ones most likely to drift next, since nobody greps for an
  expression, so they were folded in rather than left behind.
- **`medications.service.ts` had already drifted** — no null guard, typed `number` instead of
  `number | null`. Swapped with no compensating `!`: `apps/api` compiles with `strict` **off** (the
  only `"strict": true` in the workspace is `libs/shared/types`), so an assertion there would be
  inert syntax that merely looks like it enforces something.
- **`observations.service.ts`'s weight watermark guarded on truthiness**, not null, so a raw epoch
  `0` mapped to `null`. Replacing it *tightens* the invariant — the guard on the next line reads
  `null` as "no weight ever recorded", so `0 → null` would have let a backdated 1969 weight overwrite
  a 1970 one, exactly what that guard exists to prevent.

**Location: `persistence/`, not the `common/` the issue proposed.** No `common/` directory exists,
and the convention here is a plain non-Nest module colocated with the concern that owns it
(`paths.ts`, `storage.config.ts`, `whats-new-window.ts`). This helper is owned by `db/schema.ts`
declaring 44 columns as `{ mode: 'timestamp' }` — naming that in the path says why it exists.

**On "no behavior change":** true for 13 of the 14, and verified rather than asserted. Both sides of
the change were captured against a freshly-migrated DB from a real running server, with volatile
fields replaced by their *type* so a leaked `Date` serialising as an ISO string would show up.
All six endpoint bodies (`medications`, `schedules`, `er-brief`, the unauthenticated shared brief,
`timeline`, `patient`) came back **byte-identical**, and the backdated-weight guard was exercised
end-to-end.

One genuine delta, unreachable and deliberately kept: `toDate(null)!` is now `null` and throws on
`.getTime()`, where the old expression produced `new Date(0)` and carried on with 1970-based
adherence math. Both columns are NOT NULL, so this is silently-wrong becoming loud.

**Also added `persistence/time.spec.ts`**, against the API's e2e-only precedent, because the e2e
suite cannot see this module's failure mode — **no spec anywhere asserts a timestamp's type**, and
the ones that exist either compare two endpoint values that would regress together or use
`toBeGreaterThan(0)`, which a leaked `Date` passes via `valueOf`.

---

### 15. 🟡 Two dead-weight leftovers (a done, b open)
**a. ✅ `apps/web/src/app/nx-welcome.ts`** — 30 KB scaffold component, unreferenced anywhere.
**Deleted 2026-08-07 with #11.**

**Correction:** the claim that it accounted for "another 7 kB of the overage" was wrong — it was
already tree-shaken out of the bundle (`grep -c 'Nx is a smart' dist/.../main-*.js` → 0), so removing
it changed initial by exactly **0 bytes**. What it did remove is the 7.03 kB `anyComponentStyle`
*warning*, which fires because Angular extracts the `<style>` block inside its template literal into
a component stylesheet whether or not the component is ever instantiated.

**b. `apps/api/src/app/api.spec.ts`** — 30 `test.todo` stubs **[verified]** mirroring the spec. Real
e2e suites (18 files, 121 passing tests) have since covered most of this ground. As-is it reads like
unfinished work and adds 30 "todo" lines to every test run.

**Fix:** Audit the 30 against actual coverage; implement any genuinely untested ones, delete the rest.
If it's still useful as a checklist, it belongs in `app-spec/`, not in the Jest run.

---

### 16. 🟡 A backdated entry can slip past a caregiver's WYWA watermark

**Found while working #10; deliberately not fixed there** — changing it would have altered what
`GET /patients/:patientId/whats-new` returns, which is a behavior decision of its own rather than
part of an N+1 fix.

**The scenario:** you're asleep. Your partner is up at 2 AM with the kid but doesn't log it until
6 AM, backdating the observation to 2 AM. You last checked the app at 5 AM. **Your 6 AM briefing
does not show that event** — WYWA filters on clinical time (`observedAt`/`performedAt`, i.e. 2 AM,
before your 5 AM watermark), not on when it was actually written.

That's a real hole in a handoff feature whose entire premise is "what happened that I haven't seen".
The 3 AM-caregiver-backdating-at-6 pattern is exactly the app's origin story, so this is likely to
bite in practice rather than in theory.

**Fix:** filter events on `createdAt` instead — in `whats-new/whats-new-window.ts`, which both the
endpoint and the dashboard counts already share, so one change moves both together. Note the
advisory predicate in that same file *already* keys on `createdAt`, which is why a backdated dose
today produces `eventCount: 0` alongside `advisoryCount: 1` (asserted in `dashboard.e2e-spec.ts`).
Needs an `api.md` update first, and the "clinical time" wording there and in the window module's
comments comes back out.

---

### 17. 🔴 Two more N+1s inside `getDashboard`

Left alone during #10 on purpose — folding them in would have tripled that diff and blurred its
test story. Both are in `apps/api/src/app/timeline/timeline.service.ts`:

**a. `buildActiveEpisodeSummary`** runs 3-5 queries **per active episode** inside a `Promise.all` —
the pivot lookup, an observations fetch, its entries, an interventions fetch, and a start-event
resolve.

**b. The shopping list** runs one `medications` query **per** running-low embodiment, inside the
loop. `medicationNames()` in the same file already does the batched `inArray` version; this is the
one place that didn't get it.

Neither is user-visible yet at household scale. (b) is a ~5-line fix using a helper that already
exists; (a) needs the same batch-then-reduce reshape `buildLastDoseRows` and `buildWhatsNewSummaries`
use.

---

### 18. 🟡 The ER Brief's medication table overflows on a phone

**Found while probing #11's box-model change; not caused by it** — the table measures the same 414px
under either box model, because that is its intrinsic minimum content width for six columns.

**Where:** `er-brief.page.ts`'s "Current medication situation" table. Below roughly 700px viewport it
extends past its container; at 375px it overflows by ~150px and the page scrolls sideways.

**Why it matters:** the ER Brief is the one screen most likely to be opened on a phone in a waiting
room, and horizontal scroll is exactly where a caregiver loses the "next allowed" column.

**Fix options:** wrap it in an `overflow-x: auto` container (cheapest, keeps the print layout
intact), or give it a stacked card layout under a breakpoint. Note `@media print` must keep the real
table — a paramedic reads the printout in columns.

---

### 19. 🟢 profile's mobile breakpoint is dead code

**Where:** `profile.page.ts` — `@media (max-width: 640px)` sets `.tabs { flex-direction: row }`, but
a later `.tabs { flex-direction: column }` at the same specificity overrides it on source order. The
tab strip never goes horizontal on mobile.

Spotted during #11 and deliberately left alone: folding a behaviour fix into a mechanical CSS
refactor is how a large diff becomes unreviewable. It is a one-line move.

---

### 20. 🔴 `observations` and `interventions` return `createdAt`/`updatedAt` as ISO strings

**Found while verifying #13, and worth more than #13 was.** Confirmed live against a running server:

```
GET /api/patients/:id/timeline
  observation  observedAt: 1785578400   createdAt: "2026-08-07T20:30:49.000Z"
  intervention performedAt: 1785582000  createdAt: "2026-08-07T20:30:49.000Z"
```

Every other endpoint returns those two fields as **epoch integers**. `observations.service.ts:55-56`
and `interventions.service.ts:67-68` are the only mappers in the API that pass them through raw, and
Drizzle hands back a `Date` for `{ mode: 'timestamp' }` columns — so they serialize as ISO strings.

`libs/shared/types/src/lib/types.ts` declares `Observation.createdAt: number`. **This is live drift
against the shared type on the two highest-traffic entities**, and it is exactly the kind of thing
the one-way type rule is supposed to prevent — but nothing enforces it, because `apps/api` compiles
with `strict` off and the `pickX` mappers have no return annotations.

**Fix:** wrap both in `normalizeTs` (now one import away). But this is a **response-shape change**,
so per CLAUDE.md and `app-spec/README.md` the spec gets checked and updated first, with approval —
and it is worth checking whether any web page is parsing these as dates today.

---

### 21. 🟡 `yarn test:api` fails roughly 1 run in 5-10, on a different suite each time

**Confirmed pre-existing** — reproduced on unchanged `HEAD` before #13, in both parallel and
`--runInBand` mode, landing on `dashboard.e2e-spec.ts` one time and `observations.e2e-spec.ts`
another.

**Mechanism:** 16 e2e suites each assign the *process-global* `process.env.DATA_DIR = tmpDir` in
their `beforeAll`, and `resolveDataDir()` (`persistence/paths.ts:6`) reads that env var when the
DI container builds the DB connection. Jest reuses worker processes across suites, so suites can
resolve each other's data directory. In `--runInBand` all 16 share one process.

Related: the merged PR "fix(api): stop er-brief e2e from flaking on the default hook timeout" was
treating a symptom of the same class.

**Fix options:** give each suite a unique `DATA_DIR` that cannot collide and pass it explicitly
rather than through `process.env`, or set `maxWorkers: 1` plus per-suite teardown, or inject the data
dir as a Nest provider override in the testing module so it never touches the environment.

---

### 22. 🟢 Two more timestamp idioms left un-extracted

Deliberately out of #13's scope, both now one import from a home in `persistence/time.ts`:
- **`nowTs()`** — `Math.floor(Date.now() / 1000)` at 7 production sites (`whats-new:34`,
  `er-brief:311`, `advisories:176`, `schedules:116`, `timeline:159,217,400`). A different concern
  from the Drizzle shim.
- **`toTs(d: Date)`** — 6 sites that already know they hold a `Date`. Adding it now would create two
  ways to do one thing, since `normalizeTs(d)` already returns the right answer.

---

### 23. 🟢 `schedules.service.ts:62` is dead syntax — **not a bug, do not "fix" it**

```ts
const base = strictlyAfter ? from.getTime() : from.getTime();
```

Both branches are identical, so the ternary is a no-op. **Behavior is correct** — the branch
`strictlyAfter` is meant to drive lives on the next line, in `offsetMs`. Filed as dead syntax to be
deleted, explicitly flagged because someone reading it as "a bug" would change `base` and break the
frequency math.

---

## Suggested order

The original review's ordering put the entry-form redesign second; **that shipped on 2026-08-07**
(typed mini-forms for all 12 entry types, pref-aware units, `unitPreferenceAtEntry` wired end-to-end),
so the list below is re-sequenced.

| # | Batch | Items | Why this order |
| --- | --- | --- | --- |
| 1 | ~~**Quick wins**~~ ✅ | ~~1, 2, 3, 7, 14~~ | **Done 2026-08-07.** `lint:web` is now green, so it can gate everything after. |
| 2 | ~~**Event display**~~ ✅ | ~~4, 12, 5~~ | **Done 2026-08-07.** One extraction (`core/event-display.ts`) fixed all three. |
| 3 | ~~**Error messages**~~ ✅ | ~~6~~ | **Done 2026-08-07.** Turned out to be 32 sites, not 13, plus 3 silent-failure bugs found in passing. |
| 4 | ~~**3 AM dashboard**~~ ✅ | ~~8~~ | **Done 2026-08-07.** Turned out to need real API work, not just presentation — see #8. |
| 5 | ~~**Episode detail**~~ ✅ | ~~9~~ | **Done 2026-08-07.** Route landed flat, not nested; resolve hands off to the entry form rather than a new endpoint — see #9. |
| 6 | ~~**Dashboard N+1**~~ ✅ | ~~10~~ | **Done 2026-08-07.** The stated fix would have created a module cycle; the real one needed no new module at all — see #10. Surfaced #16 and #17. |
| 7 | ~~**CSS + bundle**~~ ✅ | ~~11, 15a~~ | **Done 2026-08-07.** Lazy routes fixed the budget (572→303 kB), not the CSS; the CSS work is 41% fewer inline lines plus a token system — see #11. |
| 8 | ~~**normalizeTs**~~ ✅ | ~~13~~ | **Done 2026-08-07.** 14 definitions + 8 inline copies into one module; response bodies verified byte-identical. Surfaced #20–#23. |
| 9 | **Cleanup** | 15b, 23 | Mechanical, low-risk. |
| 10 | **Follow-ups from #10** | 16, 17 | #16 is a correctness call needing a spec decision; #17b is a ~5-line fix with an existing helper, #17a is a reshape. |
| 11 | **Follow-ups from #11** | 18, 19 | Both surfaced while measuring; neither blocks anything. |
| 12 | **Correctness + CI** | 20, 21 | #20 is live drift against the shared type on the two busiest entities and needs a spec decision. #21 is why the suite is untrustworthy. |

## Conventions for working these

- `app-spec/` is source of truth. Anything that changes API shape (#10) or documented frontend
  behavior needs the spec updated **first**, with approval.
- Every endpoint change needs three things: a Jest/supertest case, a Bruno request, and a real
  curl/browser check against a running server.
- Migrations stay flattened to a single `0000_*.sql` while pre-release.
- Don't commit without explicit consent.
