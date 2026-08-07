# API Spec

Base stack: NestJS REST API. All routes require authenticated user (email/password session). Responses use JSON. Validation errors return HTTP 400 with machine-readable codes.

## Auth
- `POST /api/auth/login`
  - Body: `{ email, password }`
  - Response: `{ token, user: UserDto }`
- `POST /api/auth/register`
  - Body: `{ email, password, displayName, preferredTempUnit?, preferredLengthUnit?, preferredWeightUnit? }` where `preferredWeightUnit` ∈ `['kg','lb','st']`.
  - Response: `{ token, user }`
- `GET /api/auth/me`
  - Returns current user profile.

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

## Patients
- `POST /api/patients`
  - Body: `{ fullName, dateOfBirth, sexAtBirth, notes?, myRole? }` where `sexAtBirth` ∈ `['female','male']`
    and `myRole` ∈ `['self','parent','co-parent','nanny','grandparent','babysitter','other']`.
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
  - Body: `{ fullName?, dateOfBirth?, sexAtBirth?, notes?, ownedById? }`.
  - `ownedById` transfers ownership. The target must be an existing user (404 `USER_NOT_FOUND` otherwise)
    and is added to the care team with role `parent` if not already a member.
- `DELETE /api/patients/:patientId`
  - Deletes the patient and all of its care team memberships.

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
    - At least one entry required; each entry `type` must match schema (data model).
    - `resolvesEpisodeIds` must be subset of `episodeIds`.
    - If any entry type = `photo`, `metadata.fileId` required.
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
      "doseSource": "weight_based|age_based|override",
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
  - The API runs the same dosing engine used by `POST .../dose-checks` (see "Dosing engine" below)
    and computes, **overriding whatever the client sent** for `weight_based`/`age_based` sources
    (client-sent `guidelineId`/`weightKgUsed`/`ageMonthsUsed` are honored only under
    `doseSource: 'override'`, where there is no guideline to resolve):
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
    - `resolvesEpisodeIds` must be subset of `episodeIds`.
    - `interventionScheduleId` is stored only (no schedule state updates); also persisted as `scheduleId` column for querying.
    - `guidelineId` optional; omit if not provided.
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
          "computedMg": 217.5, "maxMgPerDose": 1000, "maxMgPerDay": 4000,
          "minIntervalHours": 4, "weightKgUsed": 14.5, "weightRecordedAt": 1234567890
        },
        "ageBand": {
          "guidelineId": "uuid", "source": "...", "doseMg": 160, "doseMl": 5,
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
  - **Reaction matching**: every `AdverseReaction` on the patient is checked against the request's
    `medicationId`/`medicationEmbodimentId` (and the medication's own `tags`, for `tag`-scoped
    reactions) — exact match only, per the reaction's own `scopeType` (data-model.md → "Data
    integrity rules"). Each match becomes one `reaction_warning`/`reaction_danger` advisory
    candidate. Runs identically in preview and the save path, since it's driven off the same
    `medicationId`/`embodimentId` inputs either way.

## Adverse reactions

Patient-scoped (data-model.md → `AdverseReaction`).

- `POST /api/patients/:patientId/reactions`
  - Body: `{ description, occurredAt, severity, scopeType, medicationId?, embodimentId?, tag? }`
    where `severity` ∈ `['warning','danger']` and `scopeType` ∈ `['embodiment','medication','tag']`.
    Exactly one of `medicationId`/`embodimentId`/`tag` must be present, matching `scopeType` — any
    other combination is 400 `INVALID_REACTION_SCOPE`.
  - Response: `AdverseReaction` (201).
- `GET /api/patients/:patientId/reactions`
  - Lists a patient's reactions, newest first.

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
  - A dose logged from a schedule is **not** flagged atypical merely for having
    `doseSource: 'override'` (data-model.md → "Data integrity rules") — it's executing a plan, not
    an ad-hoc deviation. Magnitude/interval checks against any matching guideline still apply.

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
          "display": { ...the full observation/intervention/advisory object... }
        }
      ],
      "weightPrompt": { "needsUpdate": true, "lastRecordedAt": "...", "daysSince": 75 }
    }
    ```
    `display` is the same object `GET .../observations/:id` / `.../interventions/:id` / the
    advisories list already return — no separate summarization shape to keep in sync (P6: the
    timeline presents raw data, never a derived summary).
- `GET /api/dashboard`
  - Aggregates **every patient the caller is on the care team for** — not only patients with an
    active episode. Episodes are an optional frame over the timeline (data-model.md → "Episode
    model"); the most common dose of all is the 3 AM one logged with no episode at all, and it must
    still reach the dashboard.
  - Response includes:
    - `lastDoses`: `[ { patientId, patientName, doses: [ { medicationId, medicationName, lastDoseAt, nextAllowedAt, isAtypicalLastDose } ] } ]`
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
    - `activeEpisodes`: `[ { patientId, patientName, episodeId, name, startedAt, lastObservationSummary, medications: [{ medicationId, medicationName, lastDoseAt, nextAllowedAt, isAtypicalLastDose }] } ]`
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
- `POST /api/embodiments/:embodimentId/restock`
  - One-tap equivalent of `PATCH /api/embodiments/:embodimentId` with `{ runningLow: false }` — the
    dashboard shopping-list action (F-9.3). No body.

## Medications, embodiments & guidelines

The medication catalog is **not patient-scoped** — the first such resource family. Every route still
requires authentication (`JwtAuthGuard`); there is no `ensurePatientAccess` check, since the catalog
and cabinet are shared across the whole household rather than tied to one patient (P4). No admin role
exists yet in phase 1, so any authenticated caregiver may manage the catalog.

- `GET /api/medications`
  - Query: `q?` (matches against `name`, `brandNames`, and `tags`, case-insensitive — this is how "the
    box says Tylenol, not acetaminophen" search works, F-1.2), `tag?`, `activeOnly?`.
  - Returns medications including `brandNames` and `tags`.
- `POST /api/medications`
  - Body: `{ name, brandNames?, description?, tags?, defaultActive? }`.
  - Response: `MedicationDto` (201).
- `GET /api/medications/:medicationId`
- `PATCH /api/medications/:medicationId`
  - Body: any subset of the create fields.
- `DELETE /api/medications/:medicationId`

### Embodiments
- `POST /api/medications/:medicationId/embodiments`
  - Body: `{ label, concentrationMgPerMl?, strengthMgPerUnit?, unitType, notes? }`.
- `GET /api/medications/:medicationId/embodiments`
- `PATCH /api/embodiments/:embodimentId`
  - Body: any subset of the create fields, plus **cabinet fields** (§Cabinet awareness below):
    `atHome?`, `expiresAt?`, `runningLow?`.
- `DELETE /api/embodiments/:embodimentId`

### Guidelines
- `POST /api/medications/:medicationId/guidelines`
  - Body includes `type` (`weight_based` | `age_band`) and the fields relevant to that type (validated
    server-side per data-model.md's field list). `source` is **required** on every guideline — it is
    the provenance shown alongside the computed dose (N-4, P2); no guideline may be created without one.
    `medicationEmbodimentId` is optional (omit for a guideline that applies across embodiments).
- `GET /api/medications/:medicationId/guidelines`
- `GET /api/guidelines/:guidelineId`
- `PATCH /api/guidelines/:guidelineId`
- `DELETE /api/guidelines/:guidelineId`

### Cabinet awareness (F-9.1–F-9.4)
Cabinet state lives directly on `MedicationEmbodiment` — see data-model.md. There is deliberately no
inventory-count endpoint (F-9.4): only presence (`atHome`), `expiresAt`, and a one-tap `runningLow`
flag.
- Setting `runningLow: true` via `PATCH /api/embodiments/:embodimentId` stamps
  `runningLowFlaggedByUserId`/`runningLowFlaggedAt` server-side from the requesting user; setting it
  `false` (e.g. "restocked") clears both.
- Expired-embodiment and running-low surfacing on the dashboard/dose-entry screens is an Advisory
  concern, specced in a later milestone alongside the rest of the Advisory model (§4.11 of the
  requirements doc) — this section only covers the CRUD shape of the flags themselves.

## ER Brief

See `er-brief.md` for the full concept (header/body field mapping, P6 shape rule, snapshot token
security model — also in `security.md`). API surface:

- `GET /api/patients/:patientId/er-brief` — query `episodeId?` (defaults to the most recently
  started active episode). Aggregates patient/code-status/reactions/conditions/protocol-fired
  header with a chronological episode-event/schedule/prior-episode/atypical-dose body.
- `POST /api/patients/:patientId/er-brief/snapshots` — body `{ episodeId?, expiresInHours? }`
  (default 72, capped 168 — a request above the cap is rejected 400, not silently clamped).
  Freezes the brief and returns `{ token, url, expiresAt }`.
- `GET /api/patients/:patientId/er-brief/snapshots` — lists this patient's live snapshots
  (`{ id, episodeId, createdByUserId, createdAt, expiresAt }[]`, newest first) so a caregiver can
  find one to revoke. **Never includes the token** — a snapshot's link is handed out once, at
  creation, and isn't re-surfaced later (same one-time-reveal spirit as an API key).
- `GET /api/er-brief/shared/:token` — **unauthenticated**. Returns `{ payload, frozenAt, expiresAt }`
  or 404 `SNAPSHOT_NOT_FOUND` (missing and expired are indistinguishable).
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

Backs photo observation entries (§5.8, F-8.1). `StorageService`'s local driver does the actual
read/write; the API surface stays storage-agnostic so a later S3-backed driver needs no route
changes (tooling.md → "File storage").

- `POST /api/files`
  - Multipart upload (`file` field) plus a `patientId` form field — the web client always knows
    the selected patient before a photo is attached, so there is no genuinely patient-less upload
    path today (data-model.md → `FileAsset`). `ensurePatientAccess(patientId, userId)` gates the
    upload the same as every other patient-scoped write.
  - Response: `{ fileId, url }` (201). `url` is `/api/files/:fileId` — same-origin, authenticated.
- `GET /api/files/:id`
  - Streams the file with its stored `contentType`. Access control: `ensurePatientAccess` against
    the file's `patientId` when set; for the (currently theoretical) patientless case, only the
    uploader may read it.
  - Accepted for photo observations only (`metadata.fileId` on a `photo` entry).

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

### Error codes
27 codes are thrown today, all `SCREAMING_SNAKE_CASE`. A new code must follow that casing and be
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
| `SELF_RELATIONSHIP_ALREADY_EXISTS` | 400 | care team: adding a second "self" relationship |
| `CANNOT_REMOVE_OWNER` | 400 | care team: removing the patient's owner |
| `AT_LEAST_ONE_ENTRY_REQUIRED` | 400 | observation/intervention create with an empty `entries` array |
| `RESOLVES_MUST_BE_SUBSET_OF_EPISODES` | 400 | `resolvesEpisodeIds` not a subset of `episodeIds` |
| `OBSERVATION_SCHEMA_INVALID` | 400 (array form) | an observation entry's `metadata` fails its type-specific schema — see "Error response shapes" above for how this arrives |
| `INVALID_REACTION_SCOPE` | 400 | an `AdverseReaction` create whose scope target doesn't match exactly one of `medicationId`/`embodimentId`/`tag` per its `scopeType` |
| `SCHEDULE_EPISODE_CONDITION_CONFLICT` | 400 | an `InterventionSchedule` create/update with both `episodeId` and `conditionId` set |
| `MEDICATION_ID_REQUIRED` | 400 | schedule create missing `medicationId` |
| `BODY_LOCATION_REQUIRED` | 400 | dressing-change schedule create missing `bodyLocation` |
| `FREQUENCY_OR_EXPLICIT_TIMES_REQUIRED` | 400 | schedule create with neither a frequency nor explicit times |
| `FILE_REQUIRED` | 400 | `POST /api/files` with no file part |
| `PATIENT_ID_REQUIRED` | 400 | `POST /api/files` with no `patientId` field |

### Dosing warnings are not error codes
`atypical_dose` is an advisory `type`, not an error — see "Dosing engine" above. A dose that exceeds
guidance is still saved (`isAtypical=true`); the advisory's `payload.reasons` is an array of zero or
more of `'exceeds_max_per_dose' | 'exceeds_max_per_day' | 'interval_too_short'` (plural, since more
than one can apply at once), alongside `amountMg` and `dailyTotalMg`. Front-end is expected to
surface these as warnings before the caregiver finalizes the save; the API never blocks on them.

## Real-time considerations
- No WebSocket in MVP. Front-end polls `/timeline` or `/dashboard`.

## Security
- JWT auth header `Authorization: Bearer <token>`.
- All routes revalidate that user is member of patient care team.

## Future (phase 2) placeholders
- `GET /api/patients/:patientId/doctors`, `POST /appointments`, etc. (not implemented yet).
