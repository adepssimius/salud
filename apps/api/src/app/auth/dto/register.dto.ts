import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import {
  RegisterDto as RegisterDtoShape,
  TempUnit,
  LengthUnit,
  WeightUnit,
} from '@salud/shared/types';

export class RegisterDto implements RegisterDtoShape {
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
  preferredTempUnit?: TempUnit;

  @IsOptional()
  @IsIn(['cm', 'in'])
  preferredLengthUnit?: LengthUnit;

  @IsOptional()
  @IsIn(['kg', 'lb', 'st'])
  preferredWeightUnit?: WeightUnit;
}
