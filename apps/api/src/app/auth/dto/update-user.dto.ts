import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import {
  UpdateUserDto as UpdateUserDtoShape,
  TempUnit,
  LengthUnit,
  WeightUnit,
} from '@salud/shared/types';

export class UpdateUserDto implements UpdateUserDtoShape {
  @IsOptional()
  @IsString()
  @MinLength(1)
  displayName?: string;

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
