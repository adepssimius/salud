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

## Patients
- `POST /api/patients`
  - Body: `{ fullName, dateOfBirth, sexAtBirth, notes? }` where `sexAtBirth` ∈ `['female','male']`.
  - Behavior:
    - Creator automatically added to care team.
    - Patient also auto-linked as self-caregiver (patient = user) when `fullName` matches or when explicit `isSelf: true`.
  - Response: `PatientDto`.
- `GET /api/patients`
  - Returns patients where requester is on the care team.
- `GET /api/patients/:patientId`
  - Includes care team list, latest weight metadata, active episodes summary.
- `PATCH /api/patients/:patientId`
  - Allow updates to demographics, notes.

## Care team
- `POST /api/patients/:patientId/care-team`
  - Body: `{ userId | invitationEmail, role }`
  - Adds caregiver; immediate for existing users, invitation for new ones (phase 1 can be limited to existing).
- `GET /api/patients/:patientId/care-team`
  - Lists caregivers + roles.

## Episodes
- `POST /api/patients/:patientId/episodes`
  - Body: `{ name, startedAtObservationId, notes? }`
  - Validates that the observation belongs to patient and includes the episode tag.
- `PATCH /api/episodes/:episodeId`
  - Body: `{ name?, notes?, resolvedAtObservationId?, status? }`
  - When `resolvedAtObservationId` provided, mark status resolved automatically.
- `GET /api/patients/:patientId/episodes`
  - Supports filters `status=active|resolved`.
- `GET /api/episodes/:episodeId`
  - Returns details + linked observations/interventions (IDs only).

## Observations
- `POST /api/patients/:patientId/observations`
  - Body:
    ```json
    {
      "observedAt": "ISO datetime",
      "type": "temperature|heart_rate|...|photo",
      "text": "optional note",
      "symptomTags": ["cough"],
      "episodeIds": ["uuid"],
      "resolvesEpisodeIds": ["uuid"],
      "metadata": { ...type specific... }
    }
    ```
  - Validation:
    - `metadata` must match type schema (see data model).
    - `resolvesEpisodeIds` must be subset of `episodeIds`.
    - If type = `photo`, `metadata.fileId` required.
    - Weight observations update patient latest weight + timestamp.
  - Response: `ObservationDto`.
- `GET /api/patients/:patientId/observations`
  - Query params: `type?`, `episodeId?`, `from?`, `to?`, `limit?`
  - Returns list, newest first.
- `GET /api/observations/:observationId`
- `PATCH /api/observations/:observationId`
  - Allow editing text, tags, metadata (audit with `updatedAt`).

## Interventions
- `POST /api/patients/:patientId/interventions`
  - Body for `type="medication_dose"`:
    ```json
    {
      "performedAt": "...",
      "type": "medication_dose",
      "episodeIds": [],
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
  - API computes:
    - `nextAllowedAt`.
    - `isAtypical` + `atypicalReason` when outside guideline constraints.
  - Dressing change body:
    ```json
    {
      "performedAt": "...",
      "type": "dressing_change",
      "episodeIds": [],
      "bodyLocation": "Left knee",
      "side": "left",
      "dressingType": "sterile gauze",
      "interventionScheduleId": "uuid",
      "notes": ""
    }
    ```
- `GET /api/patients/:patientId/interventions`
  - Filters: `type`, `medicationId`, `tag`, `episodeId`, `from`, `to`.
- `GET /api/interventions/:interventionId`
- `PATCH /api/interventions/:interventionId`
  - Allow updates with re-validation of atypical logic.

## Intervention schedules
- `POST /api/patients/:patientId/schedules`
  - Body:
    ```json
    {
      "type": "medication_dose|dressing_change",
      "label": "Amoxicillin q8h",
      "episodeId": "uuid",
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
  - Validate required fields per type (medication vs dressing change).
  - Response includes computed `nextDueAt`.
- `GET /api/patients/:patientId/schedules`
  - Filters: `type`, `status`, `episodeId`.
- `GET /api/schedules/:scheduleId`
- `PATCH /api/schedules/:scheduleId`
  - Update status (`pause`, `complete`), timing, or metadata; recompute `nextDueAt`.
- `POST /api/schedules/:scheduleId/log`
  - Convenience endpoint that creates the corresponding intervention pre-filled from the schedule (front-end may also call the standard interventions endpoint with `interventionScheduleId`).

## Timeline & dashboard
- `GET /api/patients/:patientId/timeline`
  - Query: `from`, `to`, `episodeId?`, `includeObservations=true/false`, `includeInterventions=true/false`, `medicationTag?`, `medicationId?`
  - Response:
    ```json
    {
      "patient": { ... },
      "entries": [
        {
          "id": "obs|int uuid",
          "kind": "observation|intervention",
          "type": "...",
          "timestamp": "...",
          "display": { ...ready-to-render payload... }
        }
      ],
      "weightPrompt": { "needsUpdate": true, "lastRecordedAt": "...", "daysSince": 75 }
    }
    ```
- `GET /api/dashboard`
  - Aggregates all patients with active episodes.
  - Response includes:
    - `activeEpisodes`: `[ { patientId, episodeId, name, startedAt, lastObservationSummary, medications: [{ medicationId, lastDoseAt, nextAllowedAt, isAtypicalLastDose }] } ]`
    - `upcomingSchedules`: `[ { scheduleId, patientId, label, type, episodeId, nextDueAt, overdue: boolean } ]`

## Medications & guidelines
- `GET /api/medications`
  - Query: `tag?`, `activeOnly?`
  - Returns medication + embodiments.
- `POST /api/medications` (admin use for now)
  - Body: `{ name, description, tags[] }`
- `POST /api/medications/:medicationId/embodiments`
- `POST /api/medications/:medicationId/guidelines`
  - Body includes `type` and relevant fields (validated).
- `GET /api/medications/:medicationId/guidelines`
- `GET /api/guidelines/:guidelineId`

## Files
- `POST /api/files`
  - Multipart upload; returns `{ fileId, url }`.
  - Accepted for photo observations only.

## Validation & errors
- Use DTO validation pipes. Common error codes:
  - `PATIENT_NOT_FOUND`, `EPISODE_NOT_FOUND`, `OBSERVATION_SCHEMA_INVALID`, `GUIDELINE_NOT_FOUND`.
  - `ATYPICAL_DOSE` includes payload `{ reason: 'exceeds_max_per_dose' | 'interval_too_short' }`.
  - Front-end is expected to handle warnings before finalizing save; API still stores atypical events with `isAtypical=true`.

## Real-time considerations
- No WebSocket in MVP. Front-end polls `/timeline` or `/dashboard`.

## Security
- JWT auth header `Authorization: Bearer <token>`.
- All routes revalidate that user is member of patient care team.

## Future (phase 2) placeholders
- `GET /api/patients/:patientId/doctors`, `POST /appointments`, etc. (not implemented yet).
