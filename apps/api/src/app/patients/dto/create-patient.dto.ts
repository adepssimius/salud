import { IsDateString, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import {
  CreatePatientDto as CreatePatientDtoShape,
  SexAtBirth,
  CareTeamRole,
  PatientAccentColor,
} from '@salud/shared/types';
import { IsNotInFuture } from '../../common/validators';
import { PATIENT_ACCENT_COLORS } from '../accent-colors';

export class CreatePatientDto implements CreatePatientDtoShape {
  @IsString()
  @MinLength(1)
  fullName!: string;

  @IsDateString()
  @IsNotInFuture()
  dateOfBirth!: string;

  @IsIn(['female', 'male'])
  sexAtBirth!: SexAtBirth;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(['self', 'parent', 'co-parent', 'nanny', 'grandparent', 'babysitter', 'other'])
  myRole?: CareTeamRole;

  // Omitted is the normal case: the server picks the least-used token (api.md → Patients). An
  // unknown token is an ordinary validation 400, not a silent fall back to the default — a color
  // the caller did not choose is exactly the wrong answer for a field whose whole job is telling
  // one child's record from another's.
  @IsOptional()
  @IsIn(PATIENT_ACCENT_COLORS)
  accentColor?: PatientAccentColor;
}
