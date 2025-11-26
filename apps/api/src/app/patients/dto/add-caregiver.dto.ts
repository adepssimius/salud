import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class AddCaregiverDto {
  @IsString()
  @MinLength(1)
  userId!: string;

  @IsOptional()
  @IsIn(['self', 'parent', 'co-parent', 'nanny', 'grandparent', 'babysitter', 'other'])
  role?: 'self' | 'parent' | 'co-parent' | 'nanny' | 'grandparent' | 'babysitter' | 'other';
}
