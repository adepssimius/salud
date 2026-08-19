import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  // Nullable: an OIDC-only account (security.md → "OIDC login") has no password. Never NULL for a
  // password-registered account.
  passwordHash: text('password_hash'),
  // Authelia's `sub` claim. Nullable because a password-only account has never been through OIDC.
  // Once set, this is the authoritative match key for that account on every later login — email
  // alone would misroute a household member if their LDAP email is ever edited or reused.
  oidcSubject: text('oidc_subject').unique(),
  displayName: text('display_name').notNull(),
  preferredTempUnit: text('preferred_temp_unit', { enum: ['C', 'F'] }).notNull(),
  preferredLengthUnit: text('preferred_length_unit', { enum: ['cm', 'in'] }).notNull(),
  preferredWeightUnit: text('preferred_weight_unit', { enum: ['kg', 'lb', 'st'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const patients = pgTable('patients', {
  id: text('id').primaryKey(),
  fullName: text('full_name').notNull(),
  dateOfBirth: text('date_of_birth').notNull(), // ISO date
  sexAtBirth: text('sex_at_birth', { enum: ['female', 'male'] }).notNull(),
  notes: text('notes'),
  // Palette token, not a hex value, so the palette can be retuned without a migration
  // (data-model.md → Patient). Nullable only for rows written before the column existed;
  // every create assigns one, and the API resolves a legacy null to a stable per-id fallback
  // so `accentColor` is always a string on the wire.
  accentColor: text('accent_color'),
  latestWeightKg: doublePrecision('latest_weight_kg'),
  latestWeightRecordedAt: timestamp('latest_weight_recorded_at', { withTimezone: true, mode: 'date' }),
  ownedByUserId: text('owned_by_user_id')
    .notNull()
    .references(() => users.id),
  codeStatus: text('code_status'),
  codeStatusSetByUserId: text('code_status_set_by_user_id').references(() => users.id),
  codeStatusSetAt: timestamp('code_status_set_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const conditions = pgTable('conditions', {
  id: text('id').primaryKey(),
  patientId: text('patient_id')
    .notNull()
    .references(() => patients.id),
  name: text('name').notNull(),
  diagnosisText: text('diagnosis_text'),
  status: text('status', { enum: ['active', 'resolved'] }).notNull(),
  baselines: text('baselines'), // JSON array of strings
  devices: text('devices'), // JSON array of strings
  contacts: text('contacts'), // JSON array of {name, role, phone}
  createdByUserId: text('created_by_user_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const protocols = pgTable('protocols', {
  id: text('id').primaryKey(),
  conditionId: text('condition_id')
    .notNull()
    .references(() => conditions.id),
  name: text('name').notNull(),
  triggerMetric: text('trigger_metric', {
    enum: ['temperature', 'heart_rate', 'respiratory_rate', 'oxygen_saturation', 'pain_score'],
  }).notNull(),
  triggerOperator: text('trigger_operator', { enum: ['gte', 'lte'] }).notNull(),
  triggerValue: doublePrecision('trigger_value').notNull(),
  instructionText: text('instruction_text').notNull(),
  sourceText: text('source_text').notNull(),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const careTeamMemberships = pgTable('care_team_memberships', {
  id: text('id').primaryKey(),
  patientId: text('patient_id')
    .notNull()
    .references(() => patients.id),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  role: text('role', {
    enum: ['self', 'parent', 'co-parent', 'nanny', 'grandparent', 'babysitter', 'other'],
  }).notNull(),
  permissions: text('permissions', { enum: ['full'] }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const episodes = pgTable('episodes', {
  id: text('id').primaryKey(),
  patientId: text('patient_id')
    .notNull()
    .references(() => patients.id),
  conditionId: text('condition_id').references(() => conditions.id),
  name: text('name').notNull(),
  startedAtType: text('started_at_type', { enum: ['observation', 'intervention'] }).notNull(),
  startedAtId: text('started_at_id').notNull(),
  endedAtType: text('ended_at_type', { enum: ['observation', 'intervention'] }),
  endedAtId: text('ended_at_id'),
  status: text('status', { enum: ['active', 'resolved'] }).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const observations = pgTable('observations', {
  id: text('id').primaryKey(),
  patientId: text('patient_id')
    .notNull()
    .references(() => patients.id),
  recordedByUserId: text('recorded_by_user_id')
    .notNull()
    .references(() => users.id),
  observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' }).notNull(),
  text: text('text'),
  unitPreferenceAtEntry: text('unit_preference_at_entry'), // JSON string
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const observationEntries = pgTable('observation_entries', {
  id: text('id').primaryKey(),
  observationId: text('observation_id')
    .notNull()
    .references(() => observations.id),
  type: text('type', {
    enum: [
      'temperature',
      'heart_rate',
      'respiratory_rate',
      'oxygen_saturation',
      'pain_score',
      'weight',
      'height',
      'lesion_size',
      'symptom',
      'note',
      'tag',
      'photo',
      'lab_result',
      'document',
    ],
  }).notNull(),
  metadata: text('metadata'), // JSON string for structured fields
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const interventions = pgTable('interventions', {
  id: text('id').primaryKey(),
  patientId: text('patient_id')
    .notNull()
    .references(() => patients.id),
  recordedByUserId: text('recorded_by_user_id')
    .notNull()
    .references(() => users.id),
  performedAt: timestamp('performed_at', { withTimezone: true, mode: 'date' }).notNull(),
  type: text('type', { enum: ['medication_dose', 'dressing_change'] }).notNull(),
  scheduleId: text('schedule_id').references(() => interventionSchedules.id),
  notes: text('notes'),
  metadata: text('metadata'), // JSON string for type-specific payload
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const episodesEventsPivot = pgTable('episodes_events_pivot', {
  id: text('id').primaryKey(),
  episodeId: text('episode_id')
    .notNull()
    .references(() => episodes.id),
  eventType: text('event_type', { enum: ['observation', 'intervention'] }).notNull(),
  eventId: text('event_id').notNull(),
  startsEpisode: boolean('starts_episode').default(false).notNull(),
  resolvesEpisode: boolean('resolves_episode').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

// Lab-analyte catalog (data-model.md → "Analyte catalog"). Global like medications, populated by
// report ingestion rather than a seed. `name` is the lab's printed name verbatim; uniqueness is
// case-insensitive but enforced service-side, same reasoning as medications.name.
export const analytes = pgTable('analytes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  displayName: text('display_name').notNull(),
  unit: text('unit'),
  // The panel the analyte was first seen under, e.g. "IRON AND TOTAL IRON BINDING CAPACITY".
  // Context, not classification: "% Saturation" on its own says nothing about what is saturated.
  panel: text('panel'),
  // Null for an ordinary lab analyte; set makes this row the catalog entry FOR that vital sign.
  // Vitals are seeded rather than ingested, and reuse analyte_ranges for the household's normal
  // ranges — a temperature band is the same row shape as a ferritin reference range, so vitals
  // live here instead of in a parallel table (data-model.md -> "Analyte catalog").
  vitalMetric: text('vital_metric', {
    enum: ['temperature', 'heart_rate', 'respiratory_rate', 'oxygen_saturation', 'pain_score'],
  }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

// Every named band a value is read against — the lab's "Reference", an interpretation segment
// ("Optimal"), a personal target ("Athletic goal") — is one row here, belonging to one patient:
// what counts as normal depends on who was measured (data-model.md → AnalyteRange).
//
// Effective-dated per LINEAGE, where a lineage is (patientId, analyteId, kind, lower(label)):
// the row in effect at time t is the greatest effectiveFrom <= t within its own lineage. No
// effectiveTo — each row ends where the next in its lineage begins, so importing an older report
// inserts an earlier row without rewriting anything.
export const analyteRanges = pgTable('analyte_ranges', {
  id: text('id').primaryKey(),
  analyteId: text('analyte_id')
    .notNull()
    .references(() => analytes.id),
  patientId: text('patient_id')
    .notNull()
    .references(() => patients.id),
  // 'reference' is the single lineage the importer maintains and compares printed ranges against;
  // everything else is 'custom'. A functional distinction, not a display one — `label` carries
  // the meaning.
  kind: text('kind', { enum: ['reference', 'custom'] })
    .notNull()
    .default('custom'),
  label: text('label').notNull(),
  // One-sided ranges are normal, not degenerate: "Athletic goal" is low-only, "Deficiency" is
  // high-only. At least one of low/high/refText is required, enforced service-side.
  low: doublePrecision('low'),
  high: doublePrecision('high'),
  refText: text('ref_text'),
  effectiveFrom: timestamp('effective_from', { withTimezone: true, mode: 'date' }).notNull(),
  source: text('source'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const medications = pgTable('medications', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  brandNames: text('brand_names'), // JSON array string
  description: text('description'),
  tags: text('tags'), // JSON array string
  defaultActive: boolean('default_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const medicationEmbodiments = pgTable('medication_embodiments', {
  id: text('id').primaryKey(),
  medicationId: text('medication_id')
    .notNull()
    .references(() => medications.id),
  label: text('label').notNull(),
  // Derived per-mL figure (what the dosing engine reads) plus the printed pair it came from,
  // when the caregiver entered it as the bottle reads ("160 mg per 5 mL"). Keep all three in
  // lockstep -- embodiments.service.ts is the only writer.
  concentrationMgPerMl: doublePrecision('concentration_mg_per_ml'),
  concentrationMg: doublePrecision('concentration_mg'),
  concentrationVolumeMl: doublePrecision('concentration_volume_ml'),
  strengthMgPerUnit: doublePrecision('strength_mg_per_unit'),
  unitType: text('unit_type', {
    enum: ['tablet', 'capsule', 'ml', 'drop', 'other'],
  }).notNull(),
  notes: text('notes'),
  atHome: boolean('at_home').default(false).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  runningLow: boolean('running_low').default(false).notNull(),
  runningLowFlaggedByUserId: text('running_low_flagged_by_user_id').references(() => users.id),
  runningLowFlaggedAt: timestamp('running_low_flagged_at', { withTimezone: true, mode: 'date' }),
});

export const medicationGuidelines = pgTable('medication_guidelines', {
  id: text('id').primaryKey(),
  medicationId: text('medication_id')
    .notNull()
    .references(() => medications.id),
  medicationEmbodimentId: text('medication_embodiment_id').references(
    () => medicationEmbodiments.id,
  ),
  source: text('source').notNull(),
  type: text('type', { enum: ['weight_based', 'age_band'] }).notNull(),
  mgPerKg: doublePrecision('mg_per_kg'),
  maxMgPerDose: doublePrecision('max_mg_per_dose'),
  maxMgPerDay: doublePrecision('max_mg_per_day'),
  minIntervalHours: doublePrecision('min_interval_hours'),
  ageMinMonths: integer('age_min_months'),
  ageMaxMonths: integer('age_max_months'),
  doseMg: doublePrecision('dose_mg'),
  doseMl: doublePrecision('dose_ml'),
  pillCount: doublePrecision('pill_count'),
  frequencyPerDay: integer('frequency_per_day'),
  notes: text('notes'),
});

export const adverseReactions = pgTable('adverse_reactions', {
  id: text('id').primaryKey(),
  patientId: text('patient_id')
    .notNull()
    .references(() => patients.id),
  description: text('description').notNull(),
  // Nullable: null means "date not known" (data-model.md -> AdverseReaction).
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }),
  recordedByUserId: text('recorded_by_user_id')
    .notNull()
    .references(() => users.id),
  severity: text('severity', { enum: ['warning', 'danger'] }).notNull(),
  scopeType: text('scope_type', { enum: ['embodiment', 'medication', 'tag'] }).notNull(),
  medicationId: text('medication_id').references(() => medications.id),
  embodimentId: text('embodiment_id').references(() => medicationEmbodiments.id),
  tag: text('tag'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const interventionSchedules = pgTable('intervention_schedules', {
  id: text('id').primaryKey(),
  patientId: text('patient_id')
    .notNull()
    .references(() => patients.id),
  type: text('type', { enum: ['medication_dose', 'dressing_change'] }).notNull(),
  medicationId: text('medication_id').references(() => medications.id),
  medicationEmbodimentId: text('medication_embodiment_id').references(
    () => medicationEmbodiments.id,
  ),
  episodeId: text('episode_id').references(() => episodes.id),
  conditionId: text('condition_id').references(() => conditions.id),
  label: text('label').notNull(),
  doseMg: doublePrecision('dose_mg'),
  doseMl: doublePrecision('dose_ml'),
  pillCount: doublePrecision('pill_count'),
  bodyLocation: text('body_location'),
  side: text('side', { enum: ['left', 'right', 'bilateral', 'n/a'] }),
  dressingType: text('dressing_type'),
  frequencyHours: doublePrecision('frequency_hours'),
  explicitTimes: text('explicit_times'), // JSON array of times
  startAt: timestamp('start_at', { withTimezone: true, mode: 'date' }).notNull(),
  endAfterOccurrences: integer('end_after_occurrences'),
  endAt: timestamp('end_at', { withTimezone: true, mode: 'date' }),
  notes: text('notes'),
  status: text('status', { enum: ['active', 'completed', 'paused'] }).notNull(),
  nextDueAt: timestamp('next_due_at', { withTimezone: true, mode: 'date' }),
  createdByUserId: text('created_by_user_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const fileAssets = pgTable('file_assets', {
  id: text('id').primaryKey(),
  bucket: text('bucket').notNull(),
  path: text('path').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  // Client-supplied filename at upload time, display-only (data-model.md → FileAsset). Nullable:
  // files uploaded before this column existed have no name.
  originalName: text('original_name'),
  patientId: text('patient_id').references(() => patients.id),
  createdByUserId: text('created_by_user_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

// Living will / advance directive / medical PoA as patient-level standing state
// (data-model.md → CareDocumentStatement). Append-only: the current statement for a
// (patient_id, kind) is the newest row by set_at, and "replacing" a document inserts rather than
// updates, so what the household stated and when is never destroyed. Absence of any row is the
// third state — "not recorded" — and is deliberately different from a stored status of 'none'.
export const careDocumentStatements = pgTable('care_document_statements', {
  id: text('id').primaryKey(),
  patientId: text('patient_id')
    .notNull()
    .references(() => patients.id),
  kind: text('kind', {
    enum: ['living_will', 'advance_directive', 'medical_poa'],
  }).notNull(),
  status: text('status', { enum: ['on_file', 'none'] }).notNull(),
  // Required when status='on_file', absent when 'none' — enforced in the service, not the column,
  // since neither dialect expresses a conditional NOT NULL portably.
  fileId: text('file_id').references(() => fileAssets.id),
  // Accepted only on kind='medical_poa': a PoA is a person as well as a document.
  holderName: text('holder_name'),
  holderPhone: text('holder_phone'),
  setByUserId: text('set_by_user_id')
    .notNull()
    .references(() => users.id),
  setAt: timestamp('set_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  // Append ordinal within (patient_id, kind), 1-based. "Current" is the highest seq, NOT the
  // newest set_at: SQLite stores timestamps as integer *seconds*, so two statements recorded in
  // the same second — a caregiver fixing a mis-click straight away — tie, and which one is current
  // would come down to row order. Postgres's microsecond precision hides that, which is exactly
  // why this is ordered on an explicit counter instead of a clock.
  seq: integer('seq').notNull(),
});

export const advisories = pgTable('advisories', {
  id: text('id').primaryKey(),
  patientId: text('patient_id')
    .notNull()
    .references(() => patients.id),
  type: text('type', {
    enum: [
      'atypical_dose',
      'stale_weight',
      'expired_embodiment',
      'running_low',
      'reaction_warning',
      'reaction_danger',
      'protocol_fired',
    ],
  }).notNull(),
  severity: text('severity', { enum: ['info', 'warning', 'danger'] }).notNull(),
  sourceType: text('source_type', {
    enum: ['guideline', 'embodiment', 'reaction', 'protocol'],
  }),
  sourceId: text('source_id'),
  contextType: text('context_type', { enum: ['observation', 'intervention'] }),
  contextId: text('context_id'),
  payload: text('payload'), // JSON string
  acknowledgedByUserId: text('acknowledged_by_user_id').references(() => users.id),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

export const erBriefSnapshots = pgTable('er_brief_snapshots', {
  id: text('id').primaryKey(),
  patientId: text('patient_id')
    .notNull()
    .references(() => patients.id),
  episodeId: text('episode_id').references(() => episodes.id),
  token: text('token').notNull().unique(),
  payload: text('payload').notNull(), // JSON string — frozen ErBrief response
  // JSON string[] — the file_assets ids referenced by the frozen header.careDocuments, pinned at
  // creation so the token file route can authorize without parsing payload. Null on snapshots
  // frozen before this column existed; those simply have no token-readable files.
  fileIds: text('file_ids'),
  createdByUserId: text('created_by_user_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const revisions = pgTable('revisions', {
  id: text('id').primaryKey(),
  entityType: text('entity_type', {
    enum: ['observation', 'intervention', 'condition', 'patient'],
  }).notNull(),
  entityId: text('entity_id').notNull(),
  snapshot: text('snapshot').notNull(), // JSON string — full prior client-facing state
  editedByUserId: text('edited_by_user_id')
    .notNull()
    .references(() => users.id),
  editedAt: timestamp('edited_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});
