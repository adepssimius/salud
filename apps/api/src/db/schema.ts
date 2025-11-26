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
  passwordHash: text('password_hash').notNull(),
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
  latestWeightKg: real('latest_weight_kg', { mode: 'number' }),
  latestWeightRecordedAt: integer('latest_weight_recorded_at', { mode: 'timestamp' }),
  createdByUserId: text('created_by_user_id')
    .notNull()
    .references(() => users.id),
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
  role: text('role', { enum: ['self', 'parent', 'co-parent', 'nanny', 'other'] }).notNull(),
  permissions: text('permissions', { enum: ['full'] }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(now()).notNull(),
});

export const episodes = sqliteTable('episodes', {
  id: text('id').primaryKey(),
  patientId: text('patient_id')
    .notNull()
    .references(() => patients.id),
  name: text('name').notNull(),
  startedAtObservationId: text('started_at_observation_id'),
  resolvedAtObservationId: text('resolved_at_observation_id'),
  status: text('status', { enum: ['active', 'resolved'] }).notNull(),
  notes: text('notes'),
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
      'photo',
    ],
  }).notNull(),
  text: text('text'),
  unitPreferenceAtEntry: text('unit_preference_at_entry'), // JSON string
  symptomTags: text('symptom_tags'), // JSON array string
  episodeTags: text('episode_tags'), // JSON array string
  metadata: text('metadata'), // JSON string for structured fields
  resolvesEpisodeIds: text('resolves_episode_ids'), // JSON array string
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
  episodeTags: text('episode_tags'), // JSON array string
  resolvesEpisodeIds: text('resolves_episode_ids'), // JSON array string
  notes: text('notes'),
  metadata: text('metadata'), // JSON string for type-specific payload
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(now()).notNull(),
});

export const medications = sqliteTable('medications', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
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

export const symptomTags = sqliteTable('symptom_tags', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  category: text('category', { enum: ['respiratory', 'GI', 'derm', 'other'] }).notNull(),
});

export const fileAssets = sqliteTable('file_assets', {
  id: text('id').primaryKey(),
  bucket: text('bucket').notNull(),
  path: text('path').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdByUserId: text('created_by_user_id')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(now()).notNull(),
});
