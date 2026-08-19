import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import {
  UpdatePatientDto as UpdatePatientDtoShape,
  SexAtBirth,
  CareTeamRole,
  PatientAccentColor,
} from '@salud/shared/types';
import { IsNotInFuture } from '../../common/validators';
import { PATIENT_ACCENT_COLORS } from '../accent-colors';

export class UpdatePatientDto implements UpdatePatientDtoShape {
  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;

  @IsOptional()
  @IsDateString()
  @IsNotInFuture()
  dateOfBirth?: string;

  @IsOptional()
  @IsIn(['female', 'male'])
  sexAtBirth?: SexAtBirth;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID('4')
  ownedById?: string;

  @IsOptional()
  @IsIn(['self', 'parent', 'co-parent', 'nanny', 'grandparent', 'babysitter', 'other'])
  myRole?: CareTeamRole;

  @IsOptional()
  @IsIn(PATIENT_ACCENT_COLORS)
  accentColor?: PatientAccentColor;
}
