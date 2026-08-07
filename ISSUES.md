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

### 9. 🟡 No episode detail view in the web app
**Correction to original review:** I said `GET /api/episodes/:episodeId` is "spec'd but not routed."
**That's stale** — it exists at `apps/api/src/app/episodes/episodes.controller.ts:26` **[verified]**.
The API side is done.

**Remaining:** The web has nowhere to click into an episode. Timeline bands are hover-tooltip only
(`timeline.page.ts`, `<title>` inside the `<rect>`), so an episode is visible but not navigable.

**Fix:** An `episodes/episode-detail.page.ts` at `patients/:id/episodes/:episodeId` — the episode's
events, its medications, a resolve action, and a link to the ER Brief scoped to that episode. Make
the timeline bands clickable into it.

---

### 10. 🔴 Dashboard makes N+1 requests for the WYWA counts
**Where:** `dashboard/dashboard.page.ts` → `loadWhatsNew()` — `GET /patients`, then one
`GET /patients/:id/whats-new` per patient via `forkJoin`.

**Problem:** Fine for a one-household MVP, wasteful in principle: the dashboard endpoint already
computes overlapping data server-side, and first paint waits on the slowest of N calls.

**Fix:** Fold per-patient `{eventCount, advisoryCount, nowDueCount}` into `GET /api/dashboard`.
Requires an `api.md` update first (house rule) and touches `WhatsNewService`/`DashboardService`.

**Note:** Deliberate tradeoff at the time — not urgent. Revisit if the dashboard feels slow.

---

## Clarity / maintainability

### 11. 🔴 ~2,000 lines of duplicated inline CSS
**Problem:** Every page re-declares `.card`, `.primary`, `.secondary`, `.field`, `.muted`, `.small`,
`.pill`, `.error` — roughly 100 lines × 20+ pages. `apps/web/src/app/` is ~7,200 lines of page code,
a large fraction of it copy-pasted styling.

**Evidence it's costing something:** the production bundle is **542.95 kB against a 500 kB budget**
(build warns every run, 42.95 kB over).

**Fix:** Move the shared vocabulary to `apps/web/src/styles.css` as global classes; leave only
genuinely page-specific rules inline. Do it in one pass so the theme stays consistent — and fold #1's
missing classes in while you're there. Retire `nx-welcome.ts` at the same time (#15) for another
7 kB of the overage.

**Size:** Large but mechanical; high leverage for future theme work.

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

### 13. 🔴 `normalizeTs` redefined in 14 API services
**Correction to original review:** I said ~8. It is **14** **[verified]** — `patients`, `whats-new`,
`embodiments`, `medications`, `advisories`, `er-brief`, `reactions`, `schedules`, `episodes`,
`conditions`, `dosing`, `revisions`, `timeline`, `protocols`. Two more (`observations`,
`interventions`) inline the same `x instanceof Date ? Math.floor(x.getTime()/1000) : x` expression
without naming it.

**Fix:** One `apps/api/src/app/common/time.ts` exporting `normalizeTs`; delete the 14 local copies.
Purely mechanical, no behavior change, well covered by existing e2e tests.

---

### 15. 🔴 Two dead-weight leftovers
**a. `apps/web/src/app/nx-welcome.ts`** — 30 KB scaffold component, **not referenced anywhere**
**[verified]**. It's the source of the recurring 7.03 kB component-style budget warning on every
build. Delete it.

**b. `apps/api/src/app/api.spec.ts`** — 30 `test.todo` stubs **[verified]** mirroring the spec. Real
e2e suites (18 files, 121 passing tests) have since covered most of this ground. As-is it reads like
unfinished work and adds 30 "todo" lines to every test run.

**Fix:** Audit the 30 against actual coverage; implement any genuinely untested ones, delete the rest.
If it's still useful as a checklist, it belongs in `app-spec/`, not in the Jest run.

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
| 5 | **Cleanup** | 11, 13, 15 | Mechanical, low-risk, best done in one uninterrupted pass. #11 + #15 together get the bundle back under budget. |
| 6 | **Deferred** | 9, 10 | Real but not blocking. #9 is a new page (medium build); #10 is an optimization with no user-visible symptom yet. |

## Conventions for working these

- `app-spec/` is source of truth. Anything that changes API shape (#10) or documented frontend
  behavior needs the spec updated **first**, with approval.
- Every endpoint change needs three things: a Jest/supertest case, a Bruno request, and a real
  curl/browser check against a running server.
- Migrations stay flattened to a single `0000_*.sql` while pre-release.
- Don't commit without explicit consent.
