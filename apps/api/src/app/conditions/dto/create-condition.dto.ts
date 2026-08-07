import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  ConditionContact,
  ConditionStatus,
  CreateConditionDto as CreateConditionDtoShape,
} from '@salud/shared/types';

class ConditionContactDto implements ConditionContact {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  role!: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;
}

export class CreateConditionDto implements CreateConditionDtoShape {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  diagnosisText?: string;

  @IsOptional()
  @IsIn(['active', 'resolved'])
  status?: ConditionStatus;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  baselines?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  devices?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConditionContactDto)
  contacts?: ConditionContactDto[];
}
