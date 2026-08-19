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

`body.eventScope` (below) is consistent with that rule and worth naming explicitly, because a
discriminator field can look like a judgment. It is a statement about **the query** — which window
these events were drawn from — not about the patient. "Everything logged in the last 72 hours" says
nothing about how sick anyone is.

## Scope

- Query: `episodeId?` — the episode the visit concerns. When omitted, defaults to the patient's
  most recently **started** active episode (F-7.6's "current episode").
- **When no `episodeId` was supplied and the patient has no active episode, the body falls back to a
  trailing 72-hour window** instead of coming back empty. `body.episode` stays `null`; what changes
  is that `events` is drawn from the window rather than from nothing.
  - The reason: an ER visit at 3 AM is precisely the moment nobody paused to open an episode.
    Episodes are a manual frame someone has to remember to start, and scoping the entire body to one
    meant the brief's founding use case produced a header and an empty page.
  - 72 hours rather than 24: 24 duplicates what the dashboard already answers and loses the "third
    day of fever" arc triage always asks about. A week floods the one-page print.
  - A recently *resolved* episode is not resurrected — the fallback needs no active episode at all,
    not merely no unresolved one.
- `body.eventScope` is the discriminator, so the client never has to guess which mode produced a
  body:
  - `{ "type": "episode", "episodeId": "..." }`
  - `{ "type": "recent", "windowHours": 72, "since": 1233913890, "generatedAt": 1234000290 }`
  - `since` and `generatedAt` rather than a `from`/`to` pair: the query applies only a lower bound,
    so a future-stamped event still appears. The brief must never hide a logged event, and a `to`
    field would claim a bound that isn't enforced.

## `GET /api/patients/:patientId/er-brief`

- Response:
  ```json
  {
    "header": {
      "patient": { "id": "...", "fullName": "...", "dateOfBirth": "...", "sexAtBirth": "...", "ageYears": 7, "ageMonths": 91 },
      "latestWeight": { "kg": 24.3, "recordedAt": 1234567890 },
      "codeStatus": { "value": "Full code", "setByUserId": "...", "setByName": "...", "setAt": 1234000000 },
      "careDocuments": {
        "livingWill": null,
        "advanceDirective": { "status": "none", "setByUserId": "...", "setByName": "...", "setAt": 1230000000 },
        "medicalPoa": { "status": "on_file", "fileId": "...", "originalName": "medical-poa-2025.pdf", "contentType": "application/pdf", "holderName": "...", "holderPhone": "...", "setByUserId": "...", "setByName": "...", "setAt": 1230000000 }
      },
      "dangerReactions": [ { "...AdverseReaction, severity=danger only" } ],
      "activeConditions": [ { "id": "...", "name": "ALL treatment", "diagnosisText": "...", "baselines": [...], "devices": [...], "contacts": [...] } ],
      "protocolFiredReason": {
        "protocolName": "Fever with port", "instructionText": "...", "sourceText": "...",
        "triggerMetric": "temperature", "triggerOperator": "gte", "triggerValue": 38,
        "observedValue": 38.3, "firedAt": 1234567890
      }
    },
    "body": {
      "eventScope": { "type": "recent", "windowHours": 72, "since": 1233913890, "generatedAt": 1234000290 },
      "episode": { "id": "...", "name": "Neutropenic fever #3", "status": "active", "startedAt": 1234000000, "endedAt": null },
      "events": [ "...TimelineEntry, same shape as GET .../timeline, filtered to eventScope" ],
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
- **Header** (F-7.1–F-7.5, plus §4.1's care documents) — what a team acts on before reading
  anything else:
  - `patient.ageYears`/`ageMonths` computed from `dateOfBirth` as of now.
  - `latestWeight` is `null`, not omitted, when no weight is on file — the brief is explicit about
    missing data rather than silent about it (the ER re-doses everything off this number, F-7.1).
  - `codeStatus` is `null` when never set — F-7.2 is explicit that the brief should make an unset
    code status impossible to miss, not paper over it with a default.
  - `careDocuments` (§4.1; data-model.md → `CareDocumentStatement`): living will, advance
    directive, medical power of attorney. All three keys are always present, each the current
    statement or `null` when never recorded — the tri-state is the contract. `null` means "not
    recorded" and renders as exactly that (the same make-the-gap-impossible-to-miss rule as an
    unset code status); `status: 'none'` is an affirmative caregiver statement that no such
    document exists; `'on_file'` carries the file reference, served via `GET /api/files/:id` on
    the authenticated brief and via the token file route on a shared snapshot (see "Formats").
    `setByName` is resolved server-side like `codeStatus`'s, and the client renders each
    statement's age — a two-year-old "none" should look as stale as a two-year-old code status.
    P6 holds throughout: "the family stated none exists" is a stored fact, not an inference from
    absence — which is precisely why absence (`null`) must render differently from it.
  - `dangerReactions`: every `AdverseReaction` with `severity: 'danger'` on file, regardless of
    scope type (F-7.3) — allergies belong in the header, not buried in the body.
  - `activeConditions`: every `Condition` with `status: 'active'` for the patient, full baselines/
    devices/contacts inline (F-7.4) — no second fetch needed at triage.
  - `protocolFiredReason`: `null` unless a `protocol_fired` advisory exists among `body.events` —
    when one does, the **most recent** such advisory populates this field verbatim from its
    payload (F-7.5). This is a straight read of an existing advisory, not new inference. Because it
    reads from `body.events`, it resolves in recent-window mode too — and becomes strictly more
    useful there, since the protocol firing that triggered the visit is very often logged with no
    episode open.
- **Body** (F-7.6–F-7.9):
  - `eventScope`: which window `events` was drawn from — see "Scope" above. Always present.
  - `events`: the same merged, chronological, attributed observation/intervention/advisory stream
    `GET .../timeline` already produces, filtered to `eventScope` — either to the episode or to the
    trailing window. Reusing the merge is deliberate (P6): the brief must not have a second,
    differently-shaped narrative that could drift from what the timeline shows the caregivers. That
    reasoning is unchanged by the fallback and now covers both modes.
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
    - In recent-window mode there is no episode and therefore no `conditionId` to filter on, so this
      becomes the patient's **five most recent episodes, any condition, any status**, newest first.
      Triage's actual question is "has this happened before?", and a count of prior episodes is a
      stored fact, not an inference. The five-item cap is part of the response contract — stated here
      so it is a documented rule rather than silent truncation.
  - `atypicalAdvisories`: `atypical_dose` advisories whose `contextId` matches an intervention in
    `body.events` — the atypical flags already recorded for those doses, reasons included (F-7.8).
    Because it derives from `events`, it follows `eventScope` automatically in either mode.

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
    - A snapshot taken in recent-window mode therefore freezes **absolute** `since`/`generatedAt`
      values, which is correct: the frozen document says "events from 02:00 Aug 7 to 02:00 Aug 10"
      and stays true when someone reads it three days later. The consequence for the client is that
      it must label the window from those two numbers rather than from the phrase "the last 72
      hours" — a shared brief read on day 3 that still says "last 72 hours" is simply lying.
    - The snapshot also records the `FileAsset` ids referenced by `header.careDocuments` as
      `fileIds` at creation (data-model.md → `ErBriefSnapshot`), and
      `GET /api/er-brief/shared/:token/files/:fileId` — unauthenticated, in
      `ErBriefPublicController` — streams those files and only those. An id not frozen into this
      snapshot 404s `SNAPSHOT_NOT_FOUND`, identically to a bad or expired token: one code for the
      whole route, so holding a valid token gives no probing signal either. The bytes are frozen
      by construction — `FileAsset` blobs are immutable (data-model.md → Data integrity rules), so
      a later superseding upload is a different id and never reachable through an old token. The
      route carries the same hardened CSP as `GET /api/files/:id`. Snapshots from before `fileIds`
      existed carry `null` there and simply have no token-readable files.
    - **Document staleness is stated, never checked.** Every care-document line the shared page
      renders carries a fixed caveat built from frozen values — "as on file ⟨frozenAt date⟩ — may
      have been superseded; ask the family for a current link" — alongside the statement's own
      `setAt` date. There is deliberately **no** live has-this-been-superseded lookup at read
      time. Three reasons, in rising order: it would break the frozen contract (the `eventScope`
      shim below stays the only read-time boundary); it would leak a bit of live record state
      through an unauthenticated link; and — decisive — a conditional warning's *silence* would
      read as "still current", a promise the app cannot make, since the record can lag the
      family's reality. "May have been superseded" is the only claim the system can stand behind,
      so it is made unconditionally — a property of the medium, not of the patient (P6).
    - Snapshots frozen before `eventScope` existed do not carry the field. `GET /api/er-brief/shared/:token`
      synthesizes it on read — the episode shape when the payload has an episode, the recent shape
      derived from `frozenAt` otherwise. That shim lives at exactly one boundary so the field can stay
      required in the type and the public page needs no defensive branches.
    - Response: `{ id, token, url, expiresAt }`. `id` is returned so the caregiver can revoke the
      link they just created without re-listing.
    - `url` is `<scheme>://<host>/brief/:token`. `host` is the request's own `Host` header; `scheme`
      comes from `X-Forwarded-Proto` when the request arrived through the trusted proxy, and is
      forced to `https` in production. The API still has no separate "frontend base URL" config to
      keep in sync — the topology makes the web and API same-origin by construction
      (deployment.md → Topology).
    - **The client-supplied `Origin` request header is ignored.** This URL is a bearer capability to
      a complete medical brief that gets copied, pasted and texted; deriving its host from an
      attacker-settable header would let a request choose where that link points. See security.md.
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
  the header card, the event stream, active-schedule table, prior-episode list, and
  atypical-dose list; a "Create shareable link" action calls the snapshot endpoint and surfaces the
  resulting URL (with its expiry) for the caregiver to copy or send. `@media print` collapses this
  to one page; `?mode=flash` swaps in the flash layout.
- **The page reads its scope from the response, never from an assumption.** In episode mode it names
  the episode and its start; in recent-window mode it says what window it is showing, from the
  response's own `since`/`generatedAt` in absolute times (frontend.md makes the ER Brief the
  explicit exception to the relative-time rule elsewhere). Section headings follow: "Prior episodes
  under this condition" vs "Recent episodes", "Atypical doses this episode" vs "Atypical doses in
  this window".
- Both modes carry a **confident** empty state rather than a blank section — "No events recorded for
  this episode." or "Nothing logged in the last 72 hours." A blank section is ambiguous between
  "nothing happened" and "the app doesn't know".
- The header's care-document lines are the same confident-state idea applied to documents: all
  three kinds render, always, as one line each — "Living will: not recorded", "Advance directive:
  none — stated by Mom, Mar 2025", "Medical POA: on file (uploaded Mar 2025)" — with the file one
  tap away when on file, and the holder's name and phone on the PoA line when recorded. Never a
  conditionally-absent section: at triage, "not recorded" is itself actionable ("ask the family").
  The **flash view includes these three lines** — whether a directive exists is an arm's-length
  triage fact. Print keeps them in the header at one line each.
- **Both print stylesheets** — the authenticated page's and the public page's — end with a fixed
  footer line: "Generated ⟨date⟩ — verify documents are current." The live page needs no caveat on
  screen (it *is* current), but paper is the ultimate frozen snapshot, with no expiry at all, and
  the printout is the copy most likely to be handed to a paramedic.
- The medication-situation table must not force the page to scroll sideways on a phone. It is the
  screen most likely opened one-handed in a waiting room, and horizontal scroll is where the
  caregiver loses the "next allowed" column. Print keeps the real table — a paramedic reads a
  printout in columns.
- Public route `/brief/:token` (no `authGuard` — this is the one other web route besides
  `/login`/`/register` that works signed out): renders the frozen `payload` with a banner stating
  when it was frozen and when it expires, and the same scope line read from the frozen values. A 404
  from the API renders as "This link has expired or doesn't exist," without further detail (same
  non-disclosure the API itself practices). It gets the same table treatment and its own print
  stylesheet — it is the copy an actual clinician is most likely to open and print. Its
  care-document lines fetch files through `GET /api/er-brief/shared/:token/files/:fileId` (never
  the authenticated files route) and each carries the frozen-value caveat from "Formats" above —
  "as on file ⟨frozenAt date⟩ — may have been superseded; ask the family for a current link".

## Security

See `security.md` → "ER Brief snapshot tokens" for the token model.
