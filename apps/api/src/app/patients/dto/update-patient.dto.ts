import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import {
  UpdatePatientDto as UpdatePatientDtoShape,
  SexAtBirth,
  CareTeamRole,
} from '@salud/shared/types';

export class UpdatePatientDto implements UpdatePatientDtoShape {
  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;

  @IsOptional()
  @IsDateString()
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
}
