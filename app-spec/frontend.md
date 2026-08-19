# Frontend Implementation Notes

This file captures UI and client-side behavior specifics. The product spec (`product.md`) holds the broad capabilities.

## Information architecture (v2)

**Status: partly built.** Shipped: the `/patients` list, the hub shell and its persistent header,
the Journal / Meds / History / Share / Settings tabs, per-patient `accentColor` (server-assigned,
carried on the hub header, the list rows and every patient-naming surface on Home), the bimodal
Home with its night board, `/manage` (reached from the avatar menu) holding the catalogs and
"New schedule", Quick Log, the bottom-bar/left-rail shell, and **the journal feed** — the
attributed chronological feed, its collapsible chart header, episode dividers, and the
since-you-last-looked marker that replaced the dedicated What's-New page (the route now redirects
to the journal). Still proposed: the `now` tab. Until it exists, `/patients/:id` redirects to
`journal` for every patient, sick or quiet.

Three notes on what the journal shipped as, where the "Journal" section below leaves a choice open:

- **An advisory row carries no name.** `recordedBy` is `null` for advisories — the table has no
  author column, and the engine, not a caregiver, fires them (api.md → Timeline & dashboard). The
  feed labels those rows as the app's own rather than borrowing the name of whoever's write
  triggered the firing, which would attribute a judgment the app made to a person (P6).
- **The marker sits below the *oldest* unseen row, not above the newest.** "Unseen" is decided on
  log time, the same column the ack watermark selects on, while the feed is ordered by clinical
  time — so a 2 AM entry written up at 6 AM is new but sits among rows already read. Putting the
  line under the last unseen row is what makes "read down to the line" cover everything new; the
  unseen rows themselves carry a tint so the interleaving is legible without the reader
  reconciling two clocks.
- **One episode divider per frame per day**, each labelled with that day's number ("— Fever, day
  3 —" over Wednesday's rows, "day 2" over Tuesday's). One marker per frame would have to pick a
  single day number for a stretch spanning several, and would leave the earlier days of a long
  illness looking unframed.

Two notes on what shipped, where the section below leaves a choice open:

- **Home carries the accent colour on every surface that names a patient** — sick cards,
  night-board rows, the last-doses strip and the since-you-last-looked rows, each with the rail and
  the dot the hub header and patient list already use. The token rides along on `GET /api/dashboard`
  (api.md → Timeline & dashboard), which is what keeps Home a single request; colouring it from
  `GET /patients` would have meant the per-patient fan-out that rule exists to prevent.
- **"Active medication" on a sick card and on the night board is the union of two scopes**: the
  patient's episode-scoped `activeEpisodes[].medications` and the episode-agnostic 24-hour
  `lastDoses` (api.md → `GET /api/dashboard`), deduplicated by medication with the more recent dose
  winning. Either source alone drops doses — the first misses the 3 AM dose logged with no episode,
  the second misses a dose given earlier in the episode than a day ago.

This section defines the target structure of the app — what lives where and how a caregiver moves
between it. The behavioral specs in the sections that follow
(dose entry mechanics, entry builder, advisories, lab import, errors, …) all continue to apply
*inside* this structure; where a **placement** rule below contradicts an older bullet (written
against the v1 page layout), this section wins and the older section carries a pointer note.

### Two levels, one household

Everything in the app is either **household-level** (the home screen, the medication and analyte
catalogs, the shopping list, account preferences) or **patient-level** (journal, meds, conditions,
reactions, episodes, labs, ER brief, care team). v1 mixes the two into one flat route list —
patient-level pages are siblings reached via Back buttons, and the patient list is hidden inside a
Profile tab. v2 makes the split structural:

- Household-level things live on **Home** and under **Manage**.
- Patient-level things live inside a **patient hub** — one shell per patient that carries the
  patient's identity persistently, with tabs beneath it.
- The patient list is a **top-level destination** (`/patients`), not a profile tab. Profile keeps
  only the caregiver's own display name and unit preferences.

### App shell

- **Mobile: a bottom bar** with three slots — **Home**, a **center `+` (Quick Log)**, and
  **Patients** — all thumb-reachable. The v1 top-right link nav is a desktop pattern on the
  device the product is primarily for (P7). The header keeps brand + avatar menu (Profile,
  Manage, Log out).
- **Desktop: a left rail** — the patient list always visible (name, accent color, sick
  indicator), Home at the top, Manage at the bottom. The content area is free to go multi-column.
- The `+` is available on every authenticated screen. Inside a patient hub it is already scoped
  to that patient; elsewhere it asks which patient first — see "Quick Log" below.

### Patient identity — accent colors and the wrong-chart guard

Concurrent illness is the design case, not the edge case: **more than one patient is often sick
at the same time**, frequently on the same medications at different weight-based amounts. Two
rules follow:

- **Every patient has a stable accent color** — `patients.accentColor`, a palette token assigned
  server-side at creation and editable in the hub's Settings tab (data-model.md → Patient) — used
  everywhere the patient appears: patient chips, sick cards, journal headers, night-board rows,
  dose confirmation. Color encodes identity and nothing else.
- **Every write names its patient at the point of commitment.** The quick-log save button reads
  "Save for ⟨name⟩" (name + color), never a bare "Save". Recents, dose guidance, and next-allowed
  arithmetic are always computed per patient; a "same as last time" affordance must never surface
  another patient's last dose, precisely because two children on the same medication at different
  amounts is the normal concurrent-illness case. Logging onto the wrong child's record is the most
  dangerous data error the UI can invite — worth a permanent pixel budget on every entry surface.

### Patient hub

`/patients/:id` becomes a shell, not a page:

- **Persistent header** on every tab: name, age, accent color, danger-severity reaction pills
  (mirroring the ER Brief's allergies-in-the-header priority), active-episode pill(s), the
  stale-weight indicator, and an **ER Brief action**. The brief is a handoff artifact wanted in a
  hurry, not an access-control screen — it belongs one tap from every tab rather than inside one.
- **Tabs: Now · Journal · Meds · History · Share**, plus a settings gear.
  - **Now** — the live state: the same content as this patient's Home sick card (below) with
    quick actions inline. The landing tab while an episode is active; a quiet patient lands on
    Journal instead.
  - **Journal** — the narrative timeline; supersedes `/patients/:id/timeline` (see "Journal").
  - **Meds** — this patient's schedules (with adherence), last doses and next-allowed, and the
    **Reactions card + add-reaction flow**. Reactions warn at dose time; they belong beside meds,
    not on an edit form.
  - **History** — conditions, the episode list (active and resolved), the lab-import entry point,
    and per-analyte history links.
  - **Care team** — who is on this patient's care team and each person's relationship to them.
    Named for what it manages: it shipped as "Share", paired with the ER Brief on the theory that
    standing access and a one-off clinician handoff are the same question asked twice. That was a
    designer's abstraction, not a caregiver's — nobody adding their co-parent goes looking under
    "Share", and the first person to use it could not find care-team management at all. `share`
    redirects to `care-team`.
  - **Settings** (⚙, **labelled**, sitting with its sibling tabs rather than exiled to the far
    right) — the v1 patient-detail content: the edit form, code status card, accent colour, care
    documents card, delete. An unlabelled glyph is how patient editing became unfindable after the
    v1 page was split.
    Landing a caregiver on an edit form (v1 behavior) is the wrong default; editing is a
    deliberate act, not the resting state of a patient page.
- Route map (existing detail routes — `/episodes/:id`, `/conditions/:id`, `/schedules/:id`,
  `/brief/:token` — are unchanged):

```
/patients                    patient list (moved out of /profile)
/patients/:id                → redirects to now (episode active) or journal (quiet)
/patients/:id/now
/patients/:id/journal        supersedes /patients/:id/timeline
/patients/:id/meds
/patients/:id/history
/patients/:id/care-team      care team (was `share`, which redirects)
/patients/:id/settings       v1 patient-detail content
```

### Quick Log

The core loop is logging, and the budget is P7's number: **under 30 seconds, one-handed, in a
dark room — and a repeat dose in at most four taps.** The `+` opens a sheet, not a page:

- **Verbs, not entities.** The sheet offers **Temp · Dose · Pain · Note · Photo**, plus "Full
  observation…" for the multi-entry composer. The observation/intervention split is a persistence
  concern; the sheet never says "observation", "intervention", or "embodiment".
- **Patient scoping**: inside a hub, pre-scoped. Elsewhere, a single-patient household skips the
  question entirely; a multi-patient household shows patient chips first, **ordered sick-first**
  (active episode before quiet, then by most recent event). The chosen patient's name and color
  stay pinned at the top of the sheet through save.
- Each verb lands in the existing form (`/observations/new`, `/interventions/new`) with patient
  and entry type pre-selected — one form codepath, no parallel implementation. The forms render a
  compact single-purpose layout when arriving with a preselected type.
- **Dose: recents first, search second.** For the selected patient, the medication step leads
  with cards for medications recently given or scheduled: name, embodiment, amount last given,
  last-dose age, and the next-allowed countdown. Tapping a card prefills medication + embodiment
  + amount ("same as last time"); dose-checks still run, guidance cards, advisory banners, and
  the danger interstitial still render, and the caregiver still reviews before "Save for ⟨name⟩".
  The typeahead search remains below for anything new. This inverts v1, where every repeat dose
  pays the general-case search cost. Backed by `GET /api/patients/:id/recent-medications`
  (api.md → Timeline & dashboard), which carries the last amount/embodiment for the prefill and is
  per-patient by construction.
- **Episode attachment is a visible default, never a silent inference (P5).** When the patient
  has exactly one active episode, the form shows it pre-attached as a removable chip ("Adding to
  *Fever – Aug 2026* ✕") — zero taps in the common case, and the attachment sits on screen for
  the caregiver to reject before saving, so the judgment stays theirs. Multiple active episodes →
  a chip picker with nothing pre-selected. "Start new episode" and "this resolves…" move behind a
  "More" disclosure — resolution remains only a side effect of a logged event (P5); it just stops
  occupying prime space on every entry.

### Home

`/dashboard` keeps its route; the label becomes **Home**, and the page is **bimodal** — its shape
follows the household's state instead of rendering one fixed stack of sections:

**Sick mode** — whenever at least one patient has an active episode:

- **One sick card per sick patient**, stacked, each carrying the patient's accent color: episode
  name and day count, last dose per active medication with the **next-allowed countdown as the
  visually dominant element** (it answers the founding question; it is the hero of the card, not
  a muted suffix), a 48-hour temperature sparkline (from the dashboard payload's
  `recentTemperatures` — Home stays a single request, as in v1), atypical-dose flags, and inline
  Temp/Dose quick actions scoped to that patient.
- **Repeat a dose straight from the card.** Every medication line on a sick card carries a repeat
  button labeled with what it will prefill ("↻ 160 mg · Children's syrup"): one tap opens the
  compact dose form with medication, embodiment and amount prefilled from **this patient's** most
  recent dose of that medication — the same handoff Quick Log's recents cards make, so it is a
  prefill and nothing more: dose-checks still run, guidance cards, advisory banners and the danger
  interstitial still render, and the caregiver still reviews before "Save for ⟨name⟩". The prefill
  comes from the dashboard payload itself (`lastDoses[].doses` and `activeEpisodes[].medications`
  carry `lastEmbodimentId`/`lastEmbodimentLabel`/`lastAmountMg`/`lastAmountMl` — api.md →
  `GET /api/dashboard`), so Home stays a single request, and it is per-patient by construction
  because each card's medications already are (→ "Patient identity"). With concurrent medications
  (acetaminophen + ibuprofen on an uncontrolled fever), each line has its own button.
- **Temp is one tap to the number.** The card's Temp action opens the compact temperature form
  with the measurement method preselected from this patient's most recent temperature reading
  whose method is known — across episodes, because the method is a per-patient habit (tympanic
  for one child, rectal for the baby), not an episode property. The method select stays on the
  form and editable; a history of `unknown` methods prefills nothing and the form defaults to
  `unknown` as before. Backed by `lastMethod` on the payload's `recentTemperatures` rows.
- **The sparkline is readable as a measurement, not just a shape.** A bare curve on an
  auto-scaled axis answers neither "how high is it" nor "is that high" — the same drawing serves a
  0.2° wobble and a 3° spike. So it carries two things beyond the line:
  - **Scale labels** — the y-domain's high and low bracketing the curve, in the viewer's preferred
    unit. Arithmetic, no interpretation.
  - **The patient's temperature bands**, shaded behind the curve, from the payload's
    `temperatureRanges`. These are the household's own `AnalyteRange` rows on the seeded
    `temperature` vital, seeded once at patient creation and editable thereafter — the app renders
    what the household recorded, it does not assert a normal range at draw time (P6). The
    `reference` band reads as the ground the others sit on, matching the analyte history chart.
  - **The bands are part of the y-domain**, exactly as on the analyte chart: a band the readings
    never reach must still be visible, or the reference the reader is checking against is the one
    thing clipped off the picture. This supersedes nothing about the fixed 48-hour x-domain.
  - A patient with no bands recorded gets scale labels and no shading — never a fallback band
    drawn from the app's own idea of normal.
- **Night board — the concurrent-illness centerpiece.** When **two or more** patients are sick, a
  condensed grid renders *above* the cards: one row per sick patient (name + color), one line per
  active medication, each cell just the countdown ("can give now" / "in 1h 40m") plus any
  atypical flag. A single caregiver alternating between two bedrooms gets "who can have what,
  when" in one glance, without scrolling between cards. The board is pure arithmetic — computed
  next-allowed times, no interpretation (P6).
- Card order: the patient with the **soonest next actionable moment** (earliest next-allowed
  time or most-overdue schedule) first — the top of the screen is the next thing to do.
- Quiet-household content (shopping list, "since you last looked" rows for quiet patients)
  demotes below the sick cards; it never interleaves with them.

**Quiet mode** — no active episodes: due/overdue schedules (existing rules, including the one-tap
"Log dose"), the "since you last looked" summaries, the shopping list, and the confident-negative
last-doses strip.

Content rules carry over from the v1 Dashboard section verbatim: relative times everywhere (ER
Brief excepted), the episode-agnostic `lastDoses` semantics, explicit confident negatives, and
"an unreachable API must say so".

- **Catalog and admin actions leave Home.** "Medication catalog", "Analyte catalog", and "New
  schedule" move under **Manage** (avatar menu on mobile, rail bottom on desktop). They are
  monthly setup tasks; in v1 they compete with "log a dose" for the most urgent screen in the app.

### Journal

Supersedes the chart-only Timeline page. The product's promise is a *shared narrative*; the
narrative artifact is a feed, and the chart is its instrument panel:

- **A chronological feed**, grouped by day: observations (existing entry-summary treatment),
  doses, notes, photo thumbnails, document links, and advisory firings — **every row attributed
  by name and time (P3)**: "Dana — 240 mg ibuprofen · 2:15 AM". Attribution is the entire point
  of a multi-caregiver log, and in v1 it is invisible outside revision history. Names arrive with
  the payload — timeline entries carry `recordedBy { id, displayName }` resolved server-side
  (api.md → Timeline & dashboard) — so the feed never fans out to map user ids, and rows keep
  their author even after that caregiver leaves the care team.
- **The chart is a collapsible header** above the feed — same hand-drawn SVG, same no-annotation
  rule (P6), same medication/tag filter chips, with filters applying to chart and feed together.
  On desktop the chart and feed render side by side (P7).
- **Episode frames become feed dividers** as well as chart bands: "— Fever, day 3 —" section
  markers in the feed, clickable through to episode detail.
- **The since-you-last-looked marker.** The What's-New watermark renders as a labeled divider
  line *inside the feed* — the reader opens the journal and reads down to the line; that *is*
  the handoff. A "Mark as seen" action on the marker calls the existing `whats-new/ack`;
  scrolling never acks (same deliberate-ack rule as v1). This supersedes the separate What's-New
  page; Home's summaries deep-link to the journal positioned at the marker. The marker is per
  patient — with two patients sick, each journal keeps its own line, and Home shows one summary
  row per patient with unseen changes.
- The lab aggregate-line, photo-thumbnail, and document-link render rules carry over unchanged
  from the v1 Timeline / Photos / Documents sections.

### API additions v2 depends on

Four additions, specced in api.md / data-model.md alongside this section; everything else in v2
derives from existing payloads:

- `patients.accentColor` — palette token, server-assigned at creation, editable via patient PATCH
  (data-model.md → Patient).
- `recordedBy { id, displayName }` on timeline entries — server-resolved attribution for the
  journal feed (P3).
- `recentTemperatures` on `GET /api/dashboard` — 48h temperature points per sick patient, keeping
  Home a single request.
- `GET /api/patients/:id/recent-medications` — the quick-log recents source, carrying last
  amount/embodiment for the "same as last time" prefill.

### What v2 supersedes

| v1 | v2 |
| --- | --- |
| Header contains the only nav link (Dashboard) | App shell: bottom bar (mobile) / left rail (desktop) |
| Patient list is a tab inside `/profile` | `/patients` top-level; profile keeps caregiver prefs only |
| `/patients/:id` lands on an edit form | Patient hub; the edit form moves to its Settings tab |
| Timeline is a chart-only page | Journal: attributed feed + collapsible chart |
| Dedicated What's-New page | The journal's since-you-last-looked marker |
| Dashboard is a fixed section stack + five admin buttons | Bimodal Home + night board; admin under Manage |
| Every entry form opens with a patient dropdown and episode checkboxes | Quick Log: scoped verbs, recents-first dosing, episode chip default |

## Navigation & header
> Placement superseded by "Information architecture (v2)" → App shell; the dropdown behavior rules
> below still apply.
- Global header shows brand plus a profile avatar icon (icon only, no text). When unauthenticated, show `Sign In`/`Sign Up` links, hiding the link for the page currently shown.
- When authenticated, hide auth links and show the avatar dropdown with `Edit profile` and `Log out`.
- Dropdown closes when: clicking Edit profile, clicking outside the menu, or navigating. Clicking the avatar toggles it.
- Edit profile navigation should dismiss the menu and land on the profile page; logout should clear session and close the menu.

## Auth flows
- Use consistent labels: `Sign In` and `Sign Up`.
- Dedicated pages for sign in, sign up, and logout (logout clears stored session and redirects to sign in).
- JWT stored client-side (localStorage) and sent via auth interceptor as `Authorization: Bearer <token>`.

## Profile experience
> v2 moves the Patients tab to a top-level `/patients` list and the patient-detail content into
> the patient hub's Settings tab ("Information architecture (v2)"); the form-level behavior below
> is unchanged.
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
  - **Care documents card (§4.1)**, directly under the code status card: three fixed rows —
    living will, advance directive, medical power of attorney — each rendering its tri-state:
    "not recorded" (nothing on file, nothing stated), "none — stated by ⟨name⟩, ⟨age⟩", or the
    file's `originalName` with upload attribution and age (and, on the PoA row, the holder's
    name/phone when recorded). Ages are formatted client-side from `setAt`, same
    stale-should-look-stale rule as code status. "Upload"/"Replace" reuses the two-path document
    attach flow ("Documents" below — upload new via `POST /api/files`, or attach an existing
    file), then `PUT`s `/api/patients/:id/care-documents/:kind`. **"Record as none" is a
    deliberate act behind its own confirm — never a default, never a checkbox.** Downstream
    readers (the ER Brief at triage) will trust it as a family statement, so it must be
    impossible to record by accident; the whole value of the tri-state collapses if "none" can
    happen incidentally.
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
> Placement superseded by "Information architecture (v2)" → Home (bimodal, with the multi-patient
> night board). The content rules below — last-doses semantics, relative times, confident
> negatives — carry over into the sick cards and quiet mode unchanged.
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
> v2 moves this card from patient detail to the patient hub's **Meds** tab, with danger-severity
> pills also pinned in the hub header ("Information architecture (v2)"); every other rule below is
> unchanged.

Adverse reactions drive the `reaction_warning` inline banner and the `reaction_danger` full-screen
interstitial at dose entry (see "Dose entry" above) — the single most safety-critical input in the
app. They therefore need somewhere to be entered.

- **Placement**: a read-only `Reactions` card on `patient-detail.page.ts`, directly under the care
  documents card and **above** Conditions. Reactions are header material on the ER Brief (F-7.3,
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
> v2 folds this chart into the **Journal** as its collapsible header ("Information architecture
> (v2)" → Journal); every rendering rule below carries over.
- Desktop-weighted (P7): a temperature curve (or other numeric-observation curve) rendered as a
  hand-drawn SVG — no charting library, consistent with the rest of the app's hand-rolled styling —
  with medication dose markers overlaid at their `performedAt` positions (F-5.2). The overlay is
  the raw series only: **no computed "responsive to X" annotation** ever renders on or near a dose
  marker — the reader draws that conclusion, not the app (P6).
- Carries the same **scale labels and temperature bands** as the Home sparkline, on the same rules
  (bands come from the patient's `AnalyteRange` rows on the seeded `temperature` vital; band bounds
  join the y-domain so a band is never clipped; no bands recorded means no shading). The glance
  view and the analysis view read against the same reference, in the same visual vocabulary as the
  analyte history chart — three charts, one way of showing "what should this be".
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

The header renders the three care-document tri-state lines (living will / advance directive /
medical PoA — er-brief.md → Web), included in flash mode. Both pages' print stylesheets end with
the "Generated ⟨date⟩ — verify documents are current" footer, and the public page additionally
carries the frozen-value "may have been superseded" caveat on each document line, with files
fetched through the token file route. There is no live supersession check anywhere — the caveat is
unconditional by design (er-brief.md → Formats).

## While You Were Asleep
> **Superseded and removed.** The dedicated page is gone; the diff is read as the Journal's
> since-you-last-looked marker ("Information architecture (v2)" → Journal), and
> `/patients/:id/whats-new` redirects there for old bookmarks. The ack semantics and
> dashboard-count rules below carry over unchanged.
- The watermark and the ack: the marker renders the boundary — events since the watermark sit above
  it — and an explicit "Mark as seen" action calls `POST .../whats-new/ack`. Opening the journal
  does **not** ack, and neither does scrolling past the line; only the button does, so a caregiver
  who opens it, gets pulled away, and closes the tab hasn't silently consumed the briefing.
- `GET .../whats-new` stays the journal's source for `since`. Only that field is read now — the
  feed already has the events — but the number has to come from the endpoint that defines the
  boundary the ack resets, or the line and the button end up disagreeing about what "seen" meant.
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

## Medication catalog
- `/medications` (list) and `/medications/:id` (detail, holding the medication's embodiments and
  guidelines). Household-global, like the analyte catalog.
- **Concentration is entered as the bottle prints it.** The embodiment form's concentration field is
  a pair — *[ mg ] per [ mL ]* — not a single mg/mL box, and the derived per-mL figure is shown
  live beneath it as the caregiver types ("160 mg per 5 mL = 32 mg/mL"). The volume box defaults to
  `1`, so a label that genuinely reads "20 mg/mL" is still one number and a default. The app never
  asks a caregiver to do dosing arithmetic it can do itself, and it never *hides* the result of the
  arithmetic it did (P6): the derived figure is on screen before saving, not just afterwards.
- Where an embodiment's concentration is displayed — the detail page's embodiment list, and the
  embodiment picker on reaction entry — it reads back **as printed**, with the derived figure in
  parentheses: `160 mg / 5 mL (32 mg/mL)`. An embodiment recorded directly as mg/mL, or printed per
  single mL, shows just `32 mg/mL`; the app neither invents printed figures it was never given nor
  pads the line with a parenthetical that repeats it. (Dose entry's picker deliberately shows
  cabinet status rather than concentration — the number that matters there is the computed dose.)

## Analyte catalog
- `/analytes` (list) and `/analytes/:id` (detail), reached from the dashboard beside the medication
  catalog. The analyte itself is global to the household, like medications — populated by importing
  reports, so a fresh install shows an empty catalog until the first lab import. Its **ranges are
  per-patient**, so the detail page works one patient at a time.
- **This is also where vital signs are configured.** The five seeded vital rows (data-model.md →
  "Analyte catalog") appear here alongside lab analytes, so "what counts as a normal temperature
  for this child" is edited with the same Ranges section, in the same words, as a ferritin
  reference range — there is no separate vitals screen, because there is no separate concept. The
  list marks them as vitals and can filter to them (`?kind=`), since a household with a large lab
  catalog otherwise has to hunt for the row that drives its fever charts. A vital's header edits
  its labels only, and it offers no delete: seeded rows are permanent (409 `ANALYTE_IS_VITAL`).
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
  are in the way. Deleting a seeded vital is refused outright.
- A patient's temperature arrives with one seeded `reference` range already in place, sourced as a
  default so it reads as the app's starting point rather than a clinician's number. Editing it is
  ordinary; deleting it is permanent, and leaves the fever charts with scale labels and no bands.

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
> Target navigation structure: "Information architecture (v2)" → App shell.
- Basic routing for auth, profile, and dashboard; auth routes should not surface profile/logout affordances.
- Typed HTTP client for API calls; auth interceptor attaches JWT to requests and handles logout on invalid tokens.
