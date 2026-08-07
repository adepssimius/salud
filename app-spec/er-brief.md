# ER Brief

A generated handoff artifact for an unfamiliar clinician (§5.7 of the requirements doc), built for
the moment a family walks into an ER — especially when the visit is triggered by a symptom of a
chronic condition. It aggregates data that already exists elsewhere in the app (patient, code
status, conditions, reactions, episode events, schedules, advisories) into one read designed to be
handed to triage in under ten seconds.

## P6 enforced by the response shape

The brief is **data, not diagnosis** (P6). There is no `summary`, `assessment`, `effectiveness`, or
similarly-shaped field anywhere in the response type — the type itself is the enforcement
mechanism, not a review checklist. Every field is either a stored fact (patient identity, code
status, a reaction record) or a mechanical computation over stored facts (age from date of birth,
mg/kg from a dose's own `weightKgUsed`, "3rd episode under this condition" as a count). Nothing is
inferred, and nothing editorializes toward the reader.

## `GET /api/patients/:patientId/er-brief`

- Query: `episodeId?` — the episode the visit concerns. When omitted, defaults to the patient's
  most recently **started** active episode (F-7.6's "current episode"); when the patient has no
  active episode, `body.episode` is `null` and the body carries only the medication situation and
  reaction/condition history (still useful — the visit may not be about an acute episode at all).
- Response:
  ```json
  {
    "header": {
      "patient": { "id": "...", "fullName": "...", "dateOfBirth": "...", "sexAtBirth": "...", "ageYears": 7, "ageMonths": 91 },
      "latestWeight": { "kg": 24.3, "recordedAt": 1234567890 },
      "codeStatus": { "value": "Full code", "setByUserId": "...", "setByName": "...", "setAt": 1234000000 },
      "dangerReactions": [ { "...AdverseReaction, severity=danger only" } ],
      "activeConditions": [ { "id": "...", "name": "ALL treatment", "diagnosisText": "...", "baselines": [...], "devices": [...], "contacts": [...] } ],
      "protocolFiredReason": {
        "protocolName": "Fever with port", "instructionText": "...", "sourceText": "...",
        "triggerMetric": "temperature", "triggerOperator": "gte", "triggerValue": 38,
        "observedValue": 38.3, "firedAt": 1234567890
      }
    },
    "body": {
      "episode": { "id": "...", "name": "Neutropenic fever #3", "status": "active", "startedAt": 1234000000, "endedAt": null },
      "events": [ "...TimelineEntry, same shape as GET .../timeline, filtered to this episode" ],
      "activeSchedules": [
        {
          "scheduleId": "...", "label": "Amoxicillin q8h", "medicationId": "...", "medicationName": "amoxicillin",
          "lastDoseAt": 1234567890, "lastDoseMg": 400, "lastDoseMgPerKg": 16.5, "nextAllowedAt": 1234582290
        }
      ],
      "priorEpisodes": [ { "id": "...", "name": "Neutropenic fever #2", "status": "resolved", "startedAt": ..., "endedAt": ... } ],
      "atypicalAdvisories": [ { "...Advisory, type=atypical_dose, contextId within this episode's events" } ]
    }
  }
  ```
- **Header** (F-7.1–F-7.5) — what a team acts on before reading anything else:
  - `patient.ageYears`/`ageMonths` computed from `dateOfBirth` as of now.
  - `latestWeight` is `null`, not omitted, when no weight is on file — the brief is explicit about
    missing data rather than silent about it (the ER re-doses everything off this number, F-7.1).
  - `codeStatus` is `null` when never set — F-7.2 is explicit that the brief should make an unset
    code status impossible to miss, not paper over it with a default.
  - `dangerReactions`: every `AdverseReaction` with `severity: 'danger'` on file, regardless of
    scope type (F-7.3) — allergies belong in the header, not buried in the body.
  - `activeConditions`: every `Condition` with `status: 'active'` for the patient, full baselines/
    devices/contacts inline (F-7.4) — no second fetch needed at triage.
  - `protocolFiredReason`: `null` unless a `protocol_fired` advisory exists among `body.events` —
    when one does, the **most recent** such advisory populates this field verbatim from its
    payload (F-7.5). This is a straight read of an existing advisory, not new inference.
- **Body** (F-7.6–F-7.9):
  - `events`: the same merged, chronological, attributed observation/intervention/advisory stream
    `GET .../timeline` already produces, filtered to `episodeId` — reusing the merge is deliberate
    (P6): the brief must not have a second, differently-shaped narrative that could drift from what
    the timeline shows the caregivers.
  - `activeSchedules`: every `status: 'active'` `InterventionSchedule` for the **patient** (not
    scoped to this episode — F-7.7 wants the whole current medication situation, since the ER
    needs to know about every standing regimen regardless of which one prompted the visit).
    `lastDoseMg`/`lastDoseMgPerKg` come from the most recent intervention logged against that
    schedule; `lastDoseMgPerKg` divides by that dose's own recorded `weightKgUsed` (the weight
    reasoned from at the time, not the patient's current weight) — `null` when the dose has no
    `weightKgUsed` on file (e.g. an `override` dose that didn't specify one). `medicationName` is
    resolved server-side so the brief reads in generic-name clinical language even though the
    household UI shows brand names (F-7.9 — the embodiment model run in reverse).
  - `priorEpisodes`: other episodes sharing `body.episode.conditionId`, newest first — empty when
    the current episode has no `conditionId` or is the only one (F-7.8's "third fever this cycle").
  - `atypicalAdvisories`: `atypical_dose` advisories whose `contextId` matches an intervention in
    `body.events` — the atypical flags already recorded for doses given during this episode,
    reasons included (F-7.8).

## Formats (F-7.10)

- **Printable PDF**: `er-brief.page.ts` renders the same response with a strict `@media print`
  one-page stylesheet. The PDF *is* the browser's native print-to-PDF — no server-side rendering
  dependency (no puppeteer/pdfkit), consistent with the project's "no new heavyweight deps"
  posture.
- **Flash view**: the same page at `?mode=flash` — header fields only, in large type, legible at
  arm's length at a triage desk. Same data, no separate endpoint.
- **Frozen snapshot**: a time-limited, unauthenticated link — an *export*, not an account (P4); it
  doesn't violate the no-read-only-tier rule because it grants no ongoing access to the record,
  just a frozen copy of one brief.
  - `POST /api/patients/:patientId/er-brief/snapshots`
    - Body: `{ episodeId?, expiresInHours? }` (`expiresInHours` defaults to 72, capped at 168 —
      one week — server-side; a longer-lived "link" would start to function like an account, which
      is exactly what this format is designed not to be).
    - Computes the brief **once**, at creation time, exactly as `GET .../er-brief` would, and
      freezes the full JSON as `payload` — a snapshot literally does not update if the underlying
      record changes later, which is the point: it's what the clinician saw at handoff.
    - Response: `{ token, url, expiresAt }`. `url` is `<web origin>/brief/:token`, built from the
      request's own origin — the API has no separate "frontend base URL" config to keep in sync.
  - `GET /api/er-brief/shared/:token` — **unauthenticated** (no `JwtAuthGuard`; the second
    exception to "every route revalidates care team membership," after auth's own `login`/
    `register`). Returns `{ payload, frozenAt, expiresAt }`. Missing token **and** expired token
    both 404 `SNAPSHOT_NOT_FOUND` — identical response, so an expired link can't be distinguished
    from a wrong one (same anti-probing rationale as `PATIENT_NOT_FOUND`, api.md → "Resource shape
    and access control").
  - `GET /api/patients/:patientId/er-brief/snapshots` — lists live snapshots for the patient
    (`id`, `episodeId`, `createdByUserId`, `createdAt`, `expiresAt`) so a caregiver has something
    to revoke by. Never returns the token itself — the link is a one-time reveal at creation, the
    same convention as an API key; the list exists to let a link be found and killed, not copied
    again.
  - `DELETE /api/er-brief/snapshots/:id` — authenticated, patient-scoped; revokes early by
    deleting the row. Any caregiver on the patient's care team may revoke, not just the creator —
    consistent with P4 (every caregiver on a patient's care team sees and does everything).

## Web

- `er-brief.page.ts`: route `patients/:patientId/er-brief`, entry point from patient-detail. Shows
  the header card, the episode-event stream, active-schedule table, prior-episode list, and
  atypical-dose list; a "Create shareable link" action calls the snapshot endpoint and surfaces the
  resulting URL (with its expiry) for the caregiver to copy or send. `@media print` collapses this
  to one page; `?mode=flash` swaps in the flash layout.
- Public route `/brief/:token` (no `authGuard` — this is the one other web route besides
  `/login`/`/register` that works signed out): renders the frozen `payload` with a banner stating
  when it was frozen and when it expires. A 404 from the API renders as "This link has expired or
  doesn't exist," without further detail (same non-disclosure the API itself practices).

## Security

See `security.md` → "ER Brief snapshot tokens" for the token model.
