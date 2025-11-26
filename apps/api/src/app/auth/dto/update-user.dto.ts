import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  displayName?: string;

  @IsOptional()
  @IsIn(['C', 'F'])
  preferredTempUnit?: 'C' | 'F';

  @IsOptional()
  @IsIn(['cm', 'in'])
  preferredLengthUnit?: 'cm' | 'in';

  @IsOptional()
  @IsIn(['kg', 'lb', 'st'])
  preferredWeightUnit?: 'kg' | 'lb' | 'st';
}
