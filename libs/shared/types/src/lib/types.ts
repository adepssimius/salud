// Units
export type TempUnit = 'C' | 'F';
export type LengthUnit = 'cm' | 'in';
export type WeightUnit = 'kg' | 'lb' | 'st';

// The display units a caregiver had on screen when recording an observation. Stamped by the client
// at create time — the server can't infer it (see api.md → Observations). Metadata values are
// already canonical; this is provenance, not a conversion instruction.
export interface UnitPreference {
  temp: TempUnit;
  weight: WeightUnit;
  length: LengthUnit;
}

// Enums / constrained strings
export type SexAtBirth = 'female' | 'male';
export type CareTeamRole =
  | 'self'
  | 'parent'
  | 'co-parent'
  | 'nanny'
  | 'grandparent'
  | 'babysitter'
  | 'other';

export type ObservationType =
  | 'temperature'
  | 'heart_rate'
  | 'respiratory_rate'
  | 'oxygen_saturation'
  | 'pain_score'
  | 'weight'
  | 'height'
  | 'lesion_size'
  | 'symptom'
  | 'note'
  | 'tag'
  | 'photo';

export interface ObservationEntry {
  id: string;
  type: ObservationType;
  metadata: Record<string, any> | null;
}

// Auth DTOs
export interface RegisterDto {
  email: string;
  password: string;
  displayName: string;
  preferredTempUnit?: TempUnit;
  preferredLengthUnit?: LengthUnit;
  preferredWeightUnit?: WeightUnit;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: UserProfile;
}

export interface UpdateUserDto {
  displayName?: string;
  preferredTempUnit?: TempUnit;
  preferredLengthUnit?: LengthUnit;
  preferredWeightUnit?: WeightUnit;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  preferredTempUnit: TempUnit;
  preferredLengthUnit: LengthUnit;
  preferredWeightUnit: WeightUnit;
}

// Patient DTOs
export interface CreatePatientDto {
  fullName: string;
  dateOfBirth: string; // ISO date
  sexAtBirth: SexAtBirth;
  notes?: string;
  myRole?: CareTeamRole;
}

export interface UpdatePatientDto {
  fullName?: string;
  dateOfBirth?: string; // ISO date
  sexAtBirth?: SexAtBirth;
  notes?: string | null;
  ownedById?: string;
  myRole?: CareTeamRole;
}

export interface Patient {
  id: string;
  fullName: string;
  dateOfBirth: string;
  sexAtBirth: SexAtBirth;
  notes: string | null;
  ownedById: string;
  latestWeightKg: number | null;
  latestWeightRecordedAt: number | null;
  myRole: CareTeamRole | null;
  // Set deliberately via PATCH /api/patients/:id/code-status (§4.1, F-7.2) — never through the
  // general patient PATCH. Client computes the display age ("set 14 months ago") from codeStatusSetAt.
  codeStatus: string | null;
  codeStatusSetByUserId: string | null;
  codeStatusSetAt: number | null; // epoch seconds
}

export interface UpdateCodeStatusDto {
  codeStatus: string;
}

export interface CareTeamMember {
  user: Pick<UserProfile, 'id' | 'email' | 'displayName'>;
  role: CareTeamRole;
}

export interface AddCaregiverDto {
  userId: string;
  role?: CareTeamRole;
}

// Observations
export interface Observation {
  id: string;
  patientId: string;
  recordedByUserId: string;
  observedAt: number; // epoch seconds
  text?: string | null;
  episodeIds: string[];
  resolvesEpisodeIds: string[];
  entries: ObservationEntry[];
  unitPreferenceAtEntry: UnitPreference | null;
  createdAt: number;
  updatedAt: number;
  // Only populated on the POST create response — the protocol_fired advisories (if any) this
  // specific save just triggered (api.md → "Observations"). Empty/absent on every other read.
  firedAdvisories?: Advisory[];
}

export interface CreateObservationDto {
  observedAt: string; // ISO datetime
  text?: string;
  startEpisodeName?: string;
  startEpisodeConditionId?: string; // nests the new episode under a standing Condition
  episodeIds?: string[];
  resolvesEpisodeIds?: string[];
  unitPreferenceAtEntry?: UnitPreference;
  entries: Array<{
    type: ObservationType;
    metadata?: Record<string, any>;
  }>;
}

export interface UpdateObservationDto {
  text?: string | null;
  episodeIds?: string[];
  resolvesEpisodeIds?: string[];
  entries?: Array<{
    id?: string;
    type: ObservationType;
    metadata?: Record<string, any>;
  }>;
}

// Interventions
export type InterventionType = 'medication_dose' | 'dressing_change';

export interface Intervention {
  id: string;
  patientId: string;
  recordedByUserId: string;
  performedAt: number; // epoch seconds
  type: InterventionType;
  scheduleId?: string | null;
  episodeIds: string[];
  resolvesEpisodeIds: string[];
  notes: string | null;
  metadata: Record<string, any> | null;
  createdAt: number;
  updatedAt: number;
}

export interface Episode {
  id: string;
  patientId: string;
  conditionId?: string | null;
  name: string;
  status: 'active' | 'resolved';
  startedAtType: 'observation' | 'intervention';
  startedAtId: string;
  endedAtType?: 'observation' | 'intervention' | null;
  endedAtId?: string | null;
  // Derived at query time from the linked start/end event (data-model.md → Episode).
  startedAt?: number | null; // epoch seconds
  endedAt?: number | null; // epoch seconds
  notes?: string | null;
  // Only returned by GET /api/episodes/:episodeId, not by the list routes. Ids only — for the
  // hydrated events, call GET /api/patients/:patientId/timeline?episodeId=...
  observationIds?: string[];
  interventionIds?: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface CreateInterventionDto {
  performedAt: string; // ISO datetime
  type: InterventionType;
  startEpisodeName?: string;
  startEpisodeConditionId?: string; // nests the new episode under a standing Condition
  episodeIds?: string[];
  resolvesEpisodeIds?: string[];
  notes?: string;
  medicationId?: string;
  medicationEmbodimentId?: string;
  doseSource?: 'weight_based' | 'age_based' | 'override';
  amountMg?: number;
  amountMl?: number | null;
  pillCount?: number | null;
  weightKgUsed?: number | null;
  ageMonthsUsed?: number | null;
  guidelineId?: string | null;
  interventionScheduleId?: string | null;
  bodyLocation?: string;
  side?: 'left' | 'right' | 'bilateral' | 'n/a';
  dressingType?: string;
  metadata?: Record<string, any>;
}

export interface UpdateInterventionDto {
  episodeIds?: string[];
  resolvesEpisodeIds?: string[];
  notes?: string | null;
  metadata?: Record<string, any>;
  // type-specific updates allowed; guidelines optional
  medicationId?: string;
  medicationEmbodimentId?: string;
  doseSource?: 'weight_based' | 'age_based' | 'override';
  amountMg?: number;
  amountMl?: number | null;
  pillCount?: number | null;
  weightKgUsed?: number | null;
  ageMonthsUsed?: number | null;
  guidelineId?: string | null;
  interventionScheduleId?: string | null;
  bodyLocation?: string;
  side?: 'left' | 'right' | 'bilateral' | 'n/a';
  dressingType?: string;
}

// Medication catalog — not patient-scoped (shared by the whole household, P4)
export type MedicationUnitType = 'tablet' | 'capsule' | 'ml' | 'drop' | 'other';
export type GuidelineType = 'weight_based' | 'age_band';

export interface Medication {
  id: string;
  name: string;
  brandNames: string[];
  description: string | null;
  tags: string[];
  defaultActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateMedicationDto {
  name: string;
  brandNames?: string[];
  description?: string;
  tags?: string[];
  defaultActive?: boolean;
}

export interface UpdateMedicationDto {
  name?: string;
  brandNames?: string[];
  description?: string | null;
  tags?: string[];
  defaultActive?: boolean;
}

export interface MedicationEmbodiment {
  id: string;
  medicationId: string;
  label: string;
  concentrationMgPerMl: number | null;
  strengthMgPerUnit: number | null;
  unitType: MedicationUnitType;
  notes: string | null;
  // Cabinet awareness (F-9.1–F-9.3) — deliberately no inventory counts (F-9.4)
  atHome: boolean;
  expiresAt: number | null; // epoch seconds
  runningLow: boolean;
  runningLowFlaggedByUserId: string | null;
  runningLowFlaggedAt: number | null; // epoch seconds
}

export interface CreateEmbodimentDto {
  label: string;
  concentrationMgPerMl?: number | null;
  strengthMgPerUnit?: number | null;
  unitType: MedicationUnitType;
  notes?: string;
}

export interface UpdateEmbodimentDto {
  label?: string;
  concentrationMgPerMl?: number | null;
  strengthMgPerUnit?: number | null;
  unitType?: MedicationUnitType;
  notes?: string;
  atHome?: boolean;
  expiresAt?: string | null; // ISO datetime on write
  runningLow?: boolean; // server stamps runningLowFlaggedByUserId/At from the requester
}

export interface MedicationGuideline {
  id: string;
  medicationId: string;
  medicationEmbodimentId: string | null;
  source: string;
  type: GuidelineType;
  mgPerKg: number | null;
  maxMgPerDose: number | null;
  maxMgPerDay: number | null;
  minIntervalHours: number | null;
  ageMinMonths: number | null;
  ageMaxMonths: number | null;
  doseMg: number | null;
  doseMl: number | null;
  pillCount: number | null;
  frequencyPerDay: number | null;
  notes: string | null;
}

export interface CreateGuidelineDto {
  medicationEmbodimentId?: string;
  source: string;
  type: GuidelineType;
  mgPerKg?: number;
  maxMgPerDose?: number;
  maxMgPerDay?: number;
  minIntervalHours?: number;
  ageMinMonths?: number;
  ageMaxMonths?: number;
  doseMg?: number;
  doseMl?: number;
  pillCount?: number;
  frequencyPerDay?: number;
  notes?: string;
}

export interface UpdateGuidelineDto {
  medicationEmbodimentId?: string | null;
  source?: string;
  mgPerKg?: number;
  maxMgPerDose?: number;
  maxMgPerDay?: number;
  minIntervalHours?: number;
  ageMinMonths?: number;
  ageMaxMonths?: number;
  doseMg?: number;
  doseMl?: number;
  pillCount?: number;
  frequencyPerDay?: number;
  notes?: string;
}

// Advisories — see app-spec/advisories.md for the concept
export type AdvisoryType =
  | 'atypical_dose'
  | 'stale_weight'
  | 'expired_embodiment'
  | 'running_low'
  | 'reaction_warning'
  | 'reaction_danger'
  | 'protocol_fired';

export type AdvisorySeverity = 'info' | 'warning' | 'danger';

export type AdvisorySourceType = 'guideline' | 'embodiment' | 'reaction' | 'protocol';

export interface Advisory {
  id: string;
  patientId: string;
  type: AdvisoryType;
  severity: AdvisorySeverity;
  sourceType: AdvisorySourceType | null;
  sourceId: string | null;
  contextType: 'observation' | 'intervention' | null;
  contextId: string | null;
  payload: Record<string, any> | null;
  acknowledgedByUserId: string | null;
  acknowledgedAt: number | null; // epoch seconds
  createdAt: number;
  updatedAt: number;
}

// An unpersisted advisory — returned by preview endpoints like dose-checks
export interface AdvisoryCandidate {
  type: AdvisoryType;
  severity: AdvisorySeverity;
  sourceType?: AdvisorySourceType;
  sourceId?: string;
  payload?: Record<string, any>;
}

// Dosing engine — see app-spec/api.md "Dosing engine"
export interface DoseCheckDto {
  medicationId: string;
  medicationEmbodimentId?: string;
  amountMg?: number;
  occurredAt?: string; // ISO datetime; defaults to now
}

export interface WeightBasedGuidance {
  guidelineId: string;
  source: string;
  mgPerKg: number;
  computedMg: number;
  maxMgPerDose: number | null;
  maxMgPerDay: number | null;
  minIntervalHours: number | null;
  weightKgUsed: number;
  weightRecordedAt: number | null; // epoch seconds
}

export interface AgeBandGuidance {
  guidelineId: string;
  source: string;
  doseMg: number | null;
  doseMl: number | null;
  pillCount: number | null;
  frequencyPerDay: number | null;
  maxMgPerDay: number | null;
  ageMonthsUsed: number;
  applicable: boolean;
}

export interface DoseCheckResult {
  guidance: {
    weightBased: WeightBasedGuidance | null;
    ageBand: AgeBandGuidance | null;
  };
  nextAllowedAt: number | null; // epoch seconds
  dailyTotalMg: number;
  advisories: AdvisoryCandidate[];
}

// Intervention schedules — see app-spec/data-model.md "InterventionSchedule"
export type ScheduleType = InterventionType;
export type ScheduleStatus = 'active' | 'paused' | 'completed';

export interface ScheduleAdherence {
  expectedCount: number;
  loggedCount: number;
  missed: number;
  remainingOccurrences: number | null;
  overdue: boolean;
}

export interface InterventionSchedule {
  id: string;
  patientId: string;
  type: ScheduleType;
  medicationId: string | null;
  medicationEmbodimentId: string | null;
  episodeId: string | null;
  conditionId: string | null;
  label: string;
  doseMg: number | null;
  doseMl: number | null;
  pillCount: number | null;
  bodyLocation: string | null;
  side: 'left' | 'right' | 'bilateral' | 'n/a' | null;
  dressingType: string | null;
  frequencyHours: number | null;
  explicitTimes: string[] | null;
  startAt: number; // epoch seconds
  endAfterOccurrences: number | null;
  endAt: number | null; // epoch seconds
  notes: string | null;
  status: ScheduleStatus;
  nextDueAt: number | null; // epoch seconds
  createdByUserId: string;
  createdAt: number;
  updatedAt: number;
  adherence: ScheduleAdherence;
}

export interface CreateScheduleDto {
  type: ScheduleType;
  label: string;
  episodeId?: string;
  conditionId?: string;
  medicationId?: string;
  medicationEmbodimentId?: string;
  doseMg?: number;
  doseMl?: number;
  pillCount?: number;
  bodyLocation?: string;
  side?: 'left' | 'right' | 'bilateral' | 'n/a';
  dressingType?: string;
  frequencyHours?: number;
  explicitTimes?: string[];
  startAt: string; // ISO datetime
  endAfterOccurrences?: number;
  endAt?: string; // ISO datetime
  notes?: string;
}

export interface UpdateScheduleDto {
  label?: string;
  episodeId?: string | null;
  conditionId?: string | null;
  medicationId?: string;
  medicationEmbodimentId?: string;
  doseMg?: number;
  doseMl?: number;
  pillCount?: number;
  bodyLocation?: string;
  side?: 'left' | 'right' | 'bilateral' | 'n/a';
  dressingType?: string;
  frequencyHours?: number;
  explicitTimes?: string[];
  endAfterOccurrences?: number;
  endAt?: string | null;
  notes?: string;
  status?: ScheduleStatus;
}

export interface LogScheduleDto {
  performedAt?: string; // ISO datetime; defaults to now
  notes?: string;
}

// Conditions — see app-spec/data-model.md "Condition"
export type ConditionStatus = 'active' | 'resolved';

export interface ConditionContact {
  name: string;
  role: string;
  phone: string;
}

export interface Condition {
  id: string;
  patientId: string;
  name: string;
  diagnosisText: string | null;
  status: ConditionStatus;
  baselines: string[];
  devices: string[];
  contacts: ConditionContact[];
  createdByUserId: string;
  createdAt: number;
  updatedAt: number;
  // Only populated by GET /api/conditions/:id (api.md → "Conditions").
  episodeIds?: string[];
  scheduleIds?: string[];
  protocols?: Protocol[];
}

export interface CreateConditionDto {
  name: string;
  diagnosisText?: string;
  status?: ConditionStatus;
  baselines?: string[];
  devices?: string[];
  contacts?: ConditionContact[];
}

export interface UpdateConditionDto {
  name?: string;
  diagnosisText?: string | null;
  status?: ConditionStatus;
  baselines?: string[];
  devices?: string[];
  contacts?: ConditionContact[];
}

// Protocols — see app-spec/data-model.md "Protocol"
export type ProtocolTriggerMetric =
  | 'temperature'
  | 'heart_rate'
  | 'respiratory_rate'
  | 'oxygen_saturation'
  | 'pain_score';
export type ProtocolTriggerOperator = 'gte' | 'lte';

export interface Protocol {
  id: string;
  conditionId: string;
  name: string;
  triggerMetric: ProtocolTriggerMetric;
  triggerOperator: ProtocolTriggerOperator;
  triggerValue: number;
  instructionText: string;
  sourceText: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateProtocolDto {
  name: string;
  triggerMetric: ProtocolTriggerMetric;
  triggerOperator: ProtocolTriggerOperator;
  triggerValue: number;
  instructionText: string;
  sourceText: string;
  active?: boolean;
}

export interface UpdateProtocolDto {
  name?: string;
  triggerMetric?: ProtocolTriggerMetric;
  triggerOperator?: ProtocolTriggerOperator;
  triggerValue?: number;
  instructionText?: string;
  sourceText?: string;
  active?: boolean;
}

// Adverse reactions — see app-spec/data-model.md "AdverseReaction"
export type ReactionSeverity = 'warning' | 'danger';
export type ReactionScopeType = 'embodiment' | 'medication' | 'tag';

export interface AdverseReaction {
  id: string;
  patientId: string;
  description: string;
  occurredAt: number; // epoch seconds
  recordedByUserId: string;
  severity: ReactionSeverity;
  scopeType: ReactionScopeType;
  medicationId: string | null;
  embodimentId: string | null;
  tag: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateReactionDto {
  description: string;
  occurredAt: string; // ISO datetime
  severity: ReactionSeverity;
  scopeType: ReactionScopeType;
  medicationId?: string;
  embodimentId?: string;
  tag?: string;
}

// Timeline — see app-spec/api.md "Timeline & dashboard"
export interface TimelineEntry {
  id: string;
  kind: 'observation' | 'intervention' | 'advisory';
  type: string;
  timestamp: number; // epoch seconds
  display: Observation | Intervention | Advisory;
}

export interface WeightPrompt {
  needsUpdate: boolean;
  lastRecordedAt: number | null;
  daysSince: number | null;
}

export interface TimelineResponse {
  patient: Patient;
  entries: TimelineEntry[];
  weightPrompt: WeightPrompt;
}

// Dashboard
export interface DashboardMedicationSummary {
  medicationId: string;
  medicationName: string;
  lastDoseAt: number; // epoch seconds
  nextAllowedAt: number | null;
  isAtypicalLastDose: boolean;
}

/** Most recent dose of one medication for one patient, inside the 24-hour window. */
export interface DashboardLastDose {
  medicationId: string;
  medicationName: string;
  lastDoseAt: number; // epoch seconds
  /** Frozen at log time, not recomputed. null = no guideline supplied an interval. */
  nextAllowedAt: number | null;
  isAtypicalLastDose: boolean;
}

/**
 * One row per accessible patient — emitted even when `doses` is empty, because "nothing given in the
 * last 24 hours" is the answer at 3 AM, not the absence of one (api.md → `GET /api/dashboard`).
 * Kept separate from DashboardMedicationSummary despite the matching fields: that one is
 * episode-scoped over the episode's lifetime, this one is patient-scoped over 24 hours.
 */
export interface DashboardPatientLastDoses {
  patientId: string;
  patientName: string;
  doses: DashboardLastDose[]; // most recent first
}

/**
 * The "While You Were Asleep" diff reduced to counts, so the dashboard card renders from the one
 * dashboard request instead of calling GET /patients/:id/whats-new per patient. The full hydrated
 * diff still lives on that endpoint — it's what whats-new.page.ts renders.
 *
 * Like DashboardPatientLastDoses, one row per accessible patient, **all-zero rows included**.
 * frontend.md's "the card shows only when the diff is non-empty" is a client render rule over this
 * array, not a filter the server performs — keeping the row makes "nothing changed" distinguishable
 * from "this patient dropped out of the payload".
 */
export interface DashboardWhatsNewSummary {
  patientId: string;
  patientName: string;
  /** This caller's own watermark for this patient; 24h ago when they have never acked. */
  since: number; // epoch seconds
  /** Observations + interventions since `since`, on clinical time. Advisories are counted below. */
  eventCount: number;
  /**
   * Every advisory type created since `since`, **acknowledged ones included** — so this is NOT the
   * same number as `DashboardPayload.unacknowledgedAdvisories.length`.
   */
  advisoryCount: number;
  /** Present-tense: what is due right now, independent of the watermark. */
  nowDueCount: number;
}

export interface DashboardActiveEpisode {
  patientId: string;
  patientName: string;
  episodeId: string;
  name: string;
  startedAt: number | null;
  lastObservationSummary: { observedAt: number; entries: ObservationEntry[] } | null;
  medications: DashboardMedicationSummary[];
}

export interface DashboardUpcomingSchedule {
  scheduleId: string;
  patientId: string;
  label: string;
  type: ScheduleType;
  episodeId: string | null;
  nextDueAt: number | null;
  overdue: boolean;
}

export interface DashboardShoppingListItem {
  embodimentId: string;
  medicationId: string;
  medicationName: string;
  label: string;
  runningLowFlaggedAt: number | null;
}

export interface DashboardPayload {
  lastDoses: DashboardPatientLastDoses[];
  whatsNew: DashboardWhatsNewSummary[];
  activeEpisodes: DashboardActiveEpisode[];
  upcomingSchedules: DashboardUpcomingSchedule[];
  shoppingList: DashboardShoppingListItem[];
  unacknowledgedAdvisories: Advisory[];
}

// ER Brief — see app-spec/er-brief.md. P6 is enforced by this shape: no summary/assessment/
// effectiveness field exists anywhere on it.
export interface ErBriefHeaderPatient {
  id: string;
  fullName: string;
  dateOfBirth: string;
  sexAtBirth: SexAtBirth;
  ageYears: number;
  ageMonths: number;
}

export interface ErBriefWeight {
  kg: number;
  recordedAt: number; // epoch seconds
}

export interface ErBriefCodeStatus {
  value: string;
  setByUserId: string;
  setByName: string;
  setAt: number; // epoch seconds
}

export interface ErBriefProtocolFiredReason {
  protocolName: string;
  instructionText: string;
  sourceText: string;
  triggerMetric: ProtocolTriggerMetric;
  triggerOperator: ProtocolTriggerOperator;
  triggerValue: number;
  observedValue: number;
  firedAt: number; // epoch seconds
}

export interface ErBriefHeader {
  patient: ErBriefHeaderPatient;
  latestWeight: ErBriefWeight | null;
  codeStatus: ErBriefCodeStatus | null;
  dangerReactions: AdverseReaction[];
  activeConditions: Condition[];
  protocolFiredReason: ErBriefProtocolFiredReason | null;
}

export interface ErBriefEpisodeSummary {
  id: string;
  name: string;
  status: 'active' | 'resolved';
  startedAt: number | null;
  endedAt: number | null;
}

export interface ErBriefActiveSchedule {
  scheduleId: string;
  label: string;
  medicationId: string | null;
  medicationName: string | null;
  lastDoseAt: number | null;
  lastDoseMg: number | null;
  lastDoseMgPerKg: number | null;
  nextAllowedAt: number | null;
}

export interface ErBriefBody {
  episode: ErBriefEpisodeSummary | null;
  events: TimelineEntry[];
  activeSchedules: ErBriefActiveSchedule[];
  priorEpisodes: ErBriefEpisodeSummary[];
  atypicalAdvisories: Advisory[];
}

export interface ErBrief {
  header: ErBriefHeader;
  body: ErBriefBody;
}

export interface CreateErBriefSnapshotDto {
  episodeId?: string;
  expiresInHours?: number;
}

export interface ErBriefSnapshotResponse {
  token: string;
  url: string;
  expiresAt: number; // epoch seconds
}

export interface SharedErBriefResponse {
  payload: ErBrief;
  frozenAt: number; // epoch seconds
  expiresAt: number; // epoch seconds
}

// Deliberately omits the token — a snapshot's link is handed out once, at creation, the same way
// a downloaded credential is; this list exists so a caregiver can find and revoke a link they no
// longer want live, not to re-surface it.
export interface ErBriefSnapshotSummary {
  id: string;
  episodeId: string | null;
  createdByUserId: string;
  createdAt: number; // epoch seconds
  expiresAt: number; // epoch seconds
}

// While You Were Asleep — see app-spec/api.md "While You Were Asleep"
export interface WhatsNewResponse {
  since: number; // epoch seconds
  events: TimelineEntry[];
  advisoriesFired: Advisory[];
  nowDue: DashboardUpcomingSchedule[];
}

export interface AckWhatsNewResponse {
  ackedAt: number; // epoch seconds
}

// Corrections — see app-spec/data-model.md "Revision"
export type RevisionEntityType = 'observation' | 'intervention' | 'condition' | 'patient';

export interface Revision {
  id: string;
  entityType: RevisionEntityType;
  entityId: string;
  snapshot: Record<string, any>;
  editedByUserId: string;
  editedAt: number; // epoch seconds
}

// Files — see app-spec/api.md "Files"
export interface UploadFileResponse {
  fileId: string;
  url: string;
}
