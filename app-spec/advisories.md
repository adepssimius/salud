# Advisories

**Status:** adopted (requirements v0.1 §4.11 flagged this as "proposed, not yet decided"; the
project has since adopted it as the unifying model for every contextual warning in the app).

## Concept

An Advisory is a contextual warning with a severity, shown at the moment of relevance, always
dismissible, and always recorded as seen. Every "the app should mention X when Y" feature — an
atypical dose, a stale weight, an expired bottle, an adverse-reaction flag, a protocol firing —
is an instance of this one shape rather than a bespoke UI. This is what lets a later feature (the
ER Brief) ask one question — "which advisories fired and were seen during this episode" — instead
of querying five unrelated tables.

This directly implements **P1 (strong guardrails, no gates)**: the app surfaces every conflict and
leaves the decision with the person in the room. An Advisory is never a blocker — see "No hard
stops" below.

## Shape

See `data-model.md` → `Advisory` for the field-level definition. In brief: `type`, `severity`,
an optional polymorphic `source` (what produced it — a guideline, an embodiment, a reaction, a
protocol), an optional `context` (the event it attached to — an observation or intervention), a
free-form `payload` for type-specific detail, and `acknowledgedByUserId`/`acknowledgedAt`.

## Producer catalog

| Type | Severity | Fires when | `source` | Milestone |
| --- | --- | --- | --- | --- |
| `atypical_dose` | `warning` | A logged dose exceeds `maxMgPerDose`, the prospective daily total exceeds `maxMgPerDay`, lands before the prior dose's `nextAllowedAt`, or was entered as `doseSource: override` | `guideline` (the guideline evaluated against, if any) | M2 |
| `stale_weight` | `warning` | No weight on file, or the latest weight is >60 days old, at the moment a dose is being logged (F-3.2) | — | M2 |
| `expired_embodiment` | `warning` | The selected embodiment's `expiresAt` has passed (F-9.2) | `embodiment` | M2 |
| `running_low` | `info` | Surfaced on the dashboard shopping list from embodiments flagged `runningLow` (F-9.3) | `embodiment` | M3 |
| `reaction_warning` | `warning` | A logged/selected medication matches a caregiver-recorded `warning`-class adverse reaction | `reaction` | M4 |
| `reaction_danger` | `danger` | A logged/selected medication matches a caregiver-recorded `danger`-class adverse reaction | `reaction` | M4 |
| `protocol_fired` | `danger` | An observation trips a Protocol's trigger condition | `protocol` | M4 |

Severity is a ladder (`info` < `warning` < `danger`), never an authority level (P1) — a `danger`
advisory still doesn't block the save; it earns a heavier confirmation UI (the full-screen
interstitial, §4.9 of the requirements doc), not a rejection.

## Two lifecycles: preview vs persisted

- **Preview** (`POST /api/patients/:patientId/dose-checks`) returns advisory **candidates** — plain
  `{ type, severity, source?, payload }` objects with no `id` and nothing written to the database.
  A caregiver who fills in a dose and then navigates away without saving leaves no trace. This is
  what makes "warn before save" (F-2.3) possible without polluting the record with warnings nobody
  acted on. `reaction_warning`/`reaction_danger` candidates ride this same endpoint — matching a
  caregiver-recorded `AdverseReaction` is just another check `DosingService.evaluate()` runs
  alongside the dosing math, keyed off the same `medicationId`/`embodimentId` inputs, so no
  reaction-specific preview endpoint was needed.
- **Persisted**: when the triggering event is actually saved, the service that saves it (today,
  `InterventionsService` on a `medication_dose` create) writes the same candidates as real
  `advisories` rows in the same flow as the event itself, with `contextType`/`contextId` pointing
  at the newly created event. `protocol_fired` has no preview step at all — a Protocol trip is only
  meaningful once the observation exists, so `ObservationsService.create()` calls
  `AdvisoriesService.evaluateProtocols()` directly and persists (already-acknowledged) advisories
  in the same request, no candidate stage in between.

## Acknowledgment semantics

Saving past a warning **is** the acknowledgment (F-2.4). When `InterventionsService` persists an
advisory alongside the dose that triggered it, it stamps `acknowledgedByUserId`/`acknowledgedAt`
from the actor in the same request — there is no separate confirmation step today. `isAtypical` on
the dose record itself is the durable trace that "you were warned and proceeded deliberately".

`POST /api/advisories/:advisoryId/ack` exists for a case no current producer generates yet: a
`danger`-class advisory that was persisted (e.g. shown ahead of save, unlike the M4
`reaction_danger` candidate below) but never got attached to a saved event as `context`. Every M4
producer — like every M2 one — follows the same candidate-then-persist-on-save shape: the
danger-interstitial component (frontend.md) renders an *unpersisted* `dose-checks` candidate, so
backing out of it without saving leaves no trace to ack, the same as abandoning any other advisory
candidate. The endpoint remains reserved for a future producer that persists ahead of save.

## No hard stops (N-3, P1)

An Advisory — regardless of severity — never causes an API rejection. `POST` endpoints that would
trigger one **always** return success (`201`) with the advisory persisted alongside the event and
`isAtypical: true` (or the equivalent per-type flag) on the record. Blocking a determined caregiver
produces a wrong or missing log entry, not a safer one (§7 of the requirements doc, "No hard stops,
ever").

## Reading advisories

`GET /api/patients/:patientId/advisories` lists a patient's advisories (used by the dashboard's
unacknowledged-advisories surface, arriving in M3). No filtering/pagination yet — the query shape
will grow as producers are added.
