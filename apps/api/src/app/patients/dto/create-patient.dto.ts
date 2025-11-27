import { IsDateString, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import {
  CreatePatientDto as CreatePatientDtoShape,
  SexAtBirth,
  CareTeamRole,
} from '@salud/shared/types';

export class CreatePatientDto implements CreatePatientDtoShape {
  @IsString()
  @MinLength(1)
  fullName!: string;

  @IsDateString()
  dateOfBirth!: string;

  @IsIn(['female', 'male'])
  sexAtBirth!: SexAtBirth;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(['self', 'parent', 'co-parent', 'nanny', 'grandparent', 'babysitter', 'other'])
  myRole?: CareTeamRole;
}
