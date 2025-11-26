import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  @MinLength(1)
  displayName!: string;

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
