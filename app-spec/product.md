# Product Spec: Salud Care Timeline

## Product vision
- Digital logbook for a single household to track illnesses, meds, observations, and interventions for any patient (children or adults) and share context across trusted caregivers.
- Origin story: designed for parents juggling sick-kid handoffs and 3 AM uncertainty about “did I give Tylenol or ibuprofen last?”—everything is logged from the phone in real time so a reliable narrative is always ready for on-call caregivers or doctors.
- Optimized for MD caregivers: fast entry on mobile, rich analysis on desktop, no hard dosing stops but strong guardrails and context.
- Architecture should be ready to evolve into OAuth auth, S3 asset storage, and PostgreSQL persistence, while the MVP can run with email/password auth and SQLite/file uploads.

## Design principles

Load-bearing; every feature decision traces back to one of these.

- **P1 — Strong guardrails, no gates.** The app does the arithmetic the tired parent shouldn't have
  to do at 3 AM, surfaces every conflict, and leaves the decision with the person in the room. No hard
  stops anywhere — UI or API. Warnings escalate in weight, never in authority.
- **P2 — Assume a competent adult.** The target user is medically literate and wants the math and the
  context, not permission. Show provenance, show both dosing methods, show the discrepancy when they
  disagree.
- **P3 — Everything is attributed.** Every entry carries who logged it and when. "Did someone already
  give her something?" always has an answer with a name on it.
- **P4 — One trusted household.** Every caregiver on a patient's care team sees and does everything.
  No read-only tiers, no cross-household sharing in v1. Per-person E2E-encrypted sharing is a later phase.
- **P5 — The frame is a judgment call, not an inference.** Events land on one continuous timeline;
  episodes are frames a caregiver draws around them afterward. The app never decides when an illness
  started or what belongs to it.
- **P6 — Data, not diagnosis.** When the app presents information to a medical professional, it
  presents raw, chronological, attributed data — never derived conclusions. The app must not state or
  imply a medication was or wasn't effective, must not suggest diagnoses, and must not editorialize the
  record. Within the household-facing UI the app may *compute* (next allowed dose, daily totals) —
  arithmetic, not interpretation.
- **P7 — Entry is mobile, analysis is desktop.** Logging a dose or observation takes under 30 seconds,
  one-handed, in a dark room. Graphs, comparisons, and the fuller picture are desktop concerns for
  after things calm down.

## Users & roles
- **Patient**: anyone receiving care. Every patient is automatically a caregiver for themself.
- **Caregiver**: authenticated user who can log data and view timelines. The creator of a patient automatically becomes one of its caregivers.
- Single-household scope: all patients and caregivers belong to one trusted household; no cross-household sharing in phase 1.

## MVP goals (Phase 1)
1. **Care timeline**
   - Continuous timeline per patient.
   - Derived “episodes” are manual frames defined by a start event and an end event (a frame must be defined by logged observations or interventions).
   - Episode resolves when an observation or intervention is explicitly marked as resolving it; observations/interventions can be tagged with multiple episodes.
   - Per-episode timeline view showing only events tagged to that episode.
2. **Observations**
   - Support structured vitals: temperature, heart rate, respiratory rate, oxygen saturation, pain score, weight, height, lesion size.
   - Structured values stored in canonical units (°C, bpm, breaths/min, %, 0–10, kg, cm, etc) with the entered unit preserved for display.
   - User preference defines display unit (e.g., °F vs °C); graphs normalize to the preferred unit.
   - Fixed symptom tags (e.g., cough, vomiting, rash) selectable per observation, plus free-text notes.
   - Photo observations capture raw image + metadata (body location, side, size in cm, notes). No graphical photo annotations in phase 1.
3. **Interventions**
   - Medication dosing events.
   - Dressing changes (track time, body location, notes). Dressing changes appear on timelines/graphs similar to meds.
   - Will be expanded in the future.
4. **Medication management**
   - Pre-seeded common home medications stored in DB with details: name, formulation (tablets, syrup, etc.), strength/embodiment, tags (e.g., antipyretic, NSAID).
   - **Scheduled interventions**: caregivers can set recurring or one-off schedules (e.g., “give amoxicillin 400 mg every 8 h for 10 doses” or “change dressing nightly”). Schedules can optionally tie to an episode (e.g., the ear infection being treated). Scheduled items appear on the caregiver dashboard with clear “upcoming action” notifications. From a schedule card, caregivers can jump straight into creating the corresponding intervention entry automatically linked back to the schedule—and by extension the episode—for auditing.
   - Medications support arbitrary tags; timeline graphs can filter by tags or individual meds.
   - Medication dosing guidelines include:
     - Weight-based rules: mg/kg, max mg per dose, max mg per day, min interval hours, applicable age range, guideline source.
     - Age-band rules: min/max months, dose (mg/mL or pill count per embodiment), frequency per day, max mg per day, guideline source.
   - When logging a dose:
     - Show both weight-based recommendation (using latest weight; prompt for weight if older than 60 days) and age-band recommendation side-by-side (age recommendation only applicable if the adult dose is not appropriate).
     - Allow selection of formulation/embodiment (e.g., “2 x 500mg tablets”, “5 mL 5mg/mL syrup”).
     - Compute next allowed dose time based on chosen guideline and current log.
   - Atypical detection: any logged dose or interval that falls outside the stored guideline triggers a warning inline before save. Caregiver can confirm and save anyway.
5. **Dashboard**
  - Leads with the direct answer to "did I already give Tylenol?": per patient, every medication given in the last 24 hours, how long ago, and when the next dose is allowed. Doses appear whether or not they belong to an episode — the 3 AM dose usually doesn't. A patient with nothing in the window says so explicitly rather than showing nothing.
  - Below that, active episodes/patients with last observation summaries and per-episode medication context.
  - Times are shown relative ("2h 15m ago") — the arithmetic is the app's job, not the tired caregiver's (P1).
  - Mobile-first quick entry for observations, photo capture, and interventions.
6. **Sharing & identity**
  - Every action attributed to the caregiver who logged it; other caregivers can view identity per event.
  - No read-only-only roles yet; all caregivers have full access for shared patients.
7. **Patient relationships**
   - When creating a patient, the caregiver can set their relationship role (self, parent, co-parent, nanny, grandparent, babysitter, other). Default role is parent if not provided; set role to self to mark self-care.
8. **Chronic illness & handoff** (data-model.md → Condition/AdverseReaction/Protocol; the chunk
   that serves the ER Brief, requirements doc §8)
   - **Code status**, set deliberately on the patient record via its own endpoint, carrying
     attribution and displaying its age wherever shown.
   - **Conditions**: standing, open-ended frames for chronic illness — diagnosis text, baselines
     ("normal" for this patient), devices, care-team contacts. Episodes and medication schedules
     may nest under a Condition, inheriting its context.
   - **Adverse reactions**: caregiver-recorded, severity-classed (`warning`/`danger`), scoped
     explicitly to a medication, a specific embodiment, or a tag class — never inferred. Surfaced
     at dose entry via the same guardrail machinery as atypical-dose warnings; `danger` earns a
     heavier confirmation, never a hard stop.
   - **Protocols**: standing clinician instructions attached to a Condition, tripped by an
     observation crossing a threshold. A trip immediately resurfaces the instruction as a card and
     is remembered as an event on the timeline.
9. **ER Brief** (data-model.md/api.md/er-brief.md; requirements doc §5.7)
   - A generated handoff artifact aggregating patient identity/weight/code-status/danger-reactions/
     active-conditions header plus a chronological episode body, active-schedule med situation
     (with mg/kg), prior episodes under the same condition, and atypical-dose history.
   - Printable one-pager, an arm's-length "flash view," and a time-limited, unauthenticated
     frozen-snapshot link — an export, not an account (P4).
   - Strictly data, never derived conclusions (P6) — enforced by the response shape itself.
10. **Handoff and fidelity** (data-model.md/api.md; requirements doc §5.1, §5.6, §5.8)
    - **While You Were Asleep**: a per-caregiver diff since their own last acknowledged look —
      what was logged, what advisories fired, what's due now. The 6 AM shift change is a handoff
      too.
    - **Corrections**: entries can be edited after the fact; the prior state is always retained
      and attributed, never silently overwritten (F-1.4).
    - **Photos**: attach to the timeline and to episodes like any other event, with a same-episode
      framing hint so a progression series stays comparable. No inventory-style attachment
      management — photos ride the existing entries model.

## Phase 2 placeholders (not in MVP)
- Doctor directory per patient with specialty, contact info, and appointments linked to episodes.
- Simple caregiver-only view for non-technical helpers (e.g., grandparents) focused on “what to give next”.
- Household export or clinician-friendly reports.

## Non-functional requirements
- Email/password authentication, HTTPS assumed.
- Data stored locally (SQLite/File) in MVP; design interfaces to lift to PostgreSQL/S3 later.
- Dosing alerts shown client-side; no back-end hard stop.
- No field-level encryption.
- No photo size limits enforced; store as uploaded.

## Success metrics (qualitative)
- Logging an observation or dose on mobile takes <30 seconds.
- Timeline view makes it obvious which meds/episodes are active within a glance.
- Caregiver can compare weight vs age dosing guidance without leaving the app.
