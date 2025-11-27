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
