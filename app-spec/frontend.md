# Frontend Implementation Notes

This file captures UI and client-side behavior specifics. The product spec (`product.md`) holds the broad capabilities.

## Navigation & header
- Global header shows brand plus a profile avatar icon (icon only, no text). When unauthenticated, show `Sign In`/`Sign Up` links, hiding the link for the page currently shown.
- When authenticated, hide auth links and show the avatar dropdown with `Edit profile` and `Log out`.
- Dropdown closes when: clicking Edit profile, clicking outside the menu, or navigating. Clicking the avatar toggles it.
- Edit profile navigation should dismiss the menu and land on the profile page; logout should clear session and close the menu.

## Auth flows
- Use consistent labels: `Sign In` and `Sign Up`.
- Dedicated pages for sign in, sign up, and logout (logout clears stored session and redirects to sign in).
- JWT stored client-side (localStorage) and sent via auth interceptor as `Authorization: Bearer <token>`.

## Profile experience
- `/profile` shows a left-side tab list with `My Profile` first (additional tabs can be added later).
- Tabs include `My Profile` and `Patients`; notifications tab is placeholder/disabled.
- My Profile lets the caregiver update display name and unit preferences.
- Patients tab lists the user’s patients with their relationship and whether the signed-in user is the owner. Offers an “Add patient” action; create form routes back to the patients tab after creation. Handle API responses that may return either an array or `{ patients: [...] }`.
- Patient detail page:
  - Shows/edit patient info (name, DOB, sex at birth, notes). Save updates via PATCH.
  - Displays care team list with relationship per caregiver and owner indicator.
  - Care team actions: add caregiver (search by email, choose role, add), change relationship inline via dropdown, delete caregiver (except owner), and promote a caregiver to owner from the table (updates patient `ownedById`).
  - Add caregiver uses a modal overlay; care team API responses may be array or `{ careTeam: [...] }`.
  - Delete patient button present with confirm.
  - **Code status card (§4.1, F-7.2)**: shows the current `codeStatus` (or "not set" when null),
    who set it and a computed relative age ("set 14 months ago") formatted client-side from
    `codeStatusSetAt` — a stale code status should visibly look stale. An "Update" action opens an
    inline editor that `PATCH`es `/api/patients/:id/code-status`; the card always reflects the
    latest attribution after saving.
  - **Condition list**: linked Conditions for this patient, each showing `name`, `status`, and a
    link into `condition-detail.page.ts`; an "Add condition" action routes to
    `new-condition.page.ts`.
- Dashboard includes quick actions to create an observation and log an intervention.
- Observation creation: patient select, observed time, notes/tags, multi-entry support, episodes dropdown (multi-select existing active episodes plus “create new episode” option), optional resolve toggle (resolves selected episodes), new-episode name shown only when “create new” is chosen, returns to dashboard on save.
- **Entry builder (typed forms)**: choosing an entry type renders a mini-form with exactly that
  type's fields — there is no raw-JSON metadata input. The API validates entry metadata strictly
  (`whitelist` + `forbidNonWhitelisted`, error `OBSERVATION_SCHEMA_INVALID`), so the typed forms are
  the complete surface, not a convenience layer over a more permissive one. Field shapes come from
  data-model.md → "Observation entry structured metadata"; the five plain measurement types
  (`heart_rate`, `respiratory_rate`, `oxygen_saturation`, `weight`, `height`) share one
  number-plus-note form driven by a per-type descriptor.
  - **Units follow the caregiver's preferences.** Numeric inputs are labeled in the user's
    `preferredWeightUnit` / `preferredLengthUnit`, and when that differs from the canonical unit the
    form shows a live conversion ("25 lb = 11.34 kg"). The client converts to canonical (kg, cm)
    before building metadata, so `weight.kg` / `height.cm` / `lesion_size.*Cm` / `photo.sizeCm`
    stay canonical at the persistence boundary as data-model.md requires. **Temperature is the
    exception**: it carries its own `unit` field and is stored as entered, with the unit toggle
    defaulting to `preferredTempUnit` (a thermometer may read either scale, and the reading should
    be recorded as it was seen). Consumers convert at read time.
  - `pain_score` renders as 0–10 segmented buttons rather than a number input — one tap, no
    keyboard, and impossible to enter an out-of-range value on a phone at 3 AM.
  - On save the observation is stamped with `unitPreferenceAtEntry` (the caregiver's three unit
    preferences at the moment of entry) so a later reader can tell what was on screen when the
    value was recorded.
  - The pending-entries list shows a human-readable summary per entry ("38.1 °F · oral", "120 bpm",
    "Pain 7/10", "11.34 kg"), with photo entries shown as a thumbnail.
- **Protocol card (F-4.10, §4.10)**: when the observation create response includes
  `firedAdvisories` (a `protocol_fired` advisory tripped by this save), render each as a prominent
  card immediately on the success state — the protocol's `instructionText` verbatim, its
  `sourceText` provenance, and the observed value that tripped it ("temperature 38.3°C ≥ 38.0 —
  Fever with port: ER immediately, do not give antipyretics first — per Dr. Okafor, 2026-03-01").
  No judgment framing (P1) — it's the clinician's own instruction, resurfaced, not the app's
  assessment. Shown once, at save time; not re-shown on later reads of the observation (the card is
  the moment of relevance, not a permanent annotation — the fired advisory itself remains queryable
  via the timeline/advisories list for later reference).
- Intervention creation: patient select, performedAt, type, medication/dressing fields as above, episodes dropdown (same behavior as observations), optional resolve toggle, new-episode name only when “create new” is chosen, returns to dashboard on save.
- Accessed via the avatar dropdown’s Edit profile action.

## Dose entry
- Medication search is a typeahead over `GET /api/medications?q=` (matches generic and brand
  names, F-1.2) — no raw medication-ID text field. Selecting a result loads its embodiments; the
  embodiment picker shows cabinet status inline (at home / not at home, running low, expired).
- As soon as a medication (and ideally embodiment/amount) is chosen, the form calls
  `POST .../dose-checks` debounced and renders **both** weight-based and age-band guidance side by
  side when both exist — same visual weight, neither pre-selected as "the answer" (F-2.1, P2). Each
  card shows its `source`. A guidance type that's `null` (no weight on file; patient aged out of
  every age-band guideline) simply doesn't render its card, rather than rendering an empty/error
  state.
- **Both cards show mL when the engine supplies one**, and "Use this" fills the mL field as well as
  the mg field. The asymmetry this removes was a real hazard: the age-band card offered a volume
  while the weight-based card offered only milligrams, leaving a half-asleep caregiver holding a
  syringe to divide by the concentration themselves. Where the engine reports the volume as derived
  rather than as the guideline's own (`ageBand.doseMlSource === 'derived'`), say so in muted text, so
  a derived number is never read as coming from the `source` line printed beneath it.
- **Stale-weight prompt (F-3.2)**: when the `stale_weight` advisory candidate comes back from
  `dose-checks`, show an inline prompt offering to log a fresh weight before leaning on
  weight-based guidance, rather than silently trusting a >60-day-old number.
- **Advisory banners**: any advisory candidate from `dose-checks` (including `atypical_dose` once
  an amount is entered, and `reaction_warning`) renders as an inline banner via the shared
  advisory-banner component, styled by `severity`. Banners are informational — the Save button is
  never disabled by their presence (N-3, P1); saving is itself how the warning gets acknowledged
  (see `advisories.md`).
- **Danger interstitial (F-2.5)**: a `reaction_danger` candidate instead renders
  `core/danger-interstitial.component.ts` — a full-screen, heavier confirmation ("this patient has
  a recorded danger-class reaction to acetaminophen: throat swelled up") that still lets the
  caregiver proceed (P1, no hard stops). Proceeding closes the interstitial and continues the
  normal save flow — same as every other dose-check candidate, it stays an unpersisted preview
  until the dose is actually saved, at which point it persists self-acknowledged. Backing out of
  the interstitial without saving leaves no trace, same as abandoning the form on any other
  advisory candidate (`advisories.md` → "Two lifecycles"). `POST /api/advisories/:id/ack` stays
  reserved for a future consumer that persists a `danger` advisory ahead of save (there isn't one
  yet — every M4 producer follows the same candidate-then-persist-on-save shape as M2's).

## Dashboard
- **"Last doses" strip — the first content on the page after any advisories.** Per patient: every
  medication given in the last 24 hours, with its name, how long ago in relative form ("2h 15m
  ago"), and the next-allowed countdown ("can give now" / "next dose in 1h 40m", omitted entirely
  when no guideline supplies an interval). This is the direct answer to the founding question
  (product.md → origin story), so it sits above everything else that is history or planning.
  - **A patient with nothing in the window gets an explicit confident negative — "Nothing given in
    the last 24 hours." — never a blank space or a hidden row.** At 3 AM the negative *is* the
    answer; an absent row is ambiguous between "nobody gave anything" and "the app doesn't know".
    The empty state is a feature, not a fallback.
  - Backed by `lastDoses` in `GET /api/dashboard`, which is **episode-agnostic** — a dose logged
    with no episode appears here. That is the common case and the one the strip exists for.
- Desktop-friendly: per-patient cards for each active episode showing the last observation summary
  and, per medication active in that episode, the medication name, the last dose time, computed
  `nextAllowedAt`, and whether the last dose was atypical (product.md → Dashboard). This section is
  episode *context*; the strip above is the canonical answer to "did I already give it" and stays
  correct when there is no episode at all.
- Due/overdue schedule rows (`overdue` styled distinctly) each carry a one-tap **"Log dose"**
  action that routes to `/interventions/new?scheduleId=...`, pre-filling patient, medication,
  embodiment, and amount from the schedule (F-4.2) — the caregiver still reviews and confirms
  before saving, consistent with every other dose entry.
- Shopping list: embodiments flagged `runningLow` across the household's catalog, each with a
  one-tap "Restocked" action (`POST /api/embodiments/:id/restock`).
- Unacknowledged advisories surface here too. Still renders empty in practice today — every
  producer through M4 self-acknowledges at creation (`advisories.md` → "Acknowledgment
  semantics") — but the section stays present rather than absent, so a future producer that
  persists ahead of save doesn't require a dashboard reshape.
- **Times on this page are relative, not absolute.** Every timestamp the dashboard shows — last
  dose, next allowed, last observed, schedule due — renders through
  `apps/web/src/app/core/relative-time.ts` ("2h 15m ago", "in 1h 40m", "Due 40m ago"). A half-awake
  caregiver can act on an elapsed interval; they cannot act on "8/6/26, 11:14 PM" without doing
  arithmetic first, which is exactly the work P1 says the app should do for them.
  - **The ER Brief is the deliberate exception** and keeps wall-clock times: it is a clinical print
    document handed to triage staff, who need the actual time of the last dose, not its age.

## Conditions
- `new-condition.page.ts`: patient (pre-selected from the entry point), name, diagnosis text,
  status, and editors for `baselines`/`devices`/`contacts` — each a simple add/remove list (plain
  text rows for baselines/devices; name/role/phone fields per contact row). Returns to the patient
  detail page on save.
- `condition-detail.page.ts`: editable name/diagnosis/status/baselines/devices/contacts (same
  editors as `new-condition.page.ts`, pre-filled); linked `InterventionSchedule`s (label, status,
  adherence — same summary shape as the dashboard's schedule rows) with a "New schedule" action
  that pre-fills `conditionId`; attached Protocols (name, trigger, instruction, source, active
  toggle) with inline add/edit; nested active Episodes (name, started date) as a read-only list —
  Episodes are still only created as a side effect of logging (P5), so this page doesn't add a
  "new episode" action, just shows which ones already nest under this Condition.
- **Deferred beyond M4**: rendering Condition frames on the timeline (F-5.3 mentions both Episode
  and Condition frames; only Episode frames are implemented — see "Timeline" below). A Condition
  has no direct link to observations/interventions the way an Episode does via
  `episodes_events_pivot`, only an indirect one through its nested Episodes/Schedules, so a
  Condition-frame overlay needs its own query shape rather than reusing the Episode-band code as-is.

## Reactions

Adverse reactions drive the `reaction_warning` inline banner and the `reaction_danger` full-screen
interstitial at dose entry (see "Dose entry" above) — the single most safety-critical input in the
app. They therefore need somewhere to be entered.

- **Placement**: a read-only `Reactions` card on `patient-detail.page.ts`, directly under the code
  status card and **above** Conditions. Reactions are header material on the ER Brief (F-7.3,
  "allergies belong in the header"), and the patient page should mirror that priority. Same card +
  dedicated-create-page shape Conditions already uses, so it introduces no new interaction
  vocabulary.
- **List row**: description, a severity `.pill` (`-danger` for `danger`, `-neutral` for `warning`),
  the scope in plain language ("Amoxicillin", "Amoxicillin — 250 mg/5 mL suspension", "tag:
  penicillin-class"), and the date or the literal **"Date unknown"**. Never render an epoch-zero
  date on a clinical record. Newest first, per the API's `COALESCE(occurredAt, createdAt)` ordering.
- **`new-reaction.page.ts`** at `patients/:id/reactions/new`: description (required), severity
  (default `warning`), scope-type selector, scope target picker, and an optional date labelled
  **"Date (optional — leave blank if you don't remember)"**. That label is the thing that makes the
  optional-date rule reachable from the product rather than merely true in the API.
- **Scope picker** — this is where the safety weight sits:
  - `medication` → the same typeahead over `GET /api/medications?q=` used by the dose and schedule
    forms.
  - `embodiment` → that typeahead to choose the medication, then a select over its embodiments; the
    payload carries `embodimentId` only.
  - `tag` → free text with a datalist of tags harvested from the catalog.
  - **When a typed tag matches no medication in the catalog, show an inline note.** A tag-scoped
    reaction matches only against `Medication.tags`, so a typo produces a reaction that silently
    never fires — the worst possible failure for this record. Saying so is honest; *blocking* the
    save is not, since a caregiver may legitimately be recording a class before any drug in it has
    been catalogued.
  - Switching scope type clears the other two targets, so the API's `INVALID_REACTION_SCOPE` stays a
    backstop rather than the primary UX.
- **No cross-reactivity affordance** (P6): the form never suggests related medications, never expands
  a selection to a class, and offers no "similar drugs" helper. Cross-reactivity is a clinical
  judgment the caregiver makes explicitly — the scope selector *is* that judgment.
- **Delete** per row, behind a confirm, matching the care-team and patient delete convention. A
  mis-scoped reaction otherwise fires an interstitial on every future dose with no way to stop it.
  Editing is deferred: an edit should capture a revision, and which entities are correctable is its
  own decision.

## Timeline
- Desktop-weighted (P7): a temperature curve (or other numeric-observation curve) rendered as a
  hand-drawn SVG — no charting library, consistent with the rest of the app's hand-rolled styling —
  with medication dose markers overlaid at their `performedAt` positions (F-5.2). The overlay is
  the raw series only: **no computed "responsive to X" annotation** ever renders on or near a dose
  marker — the reader draws that conclusion, not the app (P6).
- Filter chips for individual medications and for tags (F-5.1) — the motivating case is "when did
  she last get ibuprofen?" vs. "when did she last get *anything* for the fever?", two different
  questions with two different answers.
- Episode frames render as shaded horizontal bands behind the curve, spanning each episode's
  start/end, and are clickable through to that episode's detail page (below) — "what happened
  during this stretch" is answered better by the episode's own event list than by an in-chart
  filter, so this supersedes the in-chart filtering originally sketched for F-5.3.
- Observations containing `lab_result` entries render as **one aggregate line** — "Labs: 30
  results, 1 low" (counts from printed flags only, P6) — never one line per analyte; a full panel
  would otherwise drown the day it was collected on. Per-analyte values are read on the analyte's
  own history view (see "Analyte catalog"). Where a single lab entry does render, it uses the
  catalog's `displayName` from `labContext`, falling back to the lab's printed name.

## Episode detail
- `episode-detail.page.ts` at `/episodes/:episodeId` (ISSUES.md #9) — the entry point for "what
  happened during this episode", reachable from a timeline band, a patient's active-episode card on
  the dashboard, a condition's nested-episodes list, and the ER Brief's prior-episodes list.
- Shows the episode name, status, and started/ended times; its events (`GET .../timeline?episodeId=`,
  rendered with the same `describeEvent`/photo-thumbnail treatment as every other event list —
  core/event-display.ts); and, when active, its medications' last-dose summary.
- **No direct "resolve" action.** Episodes are only resolved as the side effect of an observation or
  intervention (CLAUDE.md → Episode model) — there is deliberately no `PATCH`/resolve endpoint. The
  page's "Resolve this episode" action routes to `/observations/new` with this episode pre-selected
  for `resolvesEpisodeIds`, the same review-and-confirm flow every other resolution goes through.
- Links to the ER Brief scoped to this episode (`/patients/:id/er-brief?episodeId=...`, already
  supported by the API) and back to the patient.

## ER Brief
See `er-brief.md` for the full spec. `er-brief.page.ts` (authenticated, entry point from patient
detail) renders the header/body response as a one-page-on-print document; `?mode=flash` swaps to a
large-type, header-only layout for arm's-length legibility at triage. A "Create shareable link"
action surfaces the frozen-snapshot URL and its expiry. The public `/brief/:token` route (no
`authGuard` — the one other unauthenticated web route besides `/login`/`/register`) renders a
fetched snapshot with a "frozen at / expires" banner, or a plain "link expired or doesn't exist"
message on a 404 — no distinction between missing and expired, mirroring the API.

Both pages label their scope from the response's own `body.eventScope`, never from an assumption
that an episode exists — including the frozen `since`/`generatedAt` on a shared snapshot, which is
what keeps a brief read three days later from claiming to show "the last 72 hours". See
`er-brief.md` → Web for the headings, empty states, and the phone-width table rule.

## While You Were Asleep
- `whats-new.page.ts` (per patient, entry point from the dashboard card): renders the diff — events
  since the watermark, advisories fired, and what's due right now — then an explicit "Mark as seen"
  action calls `POST .../whats-new/ack`. Loading the page does **not** ack; only the button does,
  so a caregiver who opens it, gets pulled away, and closes the tab hasn't silently consumed the
  briefing.
- Dashboard card: reads the `whatsNew` counts already on `GET /api/dashboard` — it does **not** call
  `GET .../whats-new` itself. The per-patient endpoint stays the *page's* data source, where the full
  hydrated diff is actually rendered; the card only ever needed three integers, and fanning out for
  them cost one request per patient.
  - Shown only when the diff is non-empty (an empty diff means nothing changed — the card simply
    doesn't render, no "all clear" placeholder needed). **This is a render rule the client applies**;
    the server emits a row per accessible patient including all-zero ones (api.md → `GET
    /api/dashboard`). Contrast the "Last doses" strip above, which deliberately *does* render its
    empty state: "nothing given in 24 hours" is a clinical answer, "nothing changed since you looked"
    is genuinely nothing.
  - A count of zero is never rendered as a clause — a patient with no new events but one advisory
    reads "1 advisory fired", not "0 new events · 1 advisory fired".

## Corrections
- Any entity detail view for a correctable type (observation, intervention, condition, patient)
  shows an "edited" marker whenever `GET .../revisions` returns at least one entry, with the count
  and the most recent edit's timestamp. Expanding it lists every prior `snapshot` newest-first, each
  labeled with who edited it and when — no diffing UI in v1, just the full prior state next to the
  current one, since the snapshot is already in the same shape the entity's own `GET` returns.

## Photos
- The `photo` entry mini-form uses a real file picker. Selecting a file uploads it immediately via
  `POST /api/files` with the form's already-selected `patientId`; the returned `fileId` populates
  the entry's metadata alongside body-location/side/note fields. `sizeCm` is entered in the
  caregiver's `preferredLengthUnit` and converted to cm like every other length field.
  - **Framing hint (F-8.2, v1 — client-only)**: when the form has an episode selected (existing or
    being created) and that episode already has a photo entry among its events, show the most
    recent one's thumbnail next to the picker with the hint "frame it like this one." Fetched via
    the existing timeline query filtered to the episode, no new endpoint. Full framing assistance
    (ghost overlay, side-by-side) stays deferred per requirements §9.
  - Timeline and episode views render `photo` entries as an inline thumbnail (fetched via
    `GET /api/files/:id`, same access control as every other patient-scoped read) rather than a
    text summary line.

## Documents
- The `document` entry mini-form attaches a file (PDF or image) to an observation — after-visit
  summaries, discharge notes, lab reports. Two paths, both producing a `fileId`:
  - **Upload new**: a file picker (`accept` PDF + images) that uploads immediately via
    `POST /api/files`, same eager-upload pattern as photos.
  - **Attach existing**: a picker listing the patient's already-uploaded files from
    `GET /api/patients/:patientId/files` (shows `originalName`, date, size) — the case where the
    file arrived via a lab import or an earlier observation and is being referenced again.
- Optional `label` (defaults to the file's `originalName` on upload) and `note`.
- `lab_result` is deliberately **not** offered in the manual entry form. Hand-typing lab rows is
  exactly the transcription risk the import flow exists to avoid; the API accepts the type (the
  import page and future correction flows use it), but the form does not surface it.
- Timeline and event lists render `document` entries as a labeled attachment link (opens
  `GET /api/files/:id`), not a text summary line.

## Lab import
- Entry point: an "Import lab report" action on patient detail, routing to
  `/patients/:id/lab-import`. Flow is **upload → parse → preview → confirm**; nothing is recorded
  until the caregiver confirms (api.md → "Lab imports").
- **Upload**: PDF-only file picker; the file goes up via `POST /api/files`, then
  `POST .../lab-imports { fileId }` parses it. A parse failure keeps the page on the upload step
  with the mapped error sentence and notes the PDF itself was saved — retry doesn't re-upload.
- **Preview**:
  - A header card with the report's lab name, specimen id, collected/reported times, and the
    report's printed patient name with a "check this matches ⟨patient⟩" line — the one cross-check
    that catches importing one child's labs onto the other's record. The printed name is never
    persisted.
  - Parser `warnings` (verbatim unclassified lines) shown in their own card when non-empty.
  - The analyte table, grouped under panel subheadings: checkbox (all selected by default),
    analyte (the catalog's `displayName` once known), value + unit, the **printed** flag as a
    danger pill, the reference range, and this patient's own named ranges when any are set
    ("Athletic goal at or above 120"). The UI may additionally highlight values outside a range at
    display time, but records only what the report printed (P6).
  - **Catalog status per row** (api.md → Lab imports, `resolutions`): a `new` pill on analytes
    being added to the catalog for the first time, a `new range` pill where a range is being
    recorded for an analyte that had none in effect. Neither asks — both are additive.
  - **Conflicts ask.** Where the report's printed range differs from the catalog's effective range,
    the row shows both and offers an "update the catalog to this range" checkbox, **unchecked by
    default**. Leaving it unchecked records the results and leaves the catalog alone; the app never
    silently arbitrates between the report and the catalog (P6).
  - **Deselect-only**: a mis-parsed row is unchecked, not retyped — a hand-corrected number
    silently attributed to the lab is worse than dropping the row, and the attached PDF remains
    the source of truth.
  - Editable before confirm: `observedAt` (prefilled from the collection time), the observation
    `text` (prefilled one-line summary: lab, specimen, collected/reported), and the document
    `label` (prefilled from the PDF's `originalName`).
- **Confirm** is three requests: `POST /api/analytes/resolve` for the selected names (creating any
  new analytes), then a reference-range `POST` per additive-or-accepted row (`effectiveFrom` = the
  edited `observedAt`, so the range resolves against this very observation, `source` naming the
  report), then the standard `POST .../observations` with the selected analytes as `lab_result`
  entries plus one `document` entry — then navigates to the patient's timeline. A failure at the
  last step leaves catalog rows created but no observation: harmless, and retrying is safe because
  resolve and range-create are both idempotent.

## Analyte catalog
- `/analytes` (list) and `/analytes/:id` (detail), reached from the dashboard beside the medication
  catalog. The analyte itself is global to the household, like medications — populated by importing
  reports, so a fresh install shows an empty catalog until the first lab import. Its **ranges are
  per-patient**, so the detail page works one patient at a time.
- **List**: search box (`?q=`), one row per analyte showing `displayName`, the lab's verbatim
  printed `name` muted beneath it when it differs, and the unit. A minimal add form covers the rare
  hand-added analyte.
- **Detail**, one section each:
  - **Header** — editable `displayName`, `unit` and `panel`; the verbatim `name` shown muted and
    read-only alongside, since it is what incoming reports match against.
  - **Patient picker** — everything below it is scoped to the selected patient. Switching patients
    reloads the ranges and the history together, because both belong to that person.
  - **Ranges** — this patient's named ranges, grouped by lineage (label), each lineage's rows dated
    newest-first with bounds (or verbatim text), `effectiveFrom` and `source`; a "current" pill
    marks the row in effect now within its lineage. One-sided ranges read in words — "at or above
    120", "below 20". Add and delete; a range is a standard that changes over time, so adding a
    newer dated row is normal, not a correction flow. The add form names the range, so the lab's
    `"Reference"`, an interpretation band (`"Optimal"`), and a personal target
    (`"Athletic goal"`) are entered the same way — with a checkbox marking the one lineage incoming
    reports should compare against.
  - **History** — for the selected patient, every recorded value of this analyte over time as a
    hand-drawn SVG chart (same no-charting-library treatment as the timeline): a labeled shaded
    band per range lineage, clipped to each row's effective span, plus the value series with
    per-point tooltips. Non-numeric values (`"<0.2"`) are listed below the chart rather than
    plotted. If the series mixes units, the chart says so instead of co-plotting incomparable
    numbers.
- Interpretation bands ("Deficiency below 20") are **entered by hand**, never read out of the
  report's advice text — the parser surfaces those lines as import warnings and the caregiver
  decides what to record (P6).
- Deleting an analyte that has recorded results is refused, and the message says how many results
  are in the way.

## Errors & failure messages
- **Error codes never reach the screen.** The API returns machine-readable codes as the message
  string (api.md → "Validation & errors"); the web maps every one to a plain sentence before display.
  A code like `INVALID_CREDENTIALS` or a raw `entries.0.OBSERVATION_SCHEMA_INVALID` string is a bug if
  a caregiver ever sees it.
- One catalog, `apps/web/src/app/core/error-display.ts`, mirrors api.md's error-code table
  one-to-one — same codes, one sentence each. Mapping happens per call site via
  `errorText(err, fallback)`: each site supplies its own fallback describing what it was attempting
  ("Could not save observation."), used when the response carries no code the catalog recognizes.
  Some codes need call-site-specific wording (e.g. `USER_NOT_FOUND` reads differently for "add this
  caregiver" than for "transfer ownership to this caregiver") — those sites pass a small override map.
- **Unrecognized codes and framework prose both fall back rather than display.** The API can also
  answer with plain framework text that isn't a code at all (an auth guard's bare `"Unauthorized"`, a
  malformed-id validation message, an upload-too-large message) — none of that is caregiver-actionable,
  so it is treated the same as a code the catalog doesn't yet have an entry for: show the fallback, not
  the raw text. This also means a genuinely new, not-yet-cataloged code degrades safely instead of
  leaking to the screen.
- **`PATIENT_NOT_FOUND` wording must never imply a permission problem.** The API deliberately answers
  404 rather than 403 for a patient the caller isn't on the care team for, specifically so the response
  doesn't confirm the patient exists (api.md → "Resource shape and access control"). A sentence like
  "you don't have access to this patient" would leak exactly what the 404 is hiding — the message must
  read the same whether the patient was deleted, was never the caregiver's, or the id was mistyped.
- Client-side form validation (e.g. "Body location is required." while composing an entry) is authored
  at the form and never touches this catalog — it isn't a server response, so there's no code to map.
- A 401 on an authenticated request means the session is gone; that's the auth interceptor's job
  (below), not a message a page composes.
- **Any action that can fail must show something.** A save whose failure produces no visible change —
  no error, no cleared spinner — is a defect, not an acceptable degradation.
- **That applies to reads, too.** A page whose load failure renders as an empty page is indistinguishable
  from "there's nothing here", which is the worst possible answer on a screen a caregiver consults to
  decide whether something has already been done. An unreachable API must say so.

## App shell & routing
- Basic routing for auth, profile, and dashboard; auth routes should not surface profile/logout affordances.
- Typed HTTP client for API calls; auth interceptor attaches JWT to requests and handles logout on invalid tokens.
