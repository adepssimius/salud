# API Spec

Base stack: NestJS REST API. All routes require authenticated user (email/password session). Responses use JSON. Validation errors return HTTP 400 with machine-readable codes.

## Conventions

**Timestamps in responses are integers of epoch seconds** (UTC), or `null`. This holds for stored
columns (`createdAt`, `updatedAt`, `acknowledgedAt`, `lastSeenAt`), for derived fields (`startedAt`,
`endedAt`, `lastDoseAt`, `nextDueAt`, `frozenAt`, `expiresAt`, `since`), and for timestamps nested
inside a composite response — `TimelineEntry.display`, `ErBrief.body.events`,
`ErBrief.header.careDocuments`, `WhatsNewResponse.events`,
`Revision.snapshot`, and the intervention returned by `POST /api/schedules/:scheduleId/log`.
**No endpoint returns an ISO string in a response body.**

Request bodies are the deliberate opposite: datetime inputs (`observedAt`, `performedAt`, `startAt`,
`endAt`) are ISO 8601 datetime strings, validated by `class-validator`. A client composes a datetime
from a picker on the way in, and renders from an integer on the way out without parsing.

**A datetime that names something that already happened may not be in the future.** `dateOfBirth`,
`observedAt`, `performedAt` and `occurredAt` are rejected with 400 `DATE_IN_FUTURE` when they are
later than the server's clock. A single mistyped year is otherwise permanent and unfixable from the
UI: a dose stamped 2030 pins the dashboard's "last dose" forever, which is the exact question
("did I already give Tylenol?") the app exists to answer.

Planning fields are the opposite and are deliberately **not** bounded: a schedule's `startAt`/`endAt`
describe a course that has not happened yet, and an embodiment's `expiresAt` in the past is the
*warning* condition, not an error. `POST /api/dose-checks` is also exempt — it persists nothing and
exists to answer "what if I gave this at X".

The comparison is strict against the server's clock with no tolerance. Latency works in the client's
favour (a client-stamped time is always older by the time the server sees it), so the only realistic
way to hit this is a client clock running fast — which is worth knowing when diagnosing a
surprising 400.

Storage is SQLite integer epoch seconds, and Drizzle maps `{ mode: 'timestamp' }` columns to `Date`
on read, so the coercion at the persistence boundary is not optional.
`apps/api/src/app/persistence/time.ts` (`normalizeTs`/`toDate`) is the single implementation. A mapper
that copies a row's timestamp field through unconverted ships a `Date`, which serializes as an ISO
string and silently violates this rule.

## Auth
- `GET /api/auth/config`
  - Unguarded. Response: `{ mode: 'oidc' | 'password' }` — which login path is active
    (`authMode()`, `apps/api/src/app/config/env.ts`). The web login page renders its form based on
    this rather than a build-time environment file, since one web bundle serves both modes.
- `POST /api/auth/login`
  - Body: `{ email, password }`
  - Response: `{ token, user: UserDto }`
  - Answers `403 PASSWORD_AUTH_DISABLED` when `mode` is `'oidc'` — see security.md → "OIDC login".
- `POST /api/auth/register`
  - Body: `{ email, password, displayName, preferredTempUnit?, preferredLengthUnit?, preferredWeightUnit? }` where `preferredWeightUnit` ∈ `['kg','lb','st']`.
  - Response: `{ token, user }`
  - Answers `403 PASSWORD_AUTH_DISABLED` when `mode` is `'oidc'`, same as login above.
- `GET /api/auth/me`
  - Returns current user profile.
- `GET /api/auth/oidc/login`
  - Unguarded, a real browser navigation (not a JSON endpoint). Redirects to Authelia and sets a
    short-lived signed transaction cookie. See security.md → "OIDC login".
- `GET /api/auth/oidc/callback`
  - Unguarded, the redirect target Authelia sends the browser back to. On success, redirects to
    `/oidc-complete?code=<handoff>` — never to a URL carrying the session JWT itself. On failure
    (bad/missing state, or a login that lacks the required Authelia group) redirects to
    `/login?error=oidc_state` or `/login?error=oidc_forbidden`.
- `POST /api/auth/oidc/exchange`
  - Unguarded. Body: `{ code }` — the one-time handoff code from the callback redirect above.
    Response: `{ token, user }`, identical shape to login/register. Answers `404
    OIDC_HANDOFF_NOT_FOUND` for an unknown, expired (~60s), or already-used code.

## Resource shape and access control

Patients are **top-level resources**: `/api/patients/:patientId`. A patient has exactly one canonical URL
regardless of which caregiver is asking. The acting user is always taken from the JWT and never appears in
a path — there are no `/api/users/:userId/patients/...` routes.

Rationale: access is granted by `CareTeamMembership`, a many-to-many. Nesting a patient under a user would
imply containment that the data model does not have, and would give the same patient a different URL per
caregiver. All sub-resources (care team, observations, interventions, episodes, schedules, timeline) hang
off `/api/patients/:patientId/...` for the same reason.

`/api/users/*` is reserved for genuinely identity-scoped routes (`/users/me`, `/users/search`).

**Status codes for access failures.** Every patient-scoped route revalidates care team membership. A
requester who is not a member gets **404**, never 403 — the response must be indistinguishable from a
patient that does not exist, so that ids cannot be probed. This is the RFC 9110 sense of 404: the server
either found no representation *or is unwilling to disclose that one exists*. 403 is reserved for cases
where the caller is a member but the specific action is forbidden.

`DELETE /api/patients/:patientId` is the concrete instance of that 403: it is owner-only, so a
caregiver who *is* on the care team but is not the owner gets 403 `NOT_PATIENT_OWNER`. The ordering
is load-bearing — membership is checked first, so a non-member still gets 404 and never learns that
403 was even a possible answer.

## Patients
- `POST /api/patients`
  - Body: `{ fullName, dateOfBirth, sexAtBirth, notes?, myRole?, accentColor? }` where `sexAtBirth` ∈ `['female','male']`
    and `myRole` ∈ `['self','parent','co-parent','nanny','grandparent','babysitter','other']`.
  - `accentColor` is a palette token (data-model.md → Patient); when omitted the server assigns the
    least-used token across the requester's accessible patients. An unknown token is a standard
    validation 400. Included on every `PatientDto` response.
  - Creator is added to the care team with `myRole` (defaults to `parent`; choose `self` to mark self-care)
    and is recorded as `ownedById`.
  - Response: `PatientDto` (201).
- `PATCH /api/patients/:patientId/code-status`
  - Body: `{ codeStatus: string }`.
  - Deliberate, separate act (§4.1, F-7.2): stamps `codeStatusSetByUserId`/`codeStatusSetAt` from
    the requester server-side — never accepted from the client, and never settable through the
    general `PATCH /api/patients/:patientId`. Response: `PatientDto` including the code status
    fields; the client computes and displays the relative age ("set 14 months ago").
- `GET /api/patients`
  - Returns patients where the requester is on the care team, each including `myRole` for the requester.
- `GET /api/patients/:patientId`
  - Returns patient details including `myRole` for the requester and latest weight metadata.
  - `patientId` must be a v4 UUID.
- `PATCH /api/patients/:patientId`
  - Body: `{ fullName?, dateOfBirth?, sexAtBirth?, notes?, ownedById?, accentColor? }`.
  - `ownedById` transfers ownership. The target must be an existing user (404 `USER_NOT_FOUND` otherwise)
    and is added to the care team with role `parent` if not already a member.
- `DELETE /api/patients/:patientId`
  - **Owner-only.** Only `ownedById` may delete. A care team member who is not the owner gets 403
    `NOT_PATIENT_OWNER`; a non-member still gets 404 `PATIENT_NOT_FOUND` (membership is checked
    first). Transfer ownership via `PATCH /api/patients/:patientId` if someone else should be able to.
    The asymmetry this closes: `DELETE .../care-team/:caregiverUserId` already refuses to remove the
    owner, so removing one caregiver was protected while destroying the entire record was not.
  - **Deletes everything belonging to the patient**, not just the care team memberships: conditions
    and their protocols, episodes and their pivot rows, observations and their entries,
    interventions, intervention schedules, adverse reactions, care document statements, advisories,
    ER Brief snapshots,
    revisions, and file assets — including the stored blobs on disk, since an orphaned clinical photo
    of a child that nothing will ever garbage-collect is a privacy problem, not housekeeping.
  - Two of those tables are polymorphic and carry no foreign key — `episodes_events_pivot.event_id`
    and `revisions.entity_id` — so they are matched by id lookup rather than by cascade. Nothing
    reaches them automatically; see data-model.md → Data integrity rules.
  - Response: `{ deleted: true }`.

## Care team
- `GET /api/patients/:patientId/care-team`
  - Lists caregivers and roles: `[{ user: { id, email, displayName }, role }]`.
- `POST /api/patients/:patientId/care-team`
  - Body: `{ userId, role? }`. Adds the caregiver, or updates `role` if they are already on the team.
  - Only one `self` membership is allowed per patient; a conflicting request returns 400
    `SELF_RELATIONSHIP_ALREADY_EXISTS`.
  - Phase 1 is limited to existing users. Invitation by email (`invitationEmail`) is deferred.
- `DELETE /api/patients/:patientId/care-team/:caregiverUserId`
  - Removes a caregiver. The owner (`ownedById`) cannot be removed — 400 `CANNOT_REMOVE_OWNER`; transfer
    ownership via `PATCH /api/patients/:patientId` first.
  - Removing a user who is not on the team is a no-op returning `{ deleted: false }`.

## Episodes
- Created/resolved only as a result of an observation or intervention (no direct POST).
- Every id in an event's `episodeIds`/`resolvesEpisodeIds` must belong to the **same patient as the
  event** — 404 `EPISODE_NOT_FOUND` otherwise. Without this an observation on one child can be
  attached to another child's episode and will render inside that child's episode view, timeline and
  ER Brief.
- **An episode resolves once.** A second, different event attempting to resolve an already-resolved
  episode returns 400 `EPISODE_ALREADY_RESOLVED` rather than silently overwriting `endedAt`. The
  *same* event re-asserting its own resolution is a no-op returning 200 — a `PATCH` that only
  changes `episodeIds` re-sends the event's existing `resolvesEpisodeIds`, and that must not fail.
- `GET /api/patients/:patientId/episodes`
  - Supports filters `status=active|resolved`.
  - Each item includes derived `startedAt`/`endedAt` (epoch seconds, resolved from the linked
    event's own timestamp; `endedAt` is `null` while active) — data-model.md → Episode.
- `GET /api/episodes/:episodeId`
  - Returns details + linked observations/interventions (IDs only) — for the hydrated events
    themselves (with medication names and human-readable summaries), the client calls
    `GET /api/patients/:patientId/timeline?episodeId=:episodeId`, which already exists and already
    filters to one episode.
  - Includes derived `startedAt`/`endedAt` (epoch seconds, resolved from the linked event's own
    timestamp; `endedAt` is `null` while active) — same resolution `GET .../episodes` already does,
    now consistent between the list and single-item routes.
- `GET /api/episodes/active`
  - Returns all active episodes for patients on the requester’s care team.
  - Each item carries the episode's `createdAt`/`updatedAt` (epoch seconds) plus a denormalized
    `patientName`. Unlike the other two episode routes it does **not** resolve derived
    `startedAt`/`endedAt` — the dashboard resolves those itself from the linked event.

## Conditions

Standing frames for chronic illness (data-model.md → `Condition`); patient-scoped.

- `POST /api/patients/:patientId/conditions`
  - Body: `{ name, diagnosisText?, status?, baselines?: string[], devices?: string[], contacts?: { name, role, phone }[] }`.
    `status` defaults to `active`.
  - Response: `Condition` (201).
- `GET /api/patients/:patientId/conditions`
  - Query: `status?`.
- `GET /api/conditions/:conditionId`
  - Includes linked `episodeIds`, `scheduleIds`, and `protocols` (full objects, since a caregiver
    reading a Condition wants the standing instructions inline, not a second round-trip).
- `PATCH /api/conditions/:conditionId`
  - Body: any subset of the create fields. `baselines`/`devices`/`contacts` are replaced whole, not
    merged — same edit-whole-via-PATCH shape as the JSON-array fields elsewhere (data-model.md).
- `DELETE /api/conditions/:conditionId`

### Protocols
Hang off a Condition, mirroring the medication → guideline sub-resource shape.

- `POST /api/conditions/:conditionId/protocols`
  - Body: `{ name, triggerMetric, triggerOperator, triggerValue, instructionText, sourceText, active? }`
    where `triggerMetric` ∈ `['temperature','heart_rate','respiratory_rate','oxygen_saturation','pain_score']`
    and `triggerOperator` ∈ `['gte','lte']`. `triggerValue` is in the metric's canonical unit (°C
    for `temperature`). `active` defaults to `true`.
- `GET /api/conditions/:conditionId/protocols`
- `GET /api/protocols/:protocolId`
- `PATCH /api/protocols/:protocolId`
- `DELETE /api/protocols/:protocolId`
- Evaluation is not a client-called endpoint — it runs automatically inside
  `POST /api/patients/:patientId/observations` (see "Observations" and `advisories.md`).

## Observations
- `POST /api/patients/:patientId/observations`
  - Body:
    ```json
    {
      "observedAt": "ISO datetime",
      "text": "optional note",
      "startEpisodeName": "optional new episode name",
      "startEpisodeConditionId": "optional condition uuid to nest the new episode under",
      "episodeIds": ["uuid"],          // optional existing episodes to tag
      "resolvesEpisodeIds": ["uuid"],  // must be subset of episodeIds
      "unitPreferenceAtEntry": {       // optional; the recorder's display units at entry time
        "temp": "F", "weight": "lb", "length": "in"
      },
      "entries": [
        { "type": "temperature", "metadata": { "value": 38.2, "unit": "C", "method": "oral" } },
        { "type": "heart_rate", "metadata": { "bpm": 120 } },
        { "type": "tag", "metadata": { "tag": "cough" } }
      ]
    }
    ```
  - Validation:
    - At least one entry required (400 `AT_LEAST_ONE_ENTRY_REQUIRED`); each entry `type` must match
      schema (data model).
    - `resolvesEpisodeIds` must be subset of `episodeIds`, and every id in either list must belong to
      **this** patient (404 `EPISODE_NOT_FOUND`).
    - If any entry type = `photo` or `document`, `metadata.fileId` is required, and the file must
      already exist and be attached to this patient (or be a patientless upload by the acting
      user) — 400 `PHOTO_FILE_NOT_FOUND` / `DOCUMENT_FILE_NOT_FOUND` otherwise. A shape-valid UUID
      that names nothing is a permanently broken image in the timeline and the ER Brief, so it is
      caught at write time rather than at read time. One code covers "no such file" and "someone
      else's file" alike, for the same no-probing reason `GET /api/files/:fileId` returns 404 to a
      non-member.
    - If any entry type = `lab_result`, `metadata.analyteId` is required and must name an existing
      analyte — 400 `ANALYTE_NOT_FOUND` otherwise, checked before insert for the same
      no-orphaned-observation reason as the file checks. Callers writing lab results directly (the
      import page, or curl) call `POST /api/analytes/resolve` first to turn printed names into ids.
      Reference-range fields are **rejected** on `lab_result` metadata (`OBSERVATION_SCHEMA_INVALID`,
      like any unrecognized field): the range is a catalog standard, not measurement data.
  - **Reads hydrate `lab_result` entries** with a non-persisted `labContext` sibling
    (`{ displayName, ranges }` — every one of the patient's range lineages for that analyte,
    each resolved at the observation's `observedAt`)
    — data-model.md → "Lab result read-time context". It is never accepted on write; a `PATCH` that
    echoes an observation back must omit it.
    - Numeric entry metadata is range-checked (data-model.md → "Observation entry structured
      metadata"). This matters most for `weight`: the value denormalizes onto the patient and then
      feeds mg/kg dose calculation, so a negative or absurd figure is a dosing-input corruption, not
      a cosmetic one.
    - Weight entries update patient latest weight + timestamp.
    - `unitPreferenceAtEntry`, when present, must carry all three keys with valid values
      (`temp: 'C'|'F'`, `weight: 'kg'|'lb'|'st'`, `length: 'cm'|'in'`).
  - `unitPreferenceAtEntry` is **client-stamped**, not derived server-side: it records what the
    caregiver actually saw on screen, which the server can't know (the user's stored preference may
    have changed since, and a stale client may be showing the old one). Entry metadata itself is
    still canonical — the client converts before sending — so this is provenance for display, not a
    conversion instruction. Echoed on every read; `null` when omitted. **`PATCH` never modifies
    it** — a later correction doesn't change the units the original recorder was working in.
  - After the entries and episode linkage are written, `AdvisoriesService.evaluateProtocols()` runs
    against the active Protocols of the patient's active Conditions (data-model.md → "Data
    integrity rules"); any that trip are written as `protocol_fired` Advisories in the same
    request.
  - Response: `ObservationDto` with `entries[]`, plus `firedAdvisories: Advisory[]` — the
    `protocol_fired` advisories (if any) this specific save just triggered, so the web layer can
    render the protocol card immediately without a second fetch (frontend.md → "Protocol card").
    Empty on every other read of an observation (`GET`, list, timeline) — there's no "preview"
    endpoint for protocols the way dose-checks previews dosing, since a trip only means anything
    once the observation is actually saved.
- Episode linkage is stored via pivot rows (`episodes_events_pivot`) with flags for start/resolve per event.
- `GET /api/patients/:patientId/observations`
  - Query params: `type?`, `episodeId?`, `from?`, `to?`, `limit?`
  - If `type` provided, filter observations that include at least one entry of that type.
  - Returns list, newest first, with entries.
- `GET /api/observations/:observationId`
  - Enforce caregiver access; 404 if the observation’s patient is not on the requester’s care team or the patient id in URL (when provided) does not match.
- `PATCH /api/observations/:observationId`
  - Allow editing text, tags, episode/resolution ids, and replacing entries (entries array replaces existing entries).

## Interventions
- `POST /api/patients/:patientId/interventions`
  - Body for `type="medication_dose"`:
    ```json
    {
      "performedAt": "...",
      "type": "medication_dose",
      "episodeIds": [],
      "startEpisodeName": "optional new episode name",
      "startEpisodeConditionId": "optional condition uuid to nest the new episode under",
      "medicationId": "uuid",
      "medicationEmbodimentId": "uuid",
      "doseSource": "weight_based|age_based|override|schedule",
      "amountMg": 250,
      "amountMl": 5,
      "pillCount": 2,
      "weightKgUsed": 14.5,
      "ageMonthsUsed": 48,
      "guidelineId": "uuid",
      "interventionScheduleId": "uuid",
      "notes": ""
    }
    ```
  - `doseSource` records **how the caregiver arrived at the amount**, not how good the amount is:
    `weight_based` and `age_based` mean they took the engine's number, `override` means they typed
    their own, and `schedule` means the dose came from `POST /api/schedules/:scheduleId/log` — a
    plan already set up rather than a decision made in the moment. A client only ever sends the first
    three; `schedule` is written by the schedule-log path itself.
  - The API runs the same dosing engine used by `POST .../dose-checks` (see "Dosing engine" below)
    and computes, **overriding whatever the client sent** for `weight_based`/`age_based` sources
    (client-sent `guidelineId`/`weightKgUsed`/`ageMonthsUsed` are honored only under
    `doseSource: 'override'`/`'schedule'`, where there is no guideline to resolve):
    - `guidelineId` — the guideline actually resolved for the chosen `doseSource`, or the
      client-provided value under `override`.
    - `weightKgUsed`, `ageMonthsUsed` — the patient's weight/age at `performedAt`.
    - `nextAllowedAt` — this dose's forward next-allowed time; `null` if no guideline supplied an
      interval.
    - `isAtypical` + `atypicalReason` (comma-joined reason list; see `data-model.md` → "Data
      integrity rules" for the full rule set). Request is always accepted (N-3, P1) — the flag
      only indicates a warning was shown and the caregiver saved anyway.
    - Persists one `atypical_dose` Advisory when `isAtypical`, plus a `stale_weight` and/or
      `expired_embodiment` Advisory when applicable (see `advisories.md`).
  - Dressing change body:
    ```json
    {
      "performedAt": "...",
      "type": "dressing_change",
      "episodeIds": [],
      "startEpisodeName": "optional new episode name",
      "startEpisodeConditionId": "optional condition uuid to nest the new episode under",
      "bodyLocation": "Left knee",
      "side": "left",
      "dressingType": "sterile gauze",
      "interventionScheduleId": "uuid",
      "notes": ""
    }
    ```
  - Validation:
    - `resolvesEpisodeIds` must be subset of `episodeIds`, and every id in either list must belong to
      **this** patient (404 `EPISODE_NOT_FOUND`).
    - `medicationId` is **required** when `type = 'medication_dose'` (400 `MEDICATION_ID_REQUIRED`),
      and `bodyLocation` when `type = 'dressing_change'` (400 `BODY_LOCATION_REQUIRED`) — the same
      two rules schedule create has always enforced. A dose with no medication isn't merely an empty
      record: it skips guideline resolution entirely, so the dosing engine and every advisory
      silently do nothing. A `PATCH` is checked against the **merged** result, so clearing
      `medicationId` on an existing dose is rejected too.
    - `interventionScheduleId` is stored only (no schedule state updates); also persisted as `scheduleId` column for querying.
    - `guidelineId` optional; omit if not provided.
    - `medicationId`, `medicationEmbodimentId` and `guidelineId` must be v4 UUIDs.
    - `amountMg`, `amountMl`, `pillCount`, `weightKgUsed` and `ageMonthsUsed` are range-checked; a
      negative `amountMg` would otherwise count toward the daily total.
  - Response: `InterventionDto` (201) with computed fields where applicable.
- Episode linkage is stored via pivot rows (`episodes_events_pivot`) with flags for start/resolve per event.
- `GET /api/patients/:patientId/interventions`
  - Filters: `type`, `medicationId`, `tag`, `episodeId`, `from`, `to`.
- `GET /api/interventions/:interventionId`
- `PATCH /api/interventions/:interventionId`
  - Allow updates with re-validation of atypical logic.

## Dosing engine

One server-side engine; the client never re-implements guideline math (P1, P2). It backs both the
inline pre-save preview and the actual save path on `POST /api/patients/:patientId/interventions`.

- `POST /api/patients/:patientId/dose-checks`
  - **Preview only — computes, persists nothing.** Called debounced as the dose-entry form fills
    in; abandoning the form leaves no trace (see `advisories.md` → "Two lifecycles").
  - Body: `{ medicationId, medicationEmbodimentId?, amountMg?, occurredAt? }`. `amountMg` is
    optional — omit it to see guidance before an amount is chosen; the per-dose/per-day threshold
    checks only run once an amount is supplied.
  - Response:
    ```json
    {
      "guidance": {
        "weightBased": {
          "guidelineId": "uuid", "source": "...", "mgPerKg": 15,
          "computedMg": 217.5, "computedMl": 5.4, "concentrationMgPerMl": 40,
          "maxMgPerDose": 1000, "maxMgPerDay": 4000,
          "minIntervalHours": 4, "weightKgUsed": 14.5, "weightRecordedAt": 1234567890
        },
        "ageBand": {
          "guidelineId": "uuid", "source": "...", "doseMg": 160, "doseMl": 5,
          "doseMlSource": "guideline", "concentrationMgPerMl": 32,
          "pillCount": null, "frequencyPerDay": 4, "maxMgPerDay": 800,
          "ageMonthsUsed": 18, "applicable": true
        }
      },
      "nextAllowedAt": 1234571490,
      "dailyTotalMg": 217.5,
      "advisories": [
        { "type": "stale_weight", "severity": "warning", "payload": { "daysSince": 75, "lastRecordedAt": 1234000000 } },
        { "type": "reaction_danger", "severity": "danger", "sourceType": "reaction", "sourceId": "uuid", "payload": { "description": "throat swelled up", "occurredAt": 1234000000 } }
      ]
    }
    ```
    Either `guidance.weightBased` or `guidance.ageBand` is `null` when no applicable guideline
    exists (no weight on file; patient's age falls outside every age-band guideline for this
    medication) — **neither is preselected as "the answer"; both render when both exist** (F-2.1,
    P2). `advisories` are unpersisted candidates in the shape described in `advisories.md`,
    including one `reaction_warning`/`reaction_danger` candidate per `AdverseReaction` whose scope
    exactly matches the request (see "Adverse reactions" below) — the same list a `dose-checks`
    preview already returns for `stale_weight`/`expired_embodiment`, so the web layer's advisory
    rendering needs no reaction-specific branch.
- Guideline resolution rules (shared by preview and save):
  - **Embodiment-specific wins over medication-level**: among a medication's guidelines of a given
    type, one scoped to the requested `medicationEmbodimentId` is preferred over one with a null
    `medicationEmbodimentId` (applies across all embodiments).
  - **Age-range applicability**: a guideline with `ageMinMonths`/`ageMaxMonths` set is skipped if
    the patient's age at `occurredAt` falls outside that range. An age-band guideline with no match
    for the patient's current age yields `guidance.ageBand: null` ("applicable only while the
    patient hasn't grown into adult dosing").
  - **Daily total**: sum of `amountMg` across the same patient's same-medication doses in the
    trailing 24 hours before `occurredAt`, plus the candidate amount if supplied.
  - **`nextAllowedAt`**: computed forward from `occurredAt` using the resolved guideline's
    `minIntervalHours` (weight-based) or `24 / frequencyPerDay` hours (age-band, when no
    weight-based interval is available). `null` when neither yields an interval.
  - **mL derivation**: `weightBased.computedMl` is `computedMg ÷ concentrationMgPerMl` of the
    **selected embodiment**, and `null` when no embodiment was supplied or it has no concentration
    (tablets and capsules). The caregiver is holding a syringe, not a scale — and per the rule at the
    top of this section, the client never does guideline arithmetic, including this division.
    `concentrationMgPerMl` is echoed so the UI can show its working.
    - **Rounding is syringe-realistic**: to the nearest 0.1 mL at or above 1 mL, and the nearest
      0.05 mL below — the graduations actually printed on a paediatric oral syringe. Reporting
      `5.4375 mL` names a volume nobody can draw. The consequence, stated plainly so nobody "fixes"
      it: `computedMl × concentrationMgPerMl` will not always equal `computedMg` exactly.
      `computedMg` is the computed target; `computedMl` is the deliverable volume; the gap is at most
      half a graduation.
    - **Age band**: a guideline's stored `doseMl` wins, because it carries that guideline's own
      provenance (`MedicationGuideline.source`). Only when it is null and both `doseMg` and a
      concentration exist is a value derived, with the same rounding. `doseMlSource` reports which
      happened — `'guideline'`, `'derived'`, or `null` — so the UI never prints a derived volume
      underneath a guideline's source line as though the guideline said it.
    - The engine does **not** adjudicate a disagreement between a guideline's stored `doseMl` and
      what the selected bottle's concentration implies: no advisory, no correction. That would be the
      app arbitrating between a printed label and a physical bottle, which is exactly the inference
      P6 forbids.
    - On save, `amountMl` is **not** auto-filled server-side. Intervention metadata records what the
      caregiver says they gave; guidance records what the engine suggested. The web fills the field
      when the caregiver taps "Use this", so the value still arrives through the request body.
  - **Reaction matching**: every `AdverseReaction` on the patient is checked against the request's
    `medicationId`/`medicationEmbodimentId` (and the medication's own `tags`, for `tag`-scoped
    reactions) — exact match only, per the reaction's own `scopeType` (data-model.md → "Data
    integrity rules"). Each match becomes one `reaction_warning`/`reaction_danger` advisory
    candidate. Runs identically in preview and the save path, since it's driven off the same
    `medicationId`/`embodimentId` inputs either way.

## Adverse reactions

Patient-scoped (data-model.md → `AdverseReaction`).

- `POST /api/patients/:patientId/reactions`
  - Body: `{ description, occurredAt?, severity, scopeType, medicationId?, embodimentId?, tag? }`
    where `severity` ∈ `['warning','danger']` and `scopeType` ∈ `['embodiment','medication','tag']`.
    Exactly one of `medicationId`/`embodimentId`/`tag` must be present, matching `scopeType` — any
    other combination is 400 `INVALID_REACTION_SCOPE`.
  - **`occurredAt` is optional** and stores `null` when omitted. A caregiver frequently knows *that*
    a child reacted to amoxicillin without knowing *when*, and requiring a date would force a
    fabricated one into a record the app keeps forever. `null` means "date not known" — never "no
    reaction". Reaction matching in the dosing engine never consults the date, so an undated
    reaction fires exactly as strongly as a dated one.
  - Response: `AdverseReaction` (201).
- `GET /api/patients/:patientId/reactions`
  - Lists a patient's reactions, newest first, ordered by `COALESCE(occurredAt, createdAt) DESC` — an
    undated reaction sorts by when it was recorded, rather than sinking to the bottom of the list
    purely for lacking a date.
- `DELETE /api/patients/:patientId/reactions/:reactionId`
  - Removes a reaction. 404 `REACTION_NOT_FOUND` when it does not exist or belongs to another
    patient. A reaction drives a full-screen danger interstitial on every future dose of that
    medication, so a mis-scoped entry has to be correctable; "remembered forever" (data-model.md)
    means the app never expires a reaction on its own, not that a caregiver cannot undo their own
    typo. Response: `{ deleted: true }`.

## Advisories

See `advisories.md` for the full concept. API surface:

- `GET /api/patients/:patientId/advisories` — list a patient's advisories, newest first.
- `POST /api/advisories/:advisoryId/ack` — mark an advisory acknowledged by the requester. Used by
  the `danger`-class reaction interstitial when a caregiver **sees** the warning but backs out of
  saving — there's no event to attach the advisory to as `context` in that case, so the client acks
  it directly. `atypical_dose`/`protocol_fired`/reaction advisories that *do* end up persisted
  alongside a saved event self-acknowledge at creation and don't need this.

## Intervention schedules

Intent, modeled apart from events (data-model.md → `InterventionSchedule`): "amoxicillin 400 mg
every 8 h for 10 doses." The chain runs **dose → schedule → episode/condition** — every dose traces
back to the reason it was prescribed (F-4.2), and intended-vs-actual is comparable (F-4.3).

- `POST /api/patients/:patientId/schedules`
  - Body:
    ```json
    {
      "type": "medication_dose|dressing_change",
      "label": "Amoxicillin q8h",
      "episodeId": "uuid",
      "conditionId": "uuid",
      "medicationId": "uuid",
      "medicationEmbodimentId": "uuid",
      "doseMg": 400,
      "doseMl": 5,
      "pillCount": null,
      "bodyLocation": null,
      "side": null,
      "dressingType": null,
      "frequencyHours": 8,
      "explicitTimes": ["08:00", "16:00", "00:00"],
      "startAt": "ISO datetime",
      "endAfterOccurrences": 10,
      "endAt": null,
      "notes": ""
    }
    ```
  - Validate required fields per type (medication vs dressing change); exactly one of
    `frequencyHours` / `explicitTimes` is required — without one, `nextDueAt` has nothing to
    compute from. `episodeId` and `conditionId` are mutually exclusive — 400
    `SCHEDULE_EPISODE_CONDITION_CONFLICT` if both are set.
  - `nextDueAt` on creation is the schedule's first due moment: `startAt` itself for
    `frequencyHours` schedules; the next `explicitTimes` slot at-or-after `startAt` for
    fixed-time schedules.
  - Response: `InterventionSchedule` (201) with computed `nextDueAt`.
- `GET /api/patients/:patientId/schedules`
  - Filters: `type`, `status`, `episodeId`.
  - Each item includes computed **`ScheduleAdherence`**: `expectedCount` (how many occurrences
    should have happened by now, derived from `frequencyHours`/`explicitTimes` since `startAt`),
    `loggedCount` (doses actually logged against this schedule, via `intervention.scheduleId`),
    `missed` (`max(0, expectedCount - loggedCount)`), `remainingOccurrences`
    (`endAfterOccurrences - loggedCount`, `null` for open-ended schedules), and `overdue`
    (`nextDueAt` in the past while `status = 'active'`).
- `GET /api/schedules/:scheduleId` — same shape, single schedule.
- `PATCH /api/schedules/:scheduleId`
  - Update status (`active`, `paused`, `completed`), timing, or metadata; recompute `nextDueAt`
    from the schedule's most recent logged dose (or `startAt` if none yet) whenever timing fields
    or `status` change.
- `POST /api/schedules/:scheduleId/log`
  - Creates the corresponding intervention pre-filled from the schedule (medication/embodiment/
    dose amounts, or dressing fields) with `interventionScheduleId` set, **through the same
    `InterventionsService.create()` path as a manually-logged dose** — the dosing engine and
    advisories (atypical checks, stale weight, expired embodiment) run identically either way.
    Body: `{ performedAt?, notes? }` (both optional; `performedAt` defaults to now).
  - Advances `nextDueAt` forward from the logged dose's time using the schedule's interval.
    When `endAfterOccurrences` is reached, or the next `nextDueAt` would fall after `endAt`, the
    schedule's `status` becomes `completed` and `nextDueAt` becomes `null`.
  - The logged dose is recorded with **`doseSource: 'schedule'`**, and is **not** flagged atypical
    for it (data-model.md → "Data integrity rules") — it's executing a plan, not an ad-hoc
    deviation. Magnitude/interval checks against any matching guideline still apply.
    `'override'` would be the wrong label: a dose given exactly as the schedule specifies is the most
    plan-conforming dose there is, and calling it an override misreads it in the ER Brief and muddies
    the atypical-dose signal. The exemption itself is keyed on the dose having a `scheduleId`, not on
    its `doseSource`, so this is a provenance fix and changes no flagging behavior.
  - Existing rows written before this change carry `doseSource: 'override'` and are not rewritten.
    They remain correctly un-flagged, since the exemption never depended on the value.

## Timeline & dashboard
- `GET /api/patients/:patientId/timeline`
  - Query: `from`, `to`, `episodeId?`, `includeObservations=true/false`, `includeInterventions=true/false`, `medicationTag?`, `medicationId?`
  - Merges observations, interventions, **and `protocol_fired` advisories** (§4.10 of the
    requirements doc) — the ER Brief reuses this same merge. `medicationTag` resolves to a set of
    `medicationId`s (via the catalog's `tags`) before filtering interventions server-side.
  - Response:
    ```json
    {
      "patient": { ... },
      "entries": [
        {
          "id": "obs|int|advisory uuid",
          "kind": "observation|intervention|advisory",
          "type": "...",
          "timestamp": "...",
          "recordedBy": { "id": "...", "displayName": "..." },
          "display": { ...the full observation/intervention/advisory object... }
        }
      ],
      "weightPrompt": { "needsUpdate": true, "lastRecordedAt": "...", "daysSince": 75 }
    }
    ```
    `display` is the same object `GET .../observations/:id` / `.../interventions/:id` / the
    advisories list already return — no separate summarization shape to keep in sync (P6: the
    timeline presents raw data, never a derived summary).
  - `recordedBy` is resolved server-side from the recording user (`recordedByUserId` on
    observations/interventions, `createdByUserId` on advisories) so the journal can render the
    attributed feed ("Dana — 240 mg ibuprofen · 2:15 AM", P3) without fanning out to map user ids.
    It resolves even for a user who has since left the care team — attribution outlives membership
    (P3); a row must never degrade to a bare id because its author was removed.
- `GET /api/dashboard`
  - Aggregates **every patient the caller is on the care team for** — not only patients with an
    active episode. Episodes are an optional frame over the timeline (data-model.md → "Episode
    model"); the most common dose of all is the 3 AM one logged with no episode at all, and it must
    still reach the dashboard.
  - Response includes:
    - `lastDoses`: `[ { patientId, patientName, accentColor, doses: [ { medicationId, medicationName, lastDoseAt, nextAllowedAt, isAtypicalLastDose } ] } ]`
      — the most recent dose of each distinct medication **in the last 24 hours**, per patient,
      **episode-agnostic**. This is the direct answer to product.md's founding question ("did I
      already give Tylenol?").
      - **One entry per accessible patient, always — including patients with `doses: []`.** The
        empty array is the answer, not the absence of one; the client renders it as an explicit
        "nothing given in the last 24 hours" rather than omitting the patient. Do not "optimize"
        empty rows away.
      - Doses are most-recent-first. The 24-hour window is a hard cutoff on `performedAt` applied in
        SQL — older doses drop off entirely rather than being returned and filtered client-side.
      - `nextAllowedAt` is the frozen value written into the dose's metadata at log time (see
        "Dosing engine"), not a live recomputation. `null` means "no guideline supplied an
        interval" — that is *no guidance*, not *cannot give*.
    - `whatsNew`: `[ { patientId, patientName, accentColor, since, eventCount, advisoryCount, nowDueCount } ]`
      — the "While You Were Asleep" diff reduced to counts, so the dashboard card renders from the
      one dashboard request instead of fanning out to `GET .../whats-new` per patient. `since` is the
      caller's own watermark for that patient, identical to the WYWA endpoint's field.
      - **One entry per accessible patient, always — including all-zero rows**, same contract as
        `lastDoses` above. frontend.md's "the card shows only when the diff is non-empty" is a
        *client render rule* applied over this array, not a filter the server performs; an
        always-emitted row keeps "diff computed, nothing new" distinguishable from "patient missing
        because something broke".
      - `eventCount` counts observations + interventions since `since`, on **log time**
        (`createdAt`), matching what `GET .../whats-new` puts in `events` — the two select on the
        same column by construction, and that is the invariant to preserve when either changes.
        Advisories are deliberately *not* included — they have their own count, and the timeline
        merge would otherwise double-count `protocol_fired`.
      - `advisoryCount` counts **every advisory type** created since `since`, on `createdAt`, and
        **includes acknowledged ones**. It is therefore *not* the same number as
        `unacknowledgedAdvisories.length` on this same payload.
      - `nowDueCount` is **present-tense**, not watermark-relative — what is due *right now*, for the
        same reason the WYWA endpoint's `nowDue` is (see "While You Were Asleep"). Note this counts
        schedules due at-or-before now, which is one second wider than
        `upcomingSchedules[].overdue`; don't derive one from the other.
      - The card and the WYWA page are computed at two different request times, so an event landing
        between them can legitimately make the card say 3 and the page show 4. That is staleness, not
        a defect — the definitions are shared in code precisely so a genuine mismatch can't happen.
    - `activeEpisodes`: `[ { patientId, patientName, accentColor, episodeId, name, startedAt, lastObservationSummary, medications: [{ medicationId, medicationName, lastDoseAt, nextAllowedAt, isAtypicalLastDose }] } ]`
      — `medications` stays deliberately **episode-scoped**: it answers "what was given inside this
      episode", which the patient-scoped 24h `lastDoses` above deliberately does not.
    - `upcomingSchedules`: `[ { scheduleId, patientId, label, type, episodeId, nextDueAt, overdue: boolean } ]`
    - `shoppingList`: `[ { embodimentId, medicationId, medicationName, label, runningLowFlaggedAt } ]`
      — embodiments across all the caregiver's patients' shared catalog currently flagged
      `runningLow` (F-9.3). One-tap `POST /api/embodiments/:embodimentId/restock` clears the flag.
    - `unacknowledgedAdvisories`: `[ Advisory ]` — advisories with `acknowledgedByUserId: null`.
      M2's producers self-acknowledge at creation, so this is empty until the "seen but backed out"
      case arrives with Conditions/reactions; the field exists now so the dashboard doesn't need a
      later reshape.
    - **`accentColor` on every row that names a patient** — `lastDoses`, `whatsNew` and
      `activeEpisodes` each carry the patient's palette token (data-model.md → Patient). It is
      server-**resolved**, not the raw column: a patient row written before the column existed
      stores `null`, and the same stable token is derived from the id instead, because an identity
      color that changed between page loads would be worse than no color at all given what it
      guards against. This exists so the bimodal Home can color its sick cards, night-board rows
      and strips from the one dashboard request — the alternative is fetching every patient from
      Home, which is exactly the fan-out this endpoint's single-request rule exists to prevent.
      `recentTemperatures` deliberately does *not* carry it: it is keyed by `patientId` and
      consumed inside a card that already has the token.
    - `recentTemperatures`: `[ { patientId, points: [ { timestamp, valueC } ] } ]` — the last 48
      hours of temperature entries, one row **only for patients with at least one active episode**
      (quiet patients render no sparkline, so their rows would be dead weight). Values are
      canonical °C; the client converts to the viewer's preferred unit at read time like every
      other consumer. Exists so the bimodal Home's sick cards (frontend.md → "Information
      architecture (v2)" → Home) render from the one dashboard request instead of fanning out a
      timeline query per sick patient.
- `GET /api/patients/:patientId/recent-medications`
  - The quick-log "recents first, search second" source (frontend.md → "Information architecture
    (v2)" → Quick Log): the union of medications given to this patient **in the last 14 days** and
    medications on this patient's **active schedules**, one entry per distinct medication:
    ```json
    [ { "medicationId": "...", "medicationName": "...", "lastDoseAt": 0, "lastAmountMg": 0,
        "lastAmountMl": 0, "lastEmbodimentId": "...", "lastEmbodimentLabel": "...",
        "nextAllowedAt": 0, "isAtypicalLastDose": false, "onActiveSchedule": false } ]
    ```
  - `last*` fields and `nextAllowedAt` come from this patient's most recent dose of that medication
    (`nextAllowedAt` frozen at log time, same as the dashboard's — `null` means no guideline
    supplied an interval); all of them are `null` for a scheduled medication never yet given.
    Ordered most-recent-dose-first, never-given schedule entries last.
  - **Per-patient by construction, never merged across patients.** Two children on the same
    medication at different weight-based amounts is the normal concurrent-illness case; a prefill
    sourced from a sibling's dose is the exact wrong-chart hazard the v2 IA exists to prevent
    (frontend.md → "Patient identity"). Standard access control: care-team membership or 404
    `PATIENT_NOT_FOUND`.
- `POST /api/embodiments/:embodimentId/restock`
  - One-tap equivalent of `PATCH /api/embodiments/:embodimentId` with `{ runningLow: false }` — the
    dashboard shopping-list action (F-9.3). No body.

## Medications, embodiments & guidelines

The medication catalog is **not patient-scoped** — the first such resource family. Every route still
requires authentication (`JwtAuthGuard`); there is no `ensurePatientAccess` check, since the catalog
and cabinet are shared across the whole household rather than tied to one patient (P4). No admin role
exists yet in phase 1, so any authenticated caregiver may manage the catalog.

**That stays true deliberately, and this paragraph exists so it isn't re-litigated.** A creator-only
mutation rule was considered and rejected: none of `Medication`/`MedicationEmbodiment`/
`MedicationGuideline` carries a `createdByUserId` column, so it would need a schema change for a
single-household app; P4 in product.md is "every caregiver sees and does everything"; and the actual
hazard is not *who* edits the dosing reference but *what a delete orphans*. The three `DELETE`
routes therefore refuse while anything still depends on the row (409, below), which closes the real
gap completely, and `defaultActive: false` already covers "retire this, don't destroy it".

- `GET /api/medications`
  - Query: `q?` (matches against `name`, `brandNames`, and `tags`, case-insensitive — this is how "the
    box says Tylenol, not acetaminophen" search works, F-1.2), `tag?`, `activeOnly?`.
  - Returns medications including `brandNames` and `tags`.
- `POST /api/medications`
  - Body: `{ name, brandNames?, description?, tags?, defaultActive? }`.
  - `name` must be unique across the household, **case-insensitively** — 409
    `MEDICATION_NAME_TAKEN`. Two identical "Acetaminophen" entries are indistinguishable in the
    typeahead and can carry different guidelines, which is a hazard at 3 AM. Uniqueness is checked
    against `name` only; a name that collides with another medication's `brandNames` is allowed.
  - Response: `MedicationDto` (201).
- `GET /api/medications/:medicationId`
- `PATCH /api/medications/:medicationId`
  - Body: any subset of the create fields. Renaming enforces the same 409; renaming a medication to
    the name it already has is a no-op, not a conflict.
- `DELETE /api/medications/:medicationId`
  - 409 `MEDICATION_IN_USE` when anything still references it — its own embodiments or guidelines, an
    adverse reaction, a schedule, or a dose already logged. The response body carries a `dependents`
    object counting what is in the way, so the client can say which. Delete the dependents first, or
    retire the medication with `defaultActive: false` — that is what retirement is for.
  - Deleting downward rather than cascading is deliberate: it produces an accurate dependent list and
    pushes the caller through each child, where the same check applies again.

### Embodiments
- `POST /api/medications/:medicationId/embodiments`
  - Body: `{ label, concentrationMgPerMl?, strengthMgPerUnit?, unitType, notes? }`, plus the same
    **cabinet fields** `PATCH` accepts: `atHome?`, `expiresAt?`, `runningLow?`.
- `GET /api/medications/:medicationId/embodiments`
- `PATCH /api/embodiments/:embodimentId`
  - Body: any subset of the create fields, plus **cabinet fields** (§Cabinet awareness below):
    `atHome?`, `expiresAt?`, `runningLow?`.
- `DELETE /api/embodiments/:embodimentId`
  - 409 `EMBODIMENT_IN_USE` when a guideline, reaction, schedule or logged dose still points at it.
    Same `dependents` body as above.

### Guidelines
- `POST /api/medications/:medicationId/guidelines`
  - Body includes `type` (`weight_based` | `age_band`) and the fields relevant to that type (validated
    server-side per data-model.md's field list). `source` is **required** on every guideline — it is
    the provenance shown alongside the computed dose (N-4, P2); no guideline may be created without one.
    `medicationEmbodimentId` is optional (omit for a guideline that applies across embodiments).
  - Numeric fields are range-checked; a negative `mgPerKg` would feed a negative recommended dose.
  - On an `age_band` guideline, `ageMinMonths` must be ≤ `ageMaxMonths` — 400
    `GUIDELINE_AGE_RANGE_INVALID`. An inverted band can never match any patient, and it fails
    *silently*: guidance simply never appears, with nothing on screen to say why.
- `GET /api/medications/:medicationId/guidelines`
- `GET /api/guidelines/:guidelineId`
- `PATCH /api/guidelines/:guidelineId`
  - The age-range rule is enforced against the **merged** row, not just the submitted fields —
    `PATCH { ageMinMonths: 200 }` against a guideline whose max is 60 is rejected.
- `DELETE /api/guidelines/:guidelineId`
  - 409 `GUIDELINE_IN_USE` when a logged dose or an advisory still references it. Same `dependents`
    body as the other two.

### Cabinet awareness (F-9.1–F-9.4)
Cabinet state lives directly on `MedicationEmbodiment` — see data-model.md. There is deliberately no
inventory-count endpoint (F-9.4): only presence (`atHome`), `expiresAt`, and a one-tap `runningLow`
flag.
- Setting `runningLow: true` on **create or** `PATCH /api/embodiments/:embodimentId` stamps
  `runningLowFlaggedByUserId`/`runningLowFlaggedAt` server-side from the requesting user; setting it
  `false` (e.g. "restocked") clears both. Create and update accept the same three cabinet fields for
  the same reason: a caregiver adding the bottle they are physically holding should be able to record
  everything printed on it in one request.
- Expired-embodiment and running-low surfacing on the dashboard/dose-entry screens is an Advisory
  concern, specced in a later milestone alongside the rest of the Advisory model (§4.11 of the
  requirements doc) — this section only covers the CRUD shape of the flags themselves.

## ER Brief

See `er-brief.md` for the full concept (header/body field mapping, P6 shape rule, snapshot token
security model — also in `security.md`). API surface:

- `GET /api/patients/:patientId/er-brief` — query `episodeId?` (defaults to the most recently
  started active episode). Aggregates patient/code-status/reactions/conditions/protocol-fired
  header with a chronological episode-event/schedule/prior-episode/atypical-dose body.
  - When no `episodeId` is supplied **and** the patient has no active episode, the body falls back to
    a trailing **72-hour window** rather than coming back empty. `body.eventScope` is the
    discriminator saying which happened. See er-brief.md → "Scope" for the full rule and the
    reasoning.
- `POST /api/patients/:patientId/er-brief/snapshots` — body `{ episodeId?, expiresInHours? }`
  (default 72, capped 168 — a request above the cap is rejected 400, not silently clamped).
  Freezes the brief and returns `{ id, token, url, expiresAt }`. `id` is returned so the client can
  revoke the link it just created without re-listing; it is the same `id` the snapshots list returns.
  `url` is derived server-side — see er-brief.md → "Frozen snapshot" and security.md.
- `GET /api/patients/:patientId/er-brief/snapshots` — lists this patient's live snapshots
  (`{ id, episodeId, createdByUserId, createdAt, expiresAt }[]`, newest first) so a caregiver can
  find one to revoke. **Never includes the token** — a snapshot's link is handed out once, at
  creation, and isn't re-surfaced later (same one-time-reveal spirit as an API key).
- `GET /api/er-brief/shared/:token` — **unauthenticated**. Returns `{ payload, frozenAt, expiresAt }`
  or 404 `SNAPSHOT_NOT_FOUND` (missing and expired are indistinguishable).
- `GET /api/er-brief/shared/:token/files/:fileId` — **unauthenticated**; streams a care-document
  file frozen into the snapshot. Valid only for ids recorded in the snapshot's `fileIds` at
  creation (data-model.md → `ErBriefSnapshot`). Every failure — unknown token, expired token, a
  `fileId` not frozen into this snapshot — answers the identical 404 `SNAPSHOT_NOT_FOUND`, one
  code for the whole route, so a valid-token holder cannot probe for other files. Served with the
  same hardened CSP as `GET /api/files/:id`. See er-brief.md → "Formats" and security.md.
- `DELETE /api/er-brief/snapshots/:id` — authenticated, patient-scoped; revokes by deleting.

## While You Were Asleep

The 6 AM shift-change briefing (§5.6, F-6.1): what changed since this caregiver's own last look.

- `GET /api/patients/:patientId/whats-new`
  - Diff since the requester's `CareTeamMembership.lastSeenAt` watermark (data-model.md), or the
    last 24 hours when never acknowledged.
  - Response:
    ```json
    {
      "since": 1234567890,
      "events": [ "...TimelineEntry, same shape as GET .../timeline" ],
      "advisoriesFired": [ "...Advisory" ],
      "nowDue": [ "...DashboardUpcomingSchedule, filtered to overdue-or-due-now" ]
    }
    ```
    `events` and `advisoriesFired` are since `since`; `nowDue` is a present-tense fact (what's due
    *right now*, regardless of the watermark) — a schedule due at 5:58 AM shouldn't disappear from
    the briefing just because the watermark happens to land at 6:00.
  - **`events` is selected on log time (`createdAt`), not on clinical time.** The question this
    endpoint answers is "what happened that I haven't seen", and a 2 AM event written up at 6 AM is
    unseen no matter what its clinical timestamp says. Selecting on `observedAt`/`performedAt` made
    exactly that entry invisible to the caregiver who last looked at 5 AM — the handoff the feature
    exists to cover. `advisoriesFired` has always keyed on `createdAt`; this makes all of them agree.
  - **Selection and display are now different axes, and both matter.** Each entry still *shows* its
    clinical time, and the list is still *ordered* by clinical time — so a 6 AM briefing can
    legitimately contain an entry stamped 2 AM, sitting in 2 AM's position. That is the correct
    reading: it tells the caregiver both that it is new to them and when it actually happened.
  - Reading this endpoint **never** advances the watermark — see `POST .../whats-new/ack` below.
- `POST /api/patients/:patientId/whats-new/ack`
  - No body. Sets `lastSeenAt` to now for the requester's membership. Response: `{ ackedAt }`.
  - The explicit-ack step exists so a caregiver who glances at the dashboard card without reading
    it doesn't silently consume the briefing before they've actually seen it.

## Corrections

Entries can be corrected after the fact; corrections are attributed, and the original remains part
of the record (F-1.4, data-model.md → `Revision`).

- Every mutating `PATCH` on a correctable entity (`observations`, `interventions`, `conditions`,
  `patients`) captures the entity's pre-update state as a `Revision` before applying the change —
  this is a side effect of the existing `PATCH` endpoints, not a separate write step the client
  calls.
- `GET /api/observations/:id/revisions`
- `GET /api/interventions/:id/revisions`
- `GET /api/conditions/:id/revisions`
- `GET /api/patients/:id/revisions`
  - All four return `Revision[]`, newest first, patient-scoped access control identical to the
    entity's own `GET`. `PATCH /api/patients/:id/code-status` does **not** capture a revision —
    that field already carries its own dedicated attribution (`codeStatusSetByUserId`/
    `codeStatusSetAt`), a lighter-weight trail purpose-built for exactly this one field.

## Files

Backs `photo` and `document` observation entries (§5.8, F-8.1), and the lab-import PDF. Nothing on
this surface is image-specific: any content type is accepted, stored, and streamed back verbatim.

`StorageService` is a facade over the configured `FileStorageDriver` — `local` or `s3` — and the
routes below are identical on both. That was the design goal and it held: adding the S3 driver
changed no route, no DTO, and no shared type (persistence.md → "File storage").

**Bytes always proxy through the API, on both drivers.** There is a `getSignedUrl()` seam on the S3
driver, deliberately unused: the web client fetches attachments as blobs with an `Authorization`
header precisely because `<img src>` cannot carry one, and `GET /api/files/:id` is where the
hardened CSP that neutralizes a malicious upload is applied (deployment.md → "Security headers").
Redirecting to a presigned URL would move bytes off the API but drop both properties, so it is a
deliberate later decision rather than a config toggle.

- `POST /api/files`
  - Multipart upload (`file` field) plus a `patientId` form field — the web client always knows
    the selected patient before a photo is attached, so there is no genuinely patient-less upload
    path today (data-model.md → `FileAsset`). `ensurePatientAccess(patientId, userId)` gates the
    upload the same as every other patient-scoped write.
  - The client-supplied filename is persisted as `originalName` (sanitized, ≤ 255 chars) for
    display in the file picker and document labels; the storage path stays a server-generated UUID.
  - Response: `{ fileId, url }` (201). `url` is `/api/files/:fileId` — same-origin, authenticated.
- `GET /api/files/:id`
  - Streams the file with its stored `contentType`. Access control: `ensurePatientAccess` against
    the file's `patientId` when set; for the (currently theoretical) patientless case, only the
    uploader may read it.
  - Accepted for `photo` and `document` observation entries (`metadata.fileId`).
- `GET /api/patients/:patientId/files`
  - Lists the patient's uploaded files, newest first, for the "attach an existing document" picker
    (frontend.md → "Entry types"): `{ id, originalName, contentType, sizeBytes, createdAt }[]`.
    Timestamps in epoch seconds per Conventions. `ensurePatientAccess` → 404 `PATIENT_NOT_FOUND`
    for non-members.
- **Write side**: a `photo` or `document` entry's `metadata.fileId` is checked at observation
  create/update time — the file must exist and its `patientId` must match the observation's patient
  (or, for a patientless upload, the acting user must be the uploader). 400 `PHOTO_FILE_NOT_FOUND`
  (photo) / `DOCUMENT_FILE_NOT_FOUND` (document) otherwise. Read-side access control is unchanged;
  this stops a broken reference from being *stored* rather than discovering it when the ER Brief
  tries to render the image.

## Care documents

Living will, advance directive, medical power of attorney (§4.1; data-model.md →
`CareDocumentStatement`). Patient-level standing state, not timeline events — a directive uploaded
as a `document` observation entry would scroll away into history, which is why this surface exists
separately. The files themselves ride the Files surface above (`POST /api/files` to upload,
`GET /api/files/:id` to read); this surface records what the current statement *is*, per kind, as
a tri-state: never recorded, affirmatively "none", or on file.

- `GET /api/patients/:patientId/care-documents`
  - Response: `{ "livingWill": ..., "advanceDirective": ..., "medicalPoa": ... }` — all three keys
    always present, each `null` (never recorded) or the current statement:
    `{ kind, status: 'on_file' | 'none', fileId, originalName, contentType, holderName,
    holderPhone, setByUserId, setByName, setAt }`. `fileId`/`originalName`/`contentType` are
    `null` unless `'on_file'`; `holderName`/`holderPhone` are `null` except on `medical_poa`.
    `null` vs `status: 'none'` is the tri-state and is the point — see data-model.md.
- `PUT /api/patients/:patientId/care-documents/:kind` — `kind` ∈
  `living_will | advance_directive | medical_poa` (an unknown kind is a standard validation 400).
  - Body: `{ status: 'on_file', fileId, holderName?, holderPhone? }` or `{ status: 'none' }`.
  - Appends a new current statement — never updates in place — and stamps `setByUserId`/`setAt`
    from the requester server-side, the same deliberate-act shape as `PATCH .../code-status`.
    `holderName`/`holderPhone` are accepted only when `kind` is `medical_poa`; `fileId` is
    required with `'on_file'` and forbidden with `'none'` — violations are standard validation
    400s (array form). The `fileId` must exist and belong to this patient: 400
    `CARE_DOCUMENT_FILE_NOT_FOUND` otherwise (same write-side guard as `PHOTO_FILE_NOT_FOUND`).
  - Response: the same full three-key map `GET` returns, so the card re-renders from the response.
- `GET /api/patients/:patientId/care-documents/:kind/history` — every statement ever recorded for
  the kind, newest first (the append-only trail; reconstructability, N-2). Same statement shape as
  above.

## Lab imports

Turns a lab's own report file into observation entries (data-model.md → "Lab report import";
frontend.md → "Lab import"). Quest Diagnostics PDFs are the first supported format; parsing is
format-pluggable behind a normalized `ParsedLabReport` shape, so adding a format is a new parser,
not a new API.

- `POST /api/patients/:patientId/lab-imports`
  - Body: `{ "fileId": "uuid", "format": "quest" }` — `format` optional; when omitted the server
    sniffs the extracted text against each registered parser (`quest` matches on a
    "Quest Diagnostics" marker).
  - **Stateless parse, persists nothing** (same compute-only POST shape as dose-checks) — including
    the catalog: resolution *reads* the analyte catalog, it never creates rows. The client reviews
    the result and then creates a normal observation (`lab_result` entries + a `document` entry for
    the source PDF) via `POST /api/patients/:patientId/observations` — the observation create path
    stays the single write path for measurements.
  - The uploaded PDF is retained in storage whether or not parsing succeeds — a failed import
    leaves the file available for troubleshooting and retry.
  - Response (201):
    ```json
    {
      "fileId": "…",
      "parsed": {
        "format": "quest",
        "labName": "Quest Diagnostics",
        "specimenId": "AB123456C",
        "collectedAt": "2026-07-20T09:10:00.000Z",
        "reportedAt": "2026-07-21T18:35:00.000Z",
        "orderingProvider": "SMITH,ALEX",
        "patientName": "DOE,JANE",
        "analytes": [
          { "analyte": "FERRITIN", "valueText": "37", "value": 37, "unit": "ng/mL",
            "flag": "L", "refLow": 38, "refHigh": 380, "refText": null, "panel": "FERRITIN" }
        ],
        "warnings": ["<verbatim lines the parser could not classify>"]
      },
      "resolutions": [
        { "analyte": "FERRITIN", "analyteId": "…", "displayName": "Ferritin",
          "status": "conflict",
          "catalogRange": { "id": "…", "label": "Reference", "low": 30, "high": 400,
                            "refText": null, "effectiveFrom": 1750000000 },
          "ranges": [ { "id": "…", "kind": "custom", "label": "Athletic goal", "low": 120,
                        "high": null, "refText": null, "effectiveFrom": 1750000000 } ] }
      ]
    }
    ```
    `patientName` is for the preview's "check this matches" cross-check only — it is never
    persisted. Partial parses are successes: unclassifiable lines land in `warnings` (deduped,
    capped) so the preview can show them; zero parsed analytes is still a 201.
  - `resolutions` is **index-aligned with `parsed.analytes`**. Each entry compares the report's
    printed range against **this patient's** `reference`-kind range in effect at `collectedAt`
    (falling back to `reportedAt`, then now, when the report prints no collection time). `status`
    is one of:
    | status | meaning | what confirm does |
    | --- | --- | --- |
    | `new` | name not in the catalog (case-insensitive) | auto-creates the analyte, and its printed range as this patient's first `reference` row |
    | `match` | printed range equals the patient's effective `reference` range | nothing |
    | `conflict` | printed range differs from the patient's effective `reference` range | **asks** — adds a new effective-dated `reference` row only if the caregiver accepts |
    | `new_range` | analyte exists but this patient has no `reference` range effective at `collectedAt`, and the report prints one | adds it (nothing is being overwritten) |
    | `no_printed_range` | the report prints no range for this row | nothing |
    Equality is numeric on `low`/`high` and trimmed-string on `refText`, with `null` equal to
    `null`. `analyteId` is `null` exactly when `status` is `new`. `ranges` carries this patient's
    other effective ranges for the analyte (`custom` lineages — targets, interpretation bands), for
    preview display only.
  - Errors: 404 `PATIENT_NOT_FOUND` (non-member); 400 `LAB_FILE_NOT_FOUND` (unknown fileId, or a
    file that doesn't belong to this patient — same non-disclosure semantics as
    `PHOTO_FILE_NOT_FOUND`); 400 `LAB_PDF_UNPARSEABLE` (not a PDF, unreadable, or image-only with
    no extractable text — one code, the user's remedy is identical); 400 `LAB_FORMAT_UNSUPPORTED`
    (readable PDF, but no registered parser recognizes it and no valid `format` was forced).

## Analytes

The lab-analyte catalog (data-model.md → "Analyte catalog"). The **analyte** is global like the
medication catalog, populated by ingestion rather than a seed; its **ranges are per-patient**, since
what a value should be depends on who was measured.

- `POST /api/analytes` — `{ name, displayName?, unit?, panel? }`. `displayName` defaults to Title
  Case of `name`. 409 `ANALYTE_NAME_TAKEN` on a case-insensitive collision with an existing `name`.
- `GET /api/analytes?q=` — case-insensitive substring over `name`, `displayName` **and `panel`**
  (searching "iron" finds `% Saturation`, whose own name never mentions it).
- `GET /api/analytes/:id` — 404 `ANALYTE_NOT_FOUND`.
- `PATCH /api/analytes/:id` — `{ name?, displayName?, unit?, panel? }`; a rename re-checks
  availability (renaming to its own current name is a no-op, not a conflict).
- `DELETE /api/analytes/:id` — 409 `ANALYTE_IN_USE` with `{ dependents: { labResults: n } }` when
  any `lab_result` entry references it. Otherwise deletes the analyte together with every patient's
  ranges for it (data-model.md explains the divergence from the medication catalog).
- `POST /api/analytes/resolve` — `{ analytes: [{ name, unit?, panel? }] }` (≤ 200 entries) →
  `[{ name, analyteId, displayName, created }]` **in input order**. Case-insensitive match on
  `name`; missing analytes are created with a title-cased `displayName` and the submitted
  `unit`/`panel`. Idempotent: calling it twice returns the same ids with `created: false` the
  second time, and the second call's `unit`/`panel` are **ignored** — an import never rewrites
  what the catalog already says. This is how a client turns printed names into `analyteId`s before
  writing `lab_result` entries.

### Analyte ranges

Every named band a value is read against — the lab's `"Reference"`, an interpretation segment
(`"Optimal"`), a personal target (`"Athletic goal"`) — is one `AnalyteRange` row belonging to one
patient. Rows sharing (patient, analyte, `kind`, case-insensitive `label`) form an effective-dated
**lineage**; the row in effect at time *t* is the greatest `effectiveFrom ≤ t` within that lineage.

- `POST /api/patients/:patientId/analytes/:analyteId/ranges` —
  `{ label, kind?, low?, high?, refText?, effectiveFrom, source? }`. `kind` defaults to `custom`;
  `reference` marks the lineage the importer maintains. `label` is required; at least one of
  `low`/`high`/`refText` is required (400 `ANALYTE_RANGE_EMPTY`) — **one-sided ranges are normal**
  (`{ label: "Athletic goal", low: 120 }`). `effectiveFrom` is an ISO datetime. **Retry-safe**: if
  the row already effective in that lineage at that `effectiveFrom` carries identical values, the
  existing row is returned and nothing is inserted.
- `GET /api/patients/:patientId/analytes/:analyteId/ranges` — all lineages, newest `effectiveFrom`
  first.
- `PATCH /api/analyte-ranges/:id`, `DELETE /api/analyte-ranges/:id` — 404
  `ANALYTE_RANGE_NOT_FOUND`. Membership is checked against the row's own `patientId`; a non-member
  gets the same 404, which is also what a caller with a bad id gets.
- `GET /api/patients/:patientId/analytes/:analyteId/history` — everything the history view needs in
  one request: `{ analyte, ranges: AnalyteRange[] (ascending by effectiveFrom), points: [{ observationId, observedAt, valueText, value, unit, flag }] (ascending) }`.
  Points come from this patient's `lab_result` entries naming the analyte.
- All range and history routes are patient-scoped and answer 404 `PATIENT_NOT_FOUND` to a
  non-member; the analyte routes themselves are household-global and need only authentication.

## Validation & errors
- Error codes are returned as the message string so clients can branch on them.
- Non-membership on a patient-scoped route is always 404 `PATIENT_NOT_FOUND` (see "Resource shape and
  access control"), never 403.
- Use DTO validation pipes.

### Error response shapes
There is **no global exception filter** in this API — every error body below is a NestJS default.
Adding a filter later is a breaking change for clients parsing these shapes.

- **An explicit `throw new XException('SOME_CODE')`** gives `message` as a **string** holding the
  code: `{ "message": "PATIENT_NOT_FOUND", "error": "Not Found", "statusCode": 404 }`.
- **A `class-validator` DTO failure** gives `message` as an **array** of strings, one per failed
  constraint. A nested-object validator (e.g. `EntryMetadataConstraint` on an observation entry's
  `metadata`) arrives **path-prefixed with the parent property path, and the property name itself
  dropped** — a bad entry at index 0 produces `"entries.0.OBSERVATION_SCHEMA_INVALID"`, not
  `"entries.0.metadata: OBSERVATION_SCHEMA_INVALID"`. Plain field failures (e.g. a malformed
  `observedAt`) arrive as ordinary class-validator English (`"observedAt must be a valid ISO 8601
  date string"`) — there is no code for those, only the array position tells you which body shape
  you got:
  ```json
  {
    "message": ["entries.0.OBSERVATION_SCHEMA_INVALID", "observedAt must be a valid ISO 8601 date string"],
    "error": "Bad Request",
    "statusCode": 400
  }
  ```
- **Three surfaces answer with framework prose and no code at all** — clients must not try to
  code-match these, only recognize the shape and show something generic:
  - The JWT guard's own 401, with no `error` key: `{ "message": "Unauthorized", "statusCode": 401 }`.
  - `ParseUUIDPipe` on a malformed path id (400): `{ "message": "Validation failed (uuid v4 is
    expected)", "error": "Bad Request", "statusCode": 400 }`.
  - Multer's upload size limit (413): `{ "message": "File too large", "error": "Payload Too Large",
    "statusCode": 413 }`.
- **An explicit throw may carry extra keys alongside the string `message`.** Nest spreads an object
  argument into the response body, so a code can ship structured detail without changing how
  `message` is read. The three catalog `IN_USE` conflicts use this to say what is in the way:
  ```json
  {
    "message": "MEDICATION_IN_USE",
    "dependents": { "embodiments": 2, "guidelines": 2, "interventions": 14 },
    "error": "Conflict",
    "statusCode": 409
  }
  ```
  Only non-zero counts appear. A client that ignores `dependents` still gets a working string code.

### Error codes
49 codes are thrown today (50 documented — `CARE_DOCUMENT_FILE_NOT_FOUND` is spec'd ahead of its
implementation), all `SCREAMING_SNAKE_CASE`. A new code must follow that casing and be
added to this table in the same change that introduces it — a code without an entry here is
undocumented, and (per frontend.md → "Errors & failure messages") a code without a matching web-side
sentence silently falls back to that call site's generic message rather than reaching the user.

| Code | Status | Where |
| --- | --- | --- |
| `PATIENT_NOT_FOUND` | 404 | any patient-scoped route, non-member or unknown id |
| `USER_NOT_FOUND` | 400 / 404 / 401 | 400 adding a caregiver with a `userId` that no longer resolves (stale search result); 404 transferring patient ownership to an unknown user; 401 `GET /users/me` when the account no longer exists |
| `EPISODE_NOT_FOUND` | 404 | episode routes, and episode ids referenced from observations/interventions |
| `OBSERVATION_NOT_FOUND` | 404 | observation get/update |
| `INTERVENTION_NOT_FOUND` | 404 | intervention get/update |
| `CONDITION_NOT_FOUND` | 404 | condition get/update |
| `PROTOCOL_NOT_FOUND` | 404 | protocol get/update |
| `SCHEDULE_NOT_FOUND` | 404 | intervention schedule get/update |
| `MEDICATION_NOT_FOUND` | 404 | medication lookup by id |
| `EMBODIMENT_NOT_FOUND` | 404 | medication embodiment lookup by id |
| `GUIDELINE_NOT_FOUND` | 404 | dosing guideline lookup by id |
| `ADVISORY_NOT_FOUND` | 404 | advisory acknowledge/lookup |
| `FILE_NOT_FOUND` | 404 | file stream/lookup — missing or expired alike, no distinction |
| `SNAPSHOT_NOT_FOUND` | 404 | ER Brief snapshot lookup — missing and expired alike, no distinction |
| `EMAIL_TAKEN` | 409 | registration with an email already in use |
| `INVALID_CREDENTIALS` | 401 | login with a wrong email/password pair |
| `PASSWORD_AUTH_DISABLED` | 403 | `POST /api/auth/register`\|`login` once OIDC is the active login path |
| `OIDC_HANDOFF_NOT_FOUND` | 404 | `POST /api/auth/oidc/exchange` with an unknown, expired, or already-used handoff code |
| `SELF_RELATIONSHIP_ALREADY_EXISTS` | 400 | care team: adding a second "self" relationship |
| `CANNOT_REMOVE_OWNER` | 400 | care team: removing the patient's owner |
| `AT_LEAST_ONE_ENTRY_REQUIRED` | 400 | observation create with an empty `entries` array (interventions have no `entries` field) |
| `RESOLVES_MUST_BE_SUBSET_OF_EPISODES` | 400 | `resolvesEpisodeIds` not a subset of `episodeIds` |
| `OBSERVATION_SCHEMA_INVALID` | 400 (array form) | an observation entry's `metadata` fails its type-specific schema — see "Error response shapes" above for how this arrives |
| `INVALID_REACTION_SCOPE` | 400 | an `AdverseReaction` create whose scope target doesn't match exactly one of `medicationId`/`embodimentId`/`tag` per its `scopeType` |
| `SCHEDULE_EPISODE_CONDITION_CONFLICT` | 400 | an `InterventionSchedule` create/update with both `episodeId` and `conditionId` set |
| `MEDICATION_ID_REQUIRED` | 400 | intervention or schedule create/update of type `medication_dose` missing `medicationId` |
| `BODY_LOCATION_REQUIRED` | 400 | intervention or schedule create/update of type `dressing_change` missing `bodyLocation` |
| `FREQUENCY_OR_EXPLICIT_TIMES_REQUIRED` | 400 | schedule create with neither a frequency nor explicit times |
| `FILE_REQUIRED` | 400 | `POST /api/files` with no file part |
| `PATIENT_ID_REQUIRED` | 400 | `POST /api/files` with no `patientId` field |
| `NOT_PATIENT_OWNER` | 403 | `DELETE /api/patients/:patientId` by a care team member who is not `ownedById` |
| `DATE_IN_FUTURE` | 400 (array form) | a past-event datetime (`dateOfBirth`, `observedAt`, `performedAt`, `occurredAt`) later than the server's clock |
| `PHOTO_FILE_NOT_FOUND` | 400 (array form) | a `photo` entry's `metadata.fileId` naming a file that does not exist or does not belong to this patient — one code for both, deliberately |
| `EPISODE_ALREADY_RESOLVED` | 400 | a second, different event attempting to resolve an already-resolved episode |
| `GUIDELINE_AGE_RANGE_INVALID` | 400 | an `age_band` guideline whose merged `ageMinMonths` exceeds its `ageMaxMonths` |
| `MEDICATION_NAME_TAKEN` | 409 | medication create/rename colliding case-insensitively with an existing `name` |
| `MEDICATION_IN_USE` | 409 | `DELETE /api/medications/:id` with dependent rows; body carries `dependents` |
| `EMBODIMENT_IN_USE` | 409 | `DELETE /api/embodiments/:id` with dependent rows; body carries `dependents` |
| `GUIDELINE_IN_USE` | 409 | `DELETE /api/guidelines/:id` with dependent rows; body carries `dependents` |
| `REACTION_NOT_FOUND` | 404 | reaction delete — unknown id, or one belonging to another patient |
| `DOCUMENT_FILE_NOT_FOUND` | 400 (array form) | a `document` entry's `metadata.fileId` naming a file that does not exist or does not belong to this patient — same semantics as `PHOTO_FILE_NOT_FOUND` |
| `LAB_FILE_NOT_FOUND` | 400 | `POST .../lab-imports` with a `fileId` naming a file that does not exist or does not belong to this patient — one code for both, deliberately |
| `LAB_PDF_UNPARSEABLE` | 400 | `POST .../lab-imports` on a file that is not a PDF, cannot be read as one, or contains no extractable text (image-only scan) |
| `LAB_FORMAT_UNSUPPORTED` | 400 | `POST .../lab-imports` on a readable PDF no registered parser recognizes |
| `ANALYTE_NAME_TAKEN` | 409 | analyte create/rename colliding case-insensitively with an existing `name` |
| `ANALYTE_NOT_FOUND` | 404, or 400 (array form) | unknown analyte id on an analyte route; 400 from an observation write whose `lab_result` entry names an analyte that does not exist |
| `ANALYTE_IN_USE` | 409 | `DELETE /api/analytes/:id` with `lab_result` entries referencing it; body carries `dependents` |
| `ANALYTE_RANGE_NOT_FOUND` | 404 | analyte-range patch/delete — unknown id, or a row belonging to a patient the caller is not on the care team for |
| `ANALYTE_RANGE_EMPTY` | 400 | an analyte range with none of `low`, `high`, `refText` |
| `CARE_DOCUMENT_FILE_NOT_FOUND` | 400 | `PUT .../care-documents/:kind` with `status: 'on_file'` and a `fileId` naming a file that does not exist or does not belong to this patient — same semantics as `PHOTO_FILE_NOT_FOUND` |

### Dosing warnings are not error codes
`atypical_dose` is an advisory `type`, not an error — see "Dosing engine" above. A dose that exceeds
guidance is still saved (`isAtypical=true`); the advisory's `payload.reasons` is an array of zero or
more of `'override' | 'exceeds_max_per_dose' | 'exceeds_max_per_day' | 'interval_too_short'` (plural,
since more than one can apply at once), alongside `amountMg` and `dailyTotalMg`. Front-end is
expected to surface these as warnings before the caregiver finalizes the save; the API never blocks
on them.

`'override'` is the one that isn't a magnitude problem: it records that the caregiver's amount
followed neither computed guideline (data-model.md → "Data integrity rules"), which is a legitimate
decision worth a permanent trace, not a mistake. It is suppressed when the dose carries a
`scheduleId` — a scheduled dose is executing a plan.

## Real-time considerations
- No WebSocket in MVP. Front-end polls `/timeline` or `/dashboard`.

## Security
- JWT auth header `Authorization: Bearer <token>`.
- All routes revalidate that user is member of patient care team.

## Future (phase 2) placeholders
- `GET /api/patients/:patientId/doctors`, `POST /appointments`, etc. (not implemented yet).
