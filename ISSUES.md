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

### 16. ✅ A backdated entry can slip past a caregiver's WYWA watermark

**Fixed 2026-08-09.** Both halves had to move together, and the note below understated the scope:
`whats-new.service.ts` reaches its events through `TimelineService.getTimeline({ from })`, which
filters in the list services on clinical time — it never touched `observationsSince`/
`interventionsSince` at all. Changing only those two predicates (this entry's stated fix) would have
put the dashboard card on log time and the WYWA page on clinical time, the exact disagreement
`whats-new-window.ts` exists to prevent. The fix adds an opt-in `sinceCreatedAt` to `getTimeline`,
threaded into both list services, and moves the two predicates; `api.md` was updated first. Two
`dashboard.e2e-spec.ts` assertions inverted, and one of their comments asserted the *opposite* of the
new invariant, so it was rewritten rather than renumbered.

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

### 18. ✅ The ER Brief's medication table overflows on a phone

**Fixed 2026-08-09** with the `overflow-x: auto` wrapper option, on **both** brief pages — this entry
only named the authed one, but `shared-brief.page.ts` is the public `/brief/:token` page, the copy a
clinician actually opens at a triage desk, and it renders the same table. That page had no
`@media print` block at all, so one was added; without it the new scroll container would have clipped
the table on a printout.

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

### 19. ✅ profile's mobile breakpoint is dead code

**Fixed 2026-08-09.** Moved the `@media` block after the `.tabs` rule. As predicted, one line.

**Where:** `profile.page.ts` — `@media (max-width: 640px)` sets `.tabs { flex-direction: row }`, but
a later `.tabs { flex-direction: column }` at the same specificity overrides it on source order. The
tab strip never goes horizontal on mobile.

Spotted during #11 and deliberately left alone: folding a behaviour fix into a mechanical CSS
refactor is how a large diff becomes unreviewable. It is a one-line move.

---

### 20. ✅ `observations` and `interventions` return `createdAt`/`updatedAt` as ISO strings

**Found while verifying #13, and worth more than #13 was.** Confirmed live against a running server:

```
GET /api/patients/:id/timeline
  observation  observedAt: 1785578400   createdAt: "2026-08-07T20:30:49.000Z"
  intervention performedAt: 1785582000  createdAt: "2026-08-07T20:30:49.000Z"
```

**Fixed 2026-08-07.** `observations.service.ts:56-57` and `interventions.service.ts:68-69`
(`mapObservation`/`mapIntervention`) now wrap both fields in `normalizeTs`, same as every other
mapper. `libs/shared/types/src/lib/types.ts` already declared `Observation.createdAt: number` — this
was live drift against an existing shared-type contract, not a new rule.

**Correction to the original review's explanation:** it isn't "`strict` off + missing return
annotations." `row` is typed `any` in these mappers, so `row.createdAt` is `any`, which is assignable
to `number` under `strict` too — a return-type annotation only catches missing/excess properties, not
`any` widening. Nothing in the type system was ever going to catch this; only a runtime wire-contract
test could, which is why one now exists (below).

**Three raw sites, not the two reported, plus a fourth affected surface:**
- `observations.service.ts:56-57` and `interventions.service.ts:68-69` — the two named above.
- **`episodes.service.ts:190-191` (`listActiveForUser`, reached by `GET /api/episodes/active`) — not
  in the original issue.** The same file's `getById` and `listForPatient` already normalized
  correctly; only this third route had drifted. Fixed in its own commit so it's visible in the log.
- `POST /api/schedules/:scheduleId/log` returns the created intervention and inherited the
  `interventions.service.ts` fix for free — worth calling out since it wasn't in the issue's blast
  radius either.

Blast radius beyond the three direct sites: `Observation`/`Intervention` objects are re-emitted whole
as `TimelineEntry.display`, so `/timeline`, `/whats-new`, and `/er-brief` (plus its frozen
`er_brief_snapshots.payload`) all carried the same bug and are fixed by the same three lines.
`GET /api/dashboard` does **not** touch these fields (it builds fresh summary objects) and was used
as a must-be-empty control during verification — confirmed unchanged.

**Spec:** `app-spec/api.md` gained a `## Conventions` section stating the epoch-seconds response rule
explicitly (it previously lived only in `types.ts` and `CLAUDE.md`), plus a note on what
`GET /api/episodes/active` returns and doesn't. `CLAUDE.md`'s Timestamps bullet now points at
`persistence/time.ts` instead of quoting the pre-#13 inline idiom.

**Tests:** new `apps/api/src/app/persistence/timestamps.e2e-spec.ts` walks every response body
recursively, checking every key matching `/At$/` (with named exclusions for non-timestamp `*At` keys)
against `Number.isInteger(v) && v < 4_000_000_000` — the upper bound catches a
milliseconds-instead-of-seconds regression that a bare `Number.isInteger` check would miss. Run
against unfixed code first to confirm it failed at exactly the three sites above (16/20 checks
failing, the 4 already-correct routes passing as controls), then confirmed convergence to 20/20
across the fix commits. One-line regression markers were also added to
`observations.e2e-spec.ts`, `interventions.e2e-spec.ts`, and `episodes.e2e-spec.ts` so a future
failure names a file.

**Verified live**, not just via the test suite: a before/after HTTP capture against a real running
server (pinned fixture data, volatile fields replaced by type tags) showed the diff was exactly
`{createdAt, updatedAt}` flipping from `<str:iso>` to `<int>` at every path they appear, and nothing
else — including `/observations/:id/revisions` after a `PATCH`, proving the fix reaches *new*
revision snapshots. Old `revisions.snapshot` rows captured before the fix keep their ISO strings
(never rewritten, never expire) — confirmed this doesn't break anything: `revision-history.component.ts`
renders `snapshot | json`, which treats a string and a number identically, and it's the only revision
UI, wired to `patient`/`condition` entities whose mappers were never buggy. No deployed instance of
salud exists yet, so no backfill was done or needed. `er_brief_snapshots.payload` has the same
self-heals-in-≤168h property noted under #13's follow-ups (`er-brief.md:94-96` documents snapshots as
frozen-forever-until-expiry) — but that argument does **not** extend to revisions, which never expire;
verified live via the public `/brief/:token` page, which reads none of the affected fields and
renders identically regardless of shape. Zero web code reads `.createdAt`/`.updatedAt` off these two
entities outside two already-normalized, already-epoch-assuming call sites, so browser verification
(`/timeline`, `/whats-new`, patient detail, `/brief/:token`) was a not-a-gap: nothing looked different,
which is the expected outcome.

---

### 21. ✅ `yarn test:api` fails roughly 1 run in 5-10, on a different suite each time

**The mechanism this issue describes is wrong, and its own evidence disproves it.** Jest runs test
*files* strictly sequentially within a worker — file A's `afterAll` fully completes before file B's
`beforeAll` begins — and all 18 e2e-ish suites set `process.env.DATA_DIR` as the first statement of
their own `beforeAll`, immediately before building their DI container. There is no interleaving
window for cross-suite contamination, and separate workers have entirely separate `process.env`.
Decisively: this issue says it reproduced under `--runInBand`, where every suite shares one process
*and still runs strictly sequentially* — if sequential single-process execution reproduces it,
concurrent env mutation cannot be the cause. All the other candidate paths were checked and cleared
too: no un-awaited promises in any spec, no Nest lifecycle hooks existed at all (fixed below, but as
a real shutdown bug, not a flake cause), and `resolveDataDir()`'s `fs.mkdirSync` side effect only
ever recreates a suite's *own* tmpdir.

**a. ✅ Fixed 2026-08-08 — a real clock race, not env contamination.**
`dashboard.e2e-spec.ts`'s `'agrees exactly with GET /patients/:id/whats-new'` test used a patient
that never acks, so `care_team_memberships.last_seen_at` is `null` and both `row.since`
(`timeline.service.ts:396`, read mid dashboard-aggregation) and `wywa.body.since`
(`whats-new.service.ts:30`, read on a later, separate request) independently fall through
`whatsNewSince`'s fallback branch — each computing its own `Math.floor(Date.now()/1000)`. The
`.toBe()` equality failed whenever a whole-second boundary landed in the real time between those two
clock reads (the rest of the dashboard aggregation, response serialization, a supertest socket
teardown, a JWT guard, a membership lookup) — p ≈ Δt_ms/1000, which matches the reported rate and
explains why `dashboard.e2e-spec.ts` was one of the two suites originally observed failing.

**Confirmed live, not inferred:** 40 solo runs of the suite alone (zero cross-suite contention)
reproduced the exact off-by-one signature twice — e.g. `Expected: 1786076403, Received: 1786076402`
— proving it was structural, not load-caused. Fixed by acking first, so `since` resolves to the same
*stored* watermark on both sides instead of two clock reads; a second test covers the never-acked
fallback branch, which can legitimately disagree by up to a second and is asserted with that
tolerance. **Verified fixed:** 0/40 solo runs and 0/20 full-suite runs reproduced the signature
post-fix (60 run-throughs total, several hitting that exact test).

Also landed while investigating, all found reading the persistence boundary this required touching:
**b.** `DatabaseService` never released its DB handle on shutdown — zero `OnModuleDestroy` existed
anywhere in the API and `main.ts` never called `enableShutdownHooks()`. Fixed; verified live via a
built server, `lsof`-confirmed open sqlite fd, `SIGTERM`, clean exit within 1s. **c.**
`database.providers.ts` eagerly imported `pg` + `mysql2` + both non-sqlite drizzle dialects
(~237ms/require) on a path that's always sqlite in every suite — now lazy. **d.** `ts-jest` was
type-checking every test file's whole `AppModule` graph on every run; `isolatedModules` skips that in
the jest transform only (`build:api`/`lint:api` unaffected) — verified with ~13 full-suite runs, zero
DI-resolution regressions. `maxWorkers` capping was evaluated and **skipped**: post-(c)+(d) margin is
already comfortable (worst suite 7.87s against the 20s `testTimeout`, 39%; p95 4.98s), so there was no
timeout-margin problem left to spend a commit narrowing.

**e. ✅ Fixed 2026-08-08 — a second, separate flake mechanism, discovered during this investigation's
verification and likely the *larger* contributor to the originally reported rate.** Not caused by (a)
or any of (b)-(d) — the exact same signature appeared in the very first diagnostic run, against
unmodified pre-session code. Refiled with its own evidence, research, fix, and verification as
**#25**, since it was a distinct bug with a distinct root cause, not a loose end of this one. Both
constituent problems this issue turned out to bundle are now closed.

**Historical note kept for anyone reading old CI logs:** the merged PR "fix(api): stop er-brief e2e
from flaking on the default hook timeout" (raising `testTimeout` to 20s) was very likely also masking
#25, not (only) the genuine margin problem its message describes — #25's failures had nothing to do
with timing out, so raising the timeout wouldn't have fixed them, but it would have reduced how often
CI happened to sample a slow moment where #25's odds were highest.

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

### 24. ✅ The `Episode` shared type is optional everywhere, and `GET /api/episodes/active` is
effectively untyped

**Fixed 2026-08-09.** `createdAt`/`updatedAt` are non-optional now, and `ActiveEpisodeSummary
extends Episode` names the `/active` shape. The part worth recording: making the *type* stricter was
by itself cosmetic. No service annotated its return, so every mapper was returning an object literal
out of an `any`-typed `.map()`, assignable to anything. The fix had to annotate all three methods
**and** bind each literal to a typed local inside the map — that is what actually gets excess- and
missing-property-checked, and what will catch the next regression of #20's shape.

**Surfaced while closing #20.** `types.ts:203-211` declares `createdAt`, `updatedAt`, `startedAt`, and
`endedAt` all optional on `Episode`, so a response missing any of them still compiles — the loophole
that let `listActiveForUser`'s ISO-string leak (#20) pass unnoticed for as long as it did. Fixing #20
did not fix this: the mappers now happen to return the right runtime values, but nothing in the type
would stop the next regression from reintroducing an `undefined` or a `Date`.

It's also worse than "optional" on that one route specifically:
- `listActiveForUser` (`episodes.service.ts`, backing `GET /api/episodes/active`) returns a
  denormalized `patientName` field that appears on **no shared type at all** — dashboard consumers
  read it off an untyped/`any` shape.
- The same route omits `startedAt`/`endedAt`, which both other episode routes (`getById`,
  `listForPatient`) resolve and return. One of three episode endpoints disagrees with the other two
  on what an "episode" response looks like.

**Fix shape (not done — deliberately left to a future pass, per the #20 plan's decision to fix the
three mapper sites and leave typing alone):** either tighten `Episode.createdAt`/`updatedAt` to
non-optional (they're NOT NULL columns; every mapper has always produced them) and give
`listActiveForUser`'s shape its own named type — e.g. `ActiveEpisodeSummary extends Episode` adding
`patientName`, and either resolving `startedAt`/`endedAt` there too or documenting why that route
alone omits them.

---

### 25. ✅ A second `yarn test:api` flake mechanism — spurious wrong-status HTTP responses, unrelated
to #21's clock race

**Surfaced while verifying #21's fix.** Requests that are byte-identical to ones succeeding
elsewhere in the *same test file*, seconds apart, occasionally came back with a coherent but wrong
status: a 401 on a route whose token worked one line earlier, a 404 on a route another test in the
same file hits successfully, a 400 with no validation reason. Not the `since` off-by-one #21 fixed —
none of these touch a timestamp — and not a hook timeout either.

**Root cause, now well-supported (not just a hypothesis).** Reading supertest 6.3.4's actual source
(`serverAddress()`: `if (!addr) this._server = app.listen(0)`, then `.end()` closes that server once
the response resolves) confirms every e2e suite's `app.init()`-only pattern makes supertest do its own
listen/close cycle on **every single request** — hundreds of bind/close operations per run, not 18.
Superagent's default `agent: false` (`Connection: close`, confirmed at the wire level) rules out stale
keep-alive socket reuse, and in-process same-file races are structurally impossible (every request is
sequentially `await`ed). That leaves cross-process, OS-level ephemeral-port churn as the remaining
candidate — and it has independent public corroboration: **nestjs/nest#15239** (open, untriaged)
documents the identical symptom, down to literal cross-protocol bytes bleeding into an HTTP response
buffer, from hammering an unlisten'd Nest app via supertest; **supertest#667** separately flags that
supertest's implicit `.listen(0)` sets `SO_REUSEADDR`, which "can conflict with any other process ...
using `SO_REUSEADDR` on a port in the ephemeral range" — exactly what this repo's ~11 parallel Jest
workers doing this per-request churn would produce. Neither GitHub issue is maintainer-confirmed, so
this isn't a proven mechanism, but it's the only one that matches the exact symptom shape, this repo's
actual code path, and has corroboration beyond this investigation.

**Fixed 2026-08-08, and the fix doesn't depend on the mechanism being 100% certain.** Added
`await app.listen(0);` immediately after `await app.init();` in all 18 e2e-spec `beforeAll` blocks.
`serverAddress()`'s own logic means an already-bound server (`app.address()` truthy) makes supertest
skip its implicit listen/close entirely for the rest of the file — bind/close operations drop from
~1-per-HTTP-request to exactly 1-per-suite (18 total across a whole run), removing the churn any
candidate mechanism needs to fire, regardless of which one is exactly right.

**Verified at the same statistical bar #21 used.** Pre-fix baseline (this issue, same session): 2/40
solo `dashboard.e2e-spec.ts` runs, 4/20 full-suite root occurrences. Post-fix: **0/40 solo runs and
0/20 full-suite runs** reproduced the wrong-status signature — 60/60 clean. `yarn test:api`,
`yarn lint:api`, `yarn build:api` all green; no response-body changes anywhere (the fix only touches
when a socket is bound, not any handler).

---

### 26. 🟡 The e2e suites never install `main.ts`'s `ValidationPipe`

**Surfaced while investigating #21.** `main.ts` applies `new ValidationPipe({ whitelist: true,
transform: true })` globally; no e2e suite's `Test.createTestingModule(...)` setup does the same. Yet
26 assertions across 9 suites `expect(400)` on malformed bodies — meaning those 400s are coming from
service-level checks, and **the validation layer itself has zero test coverage**, and diverges
silently from what's actually deployed. Also: `app.spec.ts` never calls `setGlobalPrefix('api')`
either, so it asserts `GET /` where the deployed app serves `GET /api`. Fixing both changes response
bodies for the 26 assertions (whitelist/transform can alter what counts as invalid), so it's its own
change, not a drive-by.

---

### 27. 🟢 Two small persistence findings from the #21 investigation, neither urgent

- ~~**`resolveDataDir()`'s silent fallback.**~~ **Fixed 2026-08-08**, when the app became
  deployable — the fallback turned from a loaded gun into a live one, since a PVC mounted with the
  wrong owner would have meant every patient record and attachment silently landing on the pod's
  ephemeral filesystem and vanishing on the next restart. `resolveDataDir()` now throws when
  `NODE_ENV=production`, and additionally `fs.accessSync(W_OK)`s the directory, because
  `mkdirSync({recursive:true})` succeeds on an existing directory regardless of its mode — the
  read-only-mount case the original note was really about. The cwd fallback still applies outside
  production so local dev and the e2e suites are unaffected.
- **`resolveDataDir()` performs a `fs.mkdirSync` side effect inside a function named `resolve*`**, and
  runs 3+ times per DI container (twice via `resolveDatabaseConfig`, once via `resolveStorageConfig`).
  Separating "compute the path" from "ensure it exists" would be a small clarity win, not a bug.

---

### 28. ✅ A client can overwrite server-resolved dose fields through `metadata` passthrough

**Found during the 2026-08-09 QA-findings batch; deliberately left out of it** — it is a distinct
defect from the required-field and bounds work that batch covered, and it deserves its own change.

**Where:** `create-intervention.dto.ts` declares `metadata?: Record<string, any>` with no validation
at all, and `interventions.service.ts` merges it **last** into the persisted blob
(`...dto.metadata`). So a request can set `isAtypical: false`, `atypicalReason: null`,
`guidelineId`, `nextAllowedAt` or `weightKgUsed` directly, overwriting the values the dosing engine
just computed. `api.md` is explicit that those are server-resolved and never client-trusted; the
merge order quietly says otherwise.

**Why it matters:** the atypical flag is the permanent trace that a dose didn't follow guidance
(F-2.4). A client that can clear it can erase that trace, and nothing in the record would show it.

**Fixed 2026-08-19.** Took the second option: `reserved-metadata.ts` names the keys the service
owns and `create`/`update` both reject a client that sends one, with 400 `RESERVED_METADATA_KEY`
carrying the offending `keys`. The list is every key the service itself writes — the engine's
resolved fields (`isAtypical`, `atypicalReason`, `nextAllowedAt`, `guidelineId`, `weightKgUsed`,
`ageMonthsUsed`) plus the validated top-level ones (`medicationId`, `amountMg`, `side`, …), since
the latter reaching the row through `metadata` bypassed their DTO range checks — a second hole the
original note didn't mention. Free-form client keys still pass through untouched, so nothing a
client legitimately does got narrower.

Rejecting rather than silently stripping matches how an observation entry's `metadata` answers an
unknown key (`forbidNonWhitelisted`): a client sending `isAtypical` is confused about who owns it,
and dropping it quietly would leave it believing the value stuck. `bruno/interventions/update.bru`
used to demonstrate the hole (it sent `isAtypical: true`) and now sends a harmless custom key.

---

### 29. 🟢 The medication typeahead now exists in three copies

`new-intervention.page.ts`, `new-schedule.page.ts`, and (as of 2026-08-09) `new-reaction.page.ts`
each carry their own copy of the search-over-`GET /api/medications?q=` input, its result list, and
the `.med-results`/`.med-result`/`.chosen-med` styles. Two copies was tolerable; three is the point
at which `core/medication-typeahead.component.ts` pays for itself.

Deliberately not done while adding the third — extracting a shared component in the same change as
a new page would have made both harder to review.

---

### 30. 🟢 Reactions can be deleted but not edited

`DELETE /api/patients/:patientId/reactions/:reactionId` landed 2026-08-09; `PATCH` did not.

An edit should capture a `Revision` (api.md → Corrections), which means adding `'reaction'` to
`RevisionEntityType` in `types.ts` and to `revisions.entityType`'s enum in `schema.ts`. That needs
**no migration** — the column is plain `text` with no CHECK constraint — but it is a spec
conversation about which entities are correctable, not a drive-by.

Delete plus re-create covers the case today, at the cost of the original's timestamp.

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
| 10 | **Follow-ups from #10** | ~~16~~, 17 | **#16 done 2026-08-09** with the QA-findings batch. #17b is a ~5-line fix with an existing helper, #17a is a reshape. |
| 11 | ~~**Follow-ups from #11**~~ ✅ | ~~18, 19~~ | **Done 2026-08-09.** #18 needed the fix on both brief pages, not just the authed one. |
| 12 | ~~**Correctness + CI**~~ ✅ | ~~20, 21, 25~~ | **All done 2026-08-08.** 20 was live drift against the shared type on the two busiest entities; found a third site (`episodes.service.ts`) and filed the typing loophole as #24. 21 turned out to bundle two unrelated bugs, not one: a two-clock race in one dashboard assertion, and a separate supertest ephemeral-port-churn issue causing spurious wrong-status responses (~20% of full runs) — refiled and fixed as #25 once isolated. `yarn test:api` is now trustworthy: 0/60 reproductions across both mechanisms' post-fix verification runs. |
| 13 | ~~**Follow-up from #20**~~ ✅ | ~~24~~ | **Done 2026-08-09.** The type change alone was cosmetic — the return annotations were the actual fix. |
| 14 | **Follow-ups from the #21/#25 investigation** | 26, 27 | #26 is a real coverage gap (the validation pipe is never tested); #27 is two small clarity items, no urgency. |
| 15 | **Follow-ups from the QA-findings batch** | 28, 29, 30 | #28 is the only 🔴 of the three and is a real integrity hole — a client can erase an atypical-dose flag. #29 and #30 are both "the third time is when you extract it" items. |

## Conventions for working these

- `app-spec/` is source of truth. Anything that changes API shape (#10) or documented frontend
  behavior needs the spec updated **first**, with approval.
- Every endpoint change needs three things: a Jest/supertest case, a Bruno request, and a real
  curl/browser check against a running server.
- Migrations accumulate — never edit or regenerate an applied one (see `app-spec/development.md`).
- Don't commit without explicit consent.
