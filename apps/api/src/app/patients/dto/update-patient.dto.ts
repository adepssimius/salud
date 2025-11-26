import { IsDateString, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdatePatientDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsIn(['female', 'male'])
  sexAtBirth?: 'female' | 'male';

  @IsOptional()
  @IsString()
  notes?: string;
}
