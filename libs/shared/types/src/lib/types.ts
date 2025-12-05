// Units
export type TempUnit = 'C' | 'F';
export type LengthUnit = 'cm' | 'in';
export type WeightUnit = 'kg' | 'lb' | 'st';

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
  symptomTags: string[];
  episodeIds: string[];
  resolvesEpisodeIds: string[];
  entries: ObservationEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateObservationDto {
  observedAt: string; // ISO datetime
  text?: string;
  symptomTags?: string[];
  startEpisodeName?: string;
  episodeIds?: string[];
  resolvesEpisodeIds?: string[];
  entries: Array<{
    type: ObservationType;
    metadata?: Record<string, any>;
  }>;
}

export interface UpdateObservationDto {
  text?: string | null;
  symptomTags?: string[];
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
  interventionScheduleId?: string | null;
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
  name: string;
  status: 'active' | 'resolved';
  startedAtType: 'observation' | 'intervention';
  startedAtId: string;
  endedAtType?: 'observation' | 'intervention' | null;
  endedAtId?: string | null;
  notes?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface CreateInterventionDto {
  performedAt: string; // ISO datetime
  type: InterventionType;
  startEpisodeName?: string;
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
