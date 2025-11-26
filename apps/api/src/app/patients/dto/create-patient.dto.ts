import { IsDateString, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePatientDto {
  @IsString()
  @MinLength(1)
  fullName!: string;

  @IsDateString()
  dateOfBirth!: string;

  @IsIn(['female', 'male'])
  sexAtBirth!: 'female' | 'male';

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(['self', 'parent', 'co-parent', 'nanny', 'grandparent', 'babysitter', 'other'])
  myRole?: 'self' | 'parent' | 'co-parent' | 'nanny' | 'grandparent' | 'babysitter' | 'other';
}
