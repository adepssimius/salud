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
- `createdByUserId: uuid` (creator auto-added as caregiver)
- `createdAt`, `updatedAt`

### CareTeamMembership
- `id: uuid`
- `patientId: uuid`
- `userId: uuid`
- `role: enum('self','parent','co-parent','nanny','grandparent','babysitter','other')`
- `permissions: enum('full')` (placeholder for future granular roles)
- Constraints:
  - Patient creator auto-inserted with role `self` if they are the patient or `parent` otherwise.
  - Every patient must have at least one membership where `userId` equals a user flagged as the patient (self-care).

### Episode
- `id: uuid`
- `patientId: uuid`
- `name: string` (e.g., "Fever Jan 2025")
- `startedAtObservationId: uuid` (any observation/intervention that marks start)
- `resolvedAtObservationId: uuid | null` (null until an observation marked as resolving)
- `status: enum('active','resolved')`
- `notes: text`
- Derived fields computed at query time: `startedAt`, `resolvedAt` from linked events.

### Observation (base)
- `id: uuid`
- `patientId: uuid`
- `recordedByUserId: uuid`
- `observedAt: datetime`
- `type: enum('temperature','heart_rate','respiratory_rate','oxygen_saturation','pain_score','weight','height','lesion_size','symptom','note','photo')`
- `text: text` (free-form notes)
- `unitPreferenceAtEntry: jsonb` (capture original units for conversions)
- `symptomTags: string[]` (only from predefined set)
- `episodeTags: uuid[]` (episodes this observation belongs to; can be many)
- `metadata: jsonb` (type-specific structured data, detailed below)
- `resolvesEpisodeIds: uuid[]` (episodes resolved by this observation)
- `createdAt`, `updatedAt`

#### Observation structured metadata
All numeric values stored in canonical units.

| Type | Metadata fields |
| --- | --- |
| temperature | `valueC: decimal(4,1)`, `inputUnit: enum('C','F')`, `method: enum('oral','tympanic','axillary','rectal','temporal','unknown')` |
| heart_rate | `bpm: integer` |
| respiratory_rate | `breathsPerMin: integer` |
| oxygen_saturation | `percent: integer` |
| pain_score | `score: integer (0-10)` |
| weight | `kg: decimal(4,2)` |
| height | `cm: decimal(5,2)` |
| lesion_size | `lengthCm: decimal`, `widthCm: decimal | null`, `depthCm: decimal | null`, `bodyLocation: string`, `side: enum('left','right','bilateral','n/a')` |
| symptom | `tag: string (from fixed list)`, `severity: enum('mild','moderate','severe') | null` |
| photo | `fileId: uuid`, `bodyLocation: string`, `side: enum(...)`, `sizeCm: decimal`, `notes: string` |
| note | no extra fields |

### Intervention (base)
- `id: uuid`
- `patientId: uuid`
- `recordedByUserId: uuid`
- `performedAt: datetime`
- `type: enum('medication_dose','dressing_change')`
- `episodeTags: uuid[]`
- `resolvesEpisodeIds: uuid[]`
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
  - `interventionScheduleId: uuid | null`
  - `nextAllowedAt: datetime`
  - `isAtypical: boolean`
  - `atypicalReason: string | null`
- Dressing change:
  - `bodyLocation: string`
  - `side: enum('left','right','bilateral','n/a')`
  - `dressingType: string`

### Medication
- `id: uuid`
- `name: string`
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


### SymptomTag
- `id: uuid`
- `label: string` (e.g., "cough")
- `category: enum('respiratory','GI','derm','other')`
- Pre-populated list; used by observation `symptomTags`.

### FileAsset
- `id: uuid`
- `bucket: string` (placeholder; local storage path in MVP)
- `path: string`
- `contentType: string`
- `sizeBytes: integer`
- `createdByUserId: uuid`
- Linked to photo observations.

## Derived/computed data
- `TimelineEntry` (query projection): merges observations + interventions sorted by timestamp.
- `PatientActiveEpisodes`: query episodes where `status = 'active'`.
- `LatestWeightPromptFlag`: computed when `now - latestWeightRecordedAt > 60 days`.
- `InterventionScheduleUpcoming`: `nextDueAt` soon => dashboard notification.

## Data integrity rules
- Observations/interventions must belong to at least one patient.
- Episode start/end observation IDs must reference events that have the episode tag.
- Medication dose `weightKgUsed` required when `doseSource = 'weight_based'`.
- `isAtypical` set true when:
  - `amountMg` > `maxMgPerDose` or cumulative daily mg exceeds `maxMgPerDay`.
  - `performedAt` earlier than `nextAllowedAt` computed from guideline interval.
- `resolvesEpisodeIds` on observations/interventions must reference episodes already in `episodeTags`.
- `episodeId` on `InterventionSchedule` optional; when provided, schedule must tag interventions to same episode.
- Enforce canonical units at persistence boundary; convert in API/UI.
