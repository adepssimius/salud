# Data Model Spec

## Entities

### User (Caregiver)
- `id: uuid`
- `email: string` (unique)
- `passwordHash: string`
- `displayName: string`
- `preferredTempUnit: enum('C','F')`
- `preferredLengthUnit: enum('cm','in')` (used for UI conversion only)
- `preferredWeightUnit: enum('kg','lb','st')` (used for UI conversion only; data stored in kg; `st` = stone)
- `createdAt`, `updatedAt`

### Patient
- `id: uuid`
- `fullName: string`
- `dateOfBirth: date`
- `sexAtBirth: enum('female','male')`
- `notes: text`
- `latestWeightKg: decimal(5,2)` (denormalized helper)
- `latestWeightRecordedAt: datetime`
  - Updated whenever a `weight` observation entry is created **or edited**, on this patient, anywhere on
    the timeline — not just the most recently logged one. Guarded by recency: the entry's `observedAt` is
    compared against the patient's current `latestWeightRecordedAt`, and the denormalized fields are only
    overwritten when the entry's `observedAt` is the same or newer. Backdating an old weight (e.g.
    correcting a past entry) must never regress `latestWeightKg` to a stale value.
- `ownedByUserId: uuid` (owner auto-added as caregiver)
- `codeStatus: string | null` — free text, as the caregiver's care team has stated it (no fixed
  clinical enum — forms vary by hospital/locale; the app doesn't standardize it, matching the
  free-text treatment of `Condition.diagnosisText`).
- `codeStatusSetByUserId: uuid | null`, `codeStatusSetAt: datetime | null` — stamped server-side
  from the actor on `PATCH /api/patients/:id/code-status`, never client-supplied (P3). Displayed
  with its computed age wherever code status is shown ("set 14 months ago") — goals of care change
  over a long illness, and a stale code status should visibly look stale.
- `createdAt`, `updatedAt`

### CareTeamMembership
- `id: uuid`
- `patientId: uuid`
- `userId: uuid`
- `role: enum('self','parent','co-parent','nanny','grandparent','babysitter','other')`
- `permissions: enum('full')` (placeholder for future granular roles)
- `lastSeenAt: datetime | null` — the "while you were asleep" watermark (§5.6, F-6.1) for this
  caregiver × patient pair. Lives on the membership row because that's already the unique join and
  already dies with the membership (no separate cleanup needed if a caregiver is removed). Advances
  **only** via `POST /api/patients/:patientId/whats-new/ack` — never on a plain read of
  `GET .../whats-new` — so glancing at the briefing doesn't erase it before it's actually been
  acted on. `null` means "never acknowledged"; the diff falls back to the last 24 hours.
- Constraints:
  - Patient creator auto-inserted with role `self` if they are the patient or `parent` otherwise.
  - Every patient must have at least one membership where `userId` equals a user flagged as the patient (self-care).
  - Only one `self` role is allowed per patient; attempts to add a second `self` membership should be rejected.
  - Care team owner (`ownedByUserId`) membership cannot be deleted; owner changes must be explicit via patient update.

### Condition
A **standing frame** for chronic illness (§4.4 of the requirements doc). Where an Episode is
acute — it starts and resolves — a Condition is open-ended and carries the durable context an ER
team or covering caregiver needs. Episodes and InterventionSchedules may optionally nest under a
Condition (`Episode.conditionId`, `InterventionSchedule.conditionId`), inheriting its chronic
context ("neutropenic fever #3" under "ALL treatment").

- `id: uuid`
- `patientId: uuid`
- `name: string` (e.g., "ALL treatment", "Type 1 diabetes")
- `diagnosisText: text | null` — free text, as the caregiver states it; the app does not diagnose
  (P6).
- `status: enum('active','resolved')`
- `baselines: string[]` (JSON array) — what "normal" looks like for this patient (e.g. "resting HR
  runs 110", "always has a rattly cough"). Chronically ill patients have a normal that would alarm
  a stranger; observations should be interpretable against it. Display-only list, edited whole via
  `PATCH` — no child table, since there's no query benefit to normalizing it (JSON-in-text is the
  established convention, matching `medications.tags`/`brandNames`).
- `devices: string[]` (JSON array) — port, G-tube, pump, etc. Same edit-whole-via-PATCH shape as
  `baselines`.
- `contacts: { name: string, role: string, phone: string }[]` (JSON array) — the condition's own
  care team: names, roles, phone numbers ("page the on-call oncologist at …"). Same shape as
  `baselines`/`devices`.
- `createdByUserId: uuid`
- `createdAt`, `updatedAt`

### AdverseReaction
First-class and remembered forever (§4.9). A reaction record captures what happened, when, and an
**explicit, caregiver-chosen scope** — cross-reactivity is a clinical judgment a layman can't make,
so the app never infers it (P6).

- `id: uuid`
- `patientId: uuid`
- `description: text` — free text, as the caregiver experienced it.
- `occurredAt: datetime`
- `recordedByUserId: uuid`
- `severity: enum('warning','danger')` — the caregiver describes severity, not diagnosis.
  `warning` ("throat got tingly after this one") renders as an inline note at medication selection;
  `danger` (anaphylaxis-grade) renders as a full-screen interstitial that still lets the caregiver
  proceed (P1) — the confirmation gets heavier, the door stays open.
- `scopeType: enum('embodiment','medication','tag')` — exactly one of the fields below must be set,
  matching `scopeType`:
  - `medicationId: uuid | null` — this medication generically (the default scope).
  - `embodimentId: uuid | null` — this specific formulation only.
  - `tag: string | null` — a whole medication class (e.g. "no penicillins, period" when a clinician
    has said so), matched against `Medication.tags`.
- `createdAt`, `updatedAt`

### Protocol
Caregiver-entered standing instructions from the care team, attached to a Condition (§4.10):
"fever ≥ 38.0 with port → ER immediately, do not give antipyretics first."

- `id: uuid`
- `conditionId: uuid`
- `name: string` (e.g., "Fever with port")
- `triggerMetric: enum('temperature','heart_rate','respiratory_rate','oxygen_saturation','pain_score')`
  — the observation entry type this protocol watches; the same numeric-measurement types a Protocol
  can threshold on.
- `triggerOperator: enum('gte','lte')`
- `triggerValue: decimal` — in the metric's canonical unit (°C for `temperature`, matching
  data-model.md's canonical-units rule; bpm, breaths/min, %, 0–10 for the others respectively).
- `instructionText: text` — the clinician's own instruction, resurfaced verbatim.
- `sourceText: text` — which clinician, when given (provenance, same spirit as
  `MedicationGuideline.source`, N-4).
- `active: boolean`
- `createdAt`, `updatedAt`
- Evaluated by `AdvisoriesService.evaluateProtocols()` on every observation create, against the
  active protocols of the patient's active Conditions (see "Data integrity rules" below and
  `advisories.md`).

### Episode
- `id: uuid`
- `patientId: uuid`
- `conditionId: uuid | null` — optional nesting under a standing Condition (§4.4).
- `name: string` (e.g., "Fever Jan 2025")
- `startedAtType: enum('observation','intervention')`
- `startedAtId: uuid` (the observation/intervention that marks start)
- `endedAtType: enum('observation','intervention') | null`
- `endedAtId: uuid | null` (the observation/intervention that marks resolution)
- `status: enum('active','resolved')`
- `notes: text`
- Derived fields computed at query time: `startedAt`, `endedAt` (epoch seconds) — looked up from the
  linked `startedAtId`/`endedAtId` event's own timestamp. `endedAt` is `null` while `status = 'active'`.
  Included on `GET /api/patients/:patientId/episodes` (used by the timeline's episode-frame overlay,
  api.md → "Timeline & dashboard").

### EpisodeEventPivot
- `id: uuid`
- `episodeId: uuid`
- `eventType: enum('observation','intervention')`
- `eventId: uuid`
- `startsEpisode: boolean`
- `resolvesEpisode: boolean`
- `createdAt`, `updatedAt`
- Used to associate observations/interventions to episodes (including which event started or resolved an episode). A single event can start at most one episode but may be associated with multiple.

### Observation (base)
- `id: uuid`
- `patientId: uuid`
- `recordedByUserId: uuid`
- `observedAt: datetime`
- `text: text` (free-form notes)
- `unitPreferenceAtEntry: jsonb | null` — `{ temp: 'C'|'F', weight: 'kg'|'lb'|'st', length: 'cm'|'in' }`.
  The display units the recording caregiver had on screen, stamped by the client at create time
  (the server can't infer it; see api.md → Observations). Metadata values are already canonical, so
  this is provenance for display and later interpretation, not a conversion instruction. Immutable
  after create — `PATCH` leaves it alone.
- `createdAt`, `updatedAt`

### ObservationEntry (multiple per Observation)
- `id: uuid`
- `observationId: uuid`
- `type: enum('temperature','heart_rate','respiratory_rate','oxygen_saturation','pain_score','weight','height','lesion_size','symptom','note','tag','photo')`
- `metadata: jsonb` (type-specific structured data, below)
- `createdAt`, `updatedAt`

#### Observation entry structured metadata
All numeric values stored in canonical units.

| Type | Metadata fields |
| --- | --- |
| temperature | `value: decimal`, `unit: enum('C','F')`, `method: enum('oral','tympanic','axillary','rectal','temporal','unknown')`, `note?: string` |
| heart_rate | `bpm: integer`, `note?: string` |
| respiratory_rate | `breathsPerMin: integer`, `note?: string` |
| oxygen_saturation | `percent: integer`, `note?: string` |
| pain_score | `score: integer (0-10)`, `note?: string` |
| weight | `kg: decimal(4,2)`, `note?: string` |
| height | `cm: decimal(5,2)`, `note?: string` |
| lesion_size | `lengthCm: decimal`, `widthCm: decimal | null`, `depthCm: decimal | null`, `bodyLocation: string`, `side: enum('left','right','bilateral','n/a')`, `note?: string` |
| symptom | `tag: string (from fixed list)`, `severity: enum('mild','moderate','severe') | null`, `note?: string` |
| tag | `tag: string` (free-form or fixed tags), `note?: string` |
| photo | `fileId: uuid`, `bodyLocation: string`, `side: enum(...)`, `sizeCm: decimal | null`, `note?: string` |
| note | `text: string`, `symptom?: string` (optional symptom label) |

### Intervention (base)
- `id: uuid`
- `patientId: uuid`
- `recordedByUserId: uuid`
- `performedAt: datetime`
- `type: enum('medication_dose','dressing_change')`
- `scheduleId: uuid | null` (link to InterventionSchedule when logged from a schedule)
- `notes: text`
- `metadata: jsonb`
- `createdAt`, `updatedAt`

#### Intervention metadata
- Medication dose:
  - `medicationId: uuid`
  - `medicationEmbodimentId: uuid`
  - `amountMg: decimal`
  - `amountMl: decimal | null`
  - `pillCount: decimal | null`
  - `doseSource: enum('weight_based','age_based','override')`
  - `weightKgUsed: decimal | null`
  - `ageMonthsUsed: integer`
  - `guidelineId: uuid | null`
  - `interventionScheduleId: uuid | null` (also stored separately as `scheduleId` for querying)
  - `nextAllowedAt: datetime` — computed forward from *this* dose: when the next one may be given.
    `null` when no applicable guideline supplied a `minIntervalHours`/`frequencyPerDay`.
  - `isAtypical: boolean`
  - `atypicalReason: string | null` — comma-joined when multiple rules trigger at once (e.g.
    `"exceeds_max_per_dose,interval_too_short"`); see "Data integrity rules" below for the full set.
    `guidelineId`, `weightKgUsed`, and `ageMonthsUsed` are **server-resolved**, not client-trusted:
    the API looks up the applicable guideline itself from `medicationId`/`medicationEmbodimentId`/
    the patient's current weight and age at `performedAt` (see `api.md` → Dosing engine), rather than
    persisting whatever the client happened to send for `weight_based`/`age_based` sources. Under
    `doseSource: 'override'`, `guidelineId` is honored as passed (there is no "correct" guideline to
    resolve when overriding).
- Dressing change:
  - `bodyLocation: string`
  - `side: enum('left','right','bilateral','n/a')`
  - `dressingType: string`

### Medication
- `id: uuid`
- `name: string`
- `brandNames: string[]` (common brand/layman names for caregiver-friendly search/display)
- `description: text`
- `tags: string[]` (arbitrary classification, e.g., "antipyretic")
- `defaultActive: boolean`
- `createdAt`, `updatedAt`

### MedicationEmbodiment
- Represents a specific formulation/strength.
- Fields:
  - `id: uuid`
  - `medicationId: uuid`
  - `label: string` (e.g., "500mg tablet", "5mg/mL syrup")
  - `concentrationMgPerMl: decimal | null`
  - `strengthMgPerUnit: decimal | null`
  - `unitType: enum('tablet','capsule','ml','drop','other')`
  - `notes: text`
  - Cabinet awareness fields (F-9.1–F-9.3; kept deliberately light per F-9.4 — no inventory counts):
    - `atHome: boolean` — whether the household has marked this embodiment as physically present.
    - `expiresAt: date | null`
    - `runningLow: boolean` — one-tap flag set at the exact moment someone is holding the (nearly
      empty) bottle; cleared on "restocked". Not a count.
    - `runningLowFlaggedByUserId: uuid | null`, `runningLowFlaggedAt: datetime | null` — attribution
      for the flag itself (P3), set/cleared together with `runningLow`.

### MedicationGuideline
- `id: uuid`
- `medicationId: uuid`
- `medicationEmbodimentId: uuid | null` (null = guideline applies across embodiments)
- `source: string` (reference, protocol)
- `type: enum('weight_based','age_band')`
- Weight-based fields:
  - `mgPerKg: decimal`
  - `maxMgPerDose: decimal`
  - `maxMgPerDay: decimal`
  - `minIntervalHours: decimal`
  - `ageMinMonths: integer | null`
  - `ageMaxMonths: integer | null`
- Age-band fields:
  - `ageMinMonths: integer`
  - `ageMaxMonths: integer`
  - `doseMg: decimal`
  - `doseMl: decimal | null`
  - `pillCount: decimal | null`
  - `maxMgPerDay: decimal`
  - `frequencyPerDay: integer`
- Shared fields:
  - `notes: text`

### InterventionSchedule
- Represents planned interventions (medication doses or dressing changes) to drive notifications and quick logging.
- Fields:
  - `id: uuid`
  - `patientId: uuid`
  - `type: enum('medication_dose','dressing_change')`
  - `medicationId: uuid | null` (required when type = medication)
  - `medicationEmbodimentId: uuid | null`
  - `episodeId: uuid | null`
  - `conditionId: uuid | null` — at most one of `episodeId`/`conditionId` is set (service-validated,
    see "Data integrity rules"): a standing regimen belongs to a Condition directly, while an
    acute course belongs to the Episode it was prescribed for.
  - `label: string` (e.g., "Amoxicillin q8h", "Nightly dressing")
  - Medication fields:
    - `doseMg: decimal`
    - `doseMl: decimal | null`
    - `pillCount: decimal | null`
  - Dressing change fields:
    - `bodyLocation: string | null`
    - `side: enum('left','right','bilateral','n/a') | null`
    - `dressingType: string | null`
  - `frequencyHours: decimal | null` (simple interval)
  - `explicitTimes: time[] | null` (for fixed times per day)
  - `startAt: datetime`
  - `endAfterOccurrences: integer | null`
  - `endAt: datetime | null`
  - `notes: text`
  - `status: enum('active','completed','paused')`
  - `nextDueAt: datetime`
  - `createdByUserId: uuid`
  - `createdAt`, `updatedAt`
- Linking:
  - When an intervention is logged from a schedule, `interventionScheduleId` is stored on the intervention.


### FileAsset
- `id: uuid`
- `bucket: string` (placeholder; local storage path in MVP)
- `path: string`
- `contentType: string`
- `sizeBytes: integer`
- `patientId: uuid | null` — nullable so `ensurePatientAccess` can gate `GET /api/files/:id` once a
  file is attached to a patient, the same access-control shape as every other patient-scoped
  resource. Set at upload time from the patient already selected in the entry form (§5.8) — there
  is no genuinely patient-less upload path in practice, but the column stays nullable rather than
  required so a future non-patient-scoped use of the files endpoint (e.g. household-level assets)
  isn't blocked by a schema change.
- `createdByUserId: uuid`
- Linked to photo observation entries via `metadata.fileId` (data-model.md → "Observation entry
  structured metadata").

### Advisory

See `advisories.md` for the concept, producer catalog, and lifecycle. Fields:

- `id: uuid`
- `patientId: uuid`
- `type: enum('atypical_dose','stale_weight','expired_embodiment','running_low','reaction_warning','reaction_danger','protocol_fired')`
- `severity: enum('info','warning','danger')`
- `sourceType: enum('guideline','embodiment','reaction','protocol') | null`, `sourceId: uuid | null`
  — polymorphic, deliberately **not** a foreign key (same pattern as `episodes_events_pivot`'s
  `eventType`/`eventId`); what produced the advisory.
- `contextType: enum('observation','intervention') | null`, `contextId: uuid | null` — the event it
  attached to. `null` on a preview candidate that was never persisted.
- `payload: jsonb` — type-specific detail (e.g. `{ reasons: [...], amountMg, maxMgPerDose }` for
  `atypical_dose`; `{ daysSince, lastRecordedAt }` for `stale_weight`).
- `acknowledgedByUserId: uuid | null`, `acknowledgedAt: datetime | null` — set at creation time for
  the M2 producers (saving past the warning is the acknowledgment); left null until a later
  `POST /api/advisories/:id/ack` for the "seen but backed out" case introduced with reactions.
- `createdAt`, `updatedAt`

### ErBriefSnapshot

See `er-brief.md` for the concept and `security.md` → "ER Brief snapshot tokens" for the security
model. A frozen, time-limited, unauthenticated export of one `GET .../er-brief` response.

- `id: uuid`
- `patientId: uuid`
- `episodeId: uuid | null` — the episode the snapshot was scoped to, if any.
- `token: string` (unique) — 32 bytes from a CSPRNG, base64url-encoded; the capability itself.
- `payload: jsonb` — the full brief response, computed once at creation and never recomputed.
- `createdByUserId: uuid`
- `createdAt: datetime`
- `expiresAt: datetime` (**not nullable** — every snapshot expires; capped at creation, 168h max).

### Revision

Corrections (F-1.4): "entries can be corrected after the fact; corrections are attributed, and the
original remains part of the record." One generic table backs every correctable entity rather than
a per-entity history table each — the shape of "what changed" doesn't vary by entity type, only
the snapshot's contents do.

- `id: uuid`
- `entityType: enum('observation','intervention','condition','patient')`
- `entityId: uuid` — polymorphic, deliberately **not** a foreign key (same pattern as
  `episodes_events_pivot`'s `eventType`/`eventId` and `Advisory`'s `sourceType`/`sourceId`).
- `snapshot: jsonb` — the entity's **full prior state**, in the same client-facing shape its own
  `GET` endpoint already returns (not the raw DB row) — a revision list should be readable without
  a second lookup table to decode it.
- `editedByUserId: uuid`
- `editedAt: datetime`
- Captured by the entity's own service, immediately before an update is applied — see api.md →
  "Corrections". Only mutating `PATCH` endpoints capture a revision; a `PATCH` that changes nothing
  observable (e.g. an empty body) still captures one today — reconstructability (N-2) errs toward
  capturing too often rather than silently skipping a save whose diff turned out to be empty.

## Derived/computed data
- `TimelineEntry` (query projection): merges observations + interventions sorted by timestamp.
- `PatientActiveEpisodes`: query episodes where `status = 'active'`.
- `LatestWeightPromptFlag`: computed when `now - latestWeightRecordedAt > 60 days`.
- `ScheduleAdherence` (per `InterventionSchedule`, computed on read — intended-vs-actual, F-4.3):
  - `expectedCount`: how many occurrences should have happened between `startAt` and now, derived
    from `frequencyHours` or `explicitTimes`.
  - `loggedCount`: doses actually logged against this schedule (`intervention.scheduleId` match).
  - `missed`: `max(0, expectedCount - loggedCount)`.
  - `remainingOccurrences`: `endAfterOccurrences - loggedCount` when `endAfterOccurrences` is set
    (F-4.4 — "3 doses of amoxicillin left"), else `null` for open-ended schedules.
  - `overdue`: `nextDueAt` in the past while `status = 'active'` — the dashboard's "upcoming action"
    surfacing (F-4.1).

## Data integrity rules
- Observations/interventions must belong to at least one patient.
- Episode start/end linkages come from `episodes_events_pivot`; a single event can start one episode and optionally resolve others.
- Medication dose `weightKgUsed` required when `doseSource = 'weight_based'`.
- `isAtypical` set true when any of the following hold (all evaluated independently; every one that
  triggers contributes its reason to the comma-joined `atypicalReason`):
  - `doseSource = 'override'` **and no `scheduleId`** — reason `override`. A caregiver-chosen
    amount that doesn't follow either computed guideline is inherently the "legitimate off-guideline
    decision" the app preserves as a first-class annotated event (F-2.4) — not itself a magnitude
    problem, but worth a permanent trace that no guideline was followed. This is exempted when the
    dose is logged from an `InterventionSchedule` (`scheduleId` set): a scheduled dose is executing
    a plan a caregiver already deliberately set up, not an ad-hoc deviation in the moment — flagging
    every scheduled dose as atypical would just be noise. The magnitude/interval checks below still
    apply regardless of `scheduleId`.
  - `amountMg` exceeds the applicable guideline's `maxMgPerDose` — reason `exceeds_max_per_dose`.
  - The prospective daily total (prior same-medication doses in the trailing 24h, plus this one)
    exceeds the applicable guideline's `maxMgPerDay` — reason `exceeds_max_per_day`.
  - `performedAt` earlier than the immediately preceding same-medication dose's own `nextAllowedAt`
    — reason `interval_too_short`.
  - None of these ever blocks the save (N-3, P1) — see `advisories.md` → "No hard stops".
- `resolvesEpisodeIds` on observations/interventions must be a subset of episodes they are linked to via pivot.
- `episodeId` on `InterventionSchedule` optional; when provided, schedule should tag interventions to same episode.
- Enforce canonical units at persistence boundary; convert in API/UI.
- `MedicationGuideline.source` is required — never persist a guideline without provenance (N-4).
- No inventory counts are ever stored for `MedicationEmbodiment` (F-9.4) — only `atHome`, `expiresAt`,
  and the `runningLow` flag. Manual quantity tracking is a chore that dies of non-compliance; the
  running-low flag plus computed course remainders (from `InterventionSchedule.endAfterOccurrences`,
  once schedules exist) cover the need instead.
- `AdverseReaction`: exactly one of `medicationId`/`embodimentId`/`tag` must be set, and it must
  match `scopeType` — any other combination is rejected with 400 `INVALID_REACTION_SCOPE`. The app
  never infers cross-reactivity from the scope a caregiver chose (P6).
- `InterventionSchedule`: `episodeId` and `conditionId` are mutually exclusive — setting both is
  rejected with 400 `SCHEDULE_EPISODE_CONDITION_CONFLICT`.
- Reaction matching (dose-checks and the dose save path) is **exact, never inferred**: a `medication`-
  scoped reaction matches only on `medicationId` equality, an `embodiment`-scoped reaction only on
  `embodimentId` equality, and a `tag`-scoped reaction only when the tag is present in the selected
  medication's own `tags` — no fuzzy or class-based inference beyond that literal intersection (P6).
- Protocol evaluation (`AdvisoriesService.evaluateProtocols()`, run on every observation create):
  for each active Protocol attached to one of the patient's active Conditions, if the observation
  has an entry of the protocol's `triggerMetric` type, and that entry's value (converted to the
  metric's canonical unit — e.g. a Fahrenheit temperature entry is converted to Celsius before
  comparison) satisfies `triggerOperator`/`triggerValue`, a `protocol_fired` Advisory is written in
  the same request, attached to the observation as `contextType`/`contextId`, and
  self-acknowledged by the recording caregiver (same "saving is the acknowledgment" pattern as
  `atypical_dose` — see `advisories.md`). A resolved Condition's Protocols never fire.
- `Patient.codeStatus`/`codeStatusSetByUserId`/`codeStatusSetAt` are only ever written together, and
  only via `PATCH /api/patients/:id/code-status` — never through the general patient `PATCH`, so the
  attribution stamp can't be bypassed (P3).
