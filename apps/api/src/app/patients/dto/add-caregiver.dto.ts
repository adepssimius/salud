import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { AddCaregiverDto as AddCaregiverDtoShape, CareTeamRole } from '@salud/shared/types';

export class AddCaregiverDto implements AddCaregiverDtoShape {
  @IsString()
  @MinLength(1)
  userId!: string;

  @IsOptional()
  @IsIn(['self', 'parent', 'co-parent', 'nanny', 'grandparent', 'babysitter', 'other'])
  role?: CareTeamRole;
}
