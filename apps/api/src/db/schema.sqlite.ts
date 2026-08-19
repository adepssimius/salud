import {
  integer,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const now = () => sql`(strftime('%s','now'))`;

export const users = sqliteTable('users', {
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
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(now()).notNull(),
});

export const patients = sqliteTable('patients', {
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
  latestWeightKg: real('latest_weight_kg'),
  latestWeightRecordedAt: integer('latest_weight_recorded_at', { mode: 'timestamp' }),
  ownedByUserId: text('owned_by_user_id')
    .notNull()
    .references(() => users.id),
  codeStatus: text('code_status'),
  codeStatusSetByUserId: text('code_status_set_by_user_id').references(() => users.id),
  codeStatusSetAt: integer('code_status_set_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(now()).notNull(),
});

export const conditions = sqliteTable('conditions', {
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
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(now()).notNull(),
});

export const protocols = sqliteTable('protocols', {
  id: text('id').primaryKey(),
  conditionId: text('condition_id')
    .notNull()
    .references(() => conditions.id),
  name: text('name').notNull(),
  triggerMetric: text('trigger_metric', {
    enum: ['temperature', 'heart_rate', 'respiratory_rate', 'oxygen_saturation', 'pain_score'],
  }).notNull(),
  triggerOperator: text('trigger_operator', { enum: ['gte', 'lte'] }).notNull(),
  triggerValue: real('trigger_value').notNull(),
  instructionText: text('instruction_text').notNull(),
  sourceText: text('source_text').notNull(),
  active: integer('active', { mode: 'boolean' }).default(true).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(now()).notNull(),
});

export const careTeamMemberships = sqliteTable('care_team_memberships', {
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
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(now()).notNull(),
});

export const episodes = sqliteTable('episodes', {
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
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(now()).notNull(),
});

export const observations = sqliteTable('observations', {
  id: text('id').primaryKey(),
  patientId: text('patient_id')
    .notNull()
    .references(() => patients.id),
  recordedByUserId: text('recorded_by_user_id')
    .notNull()
    .references(() => users.id),
  observedAt: integer('observed_at', { mode: 'timestamp' }).notNull(),
  text: text('text'),
  unitPreferenceAtEntry: text('unit_preference_at_entry'), // JSON string
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(now()).notNull(),
});

export const observationEntries = sqliteTable('observation_entries', {
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
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(now()).notNull(),
});

export const interventions = sqliteTable('interventions', {
  id: text('id').primaryKey(),
  patientId: text('patient_id')
    .notNull()
    .references(() => patients.id),
  recordedByUserId: text('recorded_by_user_id')
    .notNull()
    .references(() => users.id),
  performedAt: integer('performed_at', { mode: 'timestamp' }).notNull(),
  type: text('type', { enum: ['medication_dose', 'dressing_change'] }).notNull(),
  scheduleId: text('schedule_id').references(() => interventionSchedules.id),
  notes: text('notes'),
  metadata: text('metadata'), // JSON string for type-specific payload
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(now()).notNull(),
});

export const episodesEventsPivot = sqliteTable('episodes_events_pivot', {
  id: text('id').primaryKey(),
  episodeId: text('episode_id')
    .notNull()
    .references(() => episodes.id),
  eventType: text('event_type', { enum: ['observation', 'intervention'] }).notNull(),
  eventId: text('event_id').notNull(),
  startsEpisode: integer('starts_episode', { mode: 'boolean' }).default(false).notNull(),
  resolvesEpisode: integer('resolves_episode', { mode: 'boolean' }).default(false).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(now()).notNull(),
});

// Lab-analyte catalog (data-model.md → "Analyte catalog"). Global like medications, populated by
// report ingestion rather than a seed. `name` is the lab's printed name verbatim; uniqueness is
// case-insensitive but enforced service-side, same reasoning as medications.name.
export const analytes = sqliteTable('analytes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  displayName: text('display_name').notNull(),
  unit: text('unit'),
  // The panel the analyte was first seen under, e.g. "IRON AND TOTAL IRON BINDING CAPACITY".
  // Context, not classification: "% Saturation" on its own says nothing about what is saturated.
  panel: text('panel'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(now()).notNull(),
});

// Every named band a value is read against — the lab's "Reference", an interpretation segment
// ("Optimal"), a personal target ("Athletic goal") — is one row here, belonging to one patient:
// what counts as normal depends on who was measured (data-model.md → AnalyteRange).
//
// Effective-dated per LINEAGE, where a lineage is (patientId, analyteId, kind, lower(label)):
// the row in effect at time t is the greatest effectiveFrom <= t within its own lineage. No
// effectiveTo — each row ends where the next in its lineage begins, so importing an older report
// inserts an earlier row without rewriting anything.
export const analyteRanges = sqliteTable('analyte_ranges', {
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
  low: real('low'),
  high: real('high'),
  refText: text('ref_text'),
  effectiveFrom: integer('effective_from', { mode: 'timestamp' }).notNull(),
  source: text('source'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(now()).notNull(),
});

export const medications = sqliteTable('medications', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  brandNames: text('brand_names'), // JSON array string
  description: text('description'),
  tags: text('tags'), // JSON array string
  defaultActive: integer('default_active', { mode: 'boolean' }).default(true).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(now()).notNull(),
});

export const medicationEmbodiments = sqliteTable('medication_embodiments', {
  id: text('id').primaryKey(),
  medicationId: text('medication_id')
    .notNull()
    .references(() => medications.id),
  label: text('label').notNull(),
  concentrationMgPerMl: real('concentration_mg_per_ml'),
  strengthMgPerUnit: real('strength_mg_per_unit'),
  unitType: text('unit_type', {
    enum: ['tablet', 'capsule', 'ml', 'drop', 'other'],
  }).notNull(),
  notes: text('notes'),
  atHome: integer('at_home', { mode: 'boolean' }).default(false).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  runningLow: integer('running_low', { mode: 'boolean' }).default(false).notNull(),
  runningLowFlaggedByUserId: text('running_low_flagged_by_user_id').references(() => users.id),
  runningLowFlaggedAt: integer('running_low_flagged_at', { mode: 'timestamp' }),
});

export const medicationGuidelines = sqliteTable('medication_guidelines', {
  id: text('id').primaryKey(),
  medicationId: text('medication_id')
    .notNull()
    .references(() => medications.id),
  medicationEmbodimentId: text('medication_embodiment_id').references(
    () => medicationEmbodiments.id,
  ),
  source: text('source').notNull(),
  type: text('type', { enum: ['weight_based', 'age_band'] }).notNull(),
  mgPerKg: real('mg_per_kg'),
  maxMgPerDose: real('max_mg_per_dose'),
  maxMgPerDay: real('max_mg_per_day'),
  minIntervalHours: real('min_interval_hours'),
  ageMinMonths: integer('age_min_months'),
  ageMaxMonths: integer('age_max_months'),
  doseMg: real('dose_mg'),
  doseMl: real('dose_ml'),
  pillCount: real('pill_count'),
  frequencyPerDay: integer('frequency_per_day'),
  notes: text('notes'),
});

export const adverseReactions = sqliteTable('adverse_reactions', {
  id: text('id').primaryKey(),
  patientId: text('patient_id')
    .notNull()
    .references(() => patients.id),
  description: text('description').notNull(),
  // Nullable: null means "date not known" (data-model.md -> AdverseReaction).
  occurredAt: integer('occurred_at', { mode: 'timestamp' }),
  recordedByUserId: text('recorded_by_user_id')
    .notNull()
    .references(() => users.id),
  severity: text('severity', { enum: ['warning', 'danger'] }).notNull(),
  scopeType: text('scope_type', { enum: ['embodiment', 'medication', 'tag'] }).notNull(),
  medicationId: text('medication_id').references(() => medications.id),
  embodimentId: text('embodiment_id').references(() => medicationEmbodiments.id),
  tag: text('tag'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(now()).notNull(),
});

export const interventionSchedules = sqliteTable('intervention_schedules', {
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
  doseMg: real('dose_mg'),
  doseMl: real('dose_ml'),
  pillCount: real('pill_count'),
  bodyLocation: text('body_location'),
  side: text('side', { enum: ['left', 'right', 'bilateral', 'n/a'] }),
  dressingType: text('dressing_type'),
  frequencyHours: real('frequency_hours'),
  explicitTimes: text('explicit_times'), // JSON array of times
  startAt: integer('start_at', { mode: 'timestamp' }).notNull(),
  endAfterOccurrences: integer('end_after_occurrences'),
  endAt: integer('end_at', { mode: 'timestamp' }),
  notes: text('notes'),
  status: text('status', { enum: ['active', 'completed', 'paused'] }).notNull(),
  nextDueAt: integer('next_due_at', { mode: 'timestamp' }),
  createdByUserId: text('created_by_user_id')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(now()).notNull(),
});

export const fileAssets = sqliteTable('file_assets', {
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
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
});

export const advisories = sqliteTable('advisories', {
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
  acknowledgedAt: integer('acknowledged_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(now()).notNull(),
});

export const erBriefSnapshots = sqliteTable('er_brief_snapshots', {
  id: text('id').primaryKey(),
  patientId: text('patient_id')
    .notNull()
    .references(() => patients.id),
  episodeId: text('episode_id').references(() => episodes.id),
  token: text('token').notNull().unique(),
  payload: text('payload').notNull(), // JSON string — frozen ErBrief response
  createdByUserId: text('created_by_user_id')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
});

export const revisions = sqliteTable('revisions', {
  id: text('id').primaryKey(),
  entityType: text('entity_type', {
    enum: ['observation', 'intervention', 'condition', 'patient'],
  }).notNull(),
  entityId: text('entity_id').notNull(),
  snapshot: text('snapshot').notNull(), // JSON string — full prior client-facing state
  editedByUserId: text('edited_by_user_id')
    .notNull()
    .references(() => users.id),
  editedAt: integer('edited_at', { mode: 'timestamp' }).default(now()).notNull(),
});
