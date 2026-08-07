import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { InterventionType } from '@salud/shared/types';

export class CreateScheduleDto {
  @IsEnum(['medication_dose', 'dressing_change'] satisfies InterventionType[])
  type!: InterventionType;

  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsOptional()
  @IsString()
  episodeId?: string;

  @IsOptional()
  @IsString()
  conditionId?: string;

  @IsOptional()
  @IsString()
  medicationId?: string;

  @IsOptional()
  @IsString()
  medicationEmbodimentId?: string;

  @IsOptional()
  @IsNumber()
  doseMg?: number;

  @IsOptional()
  @IsNumber()
  doseMl?: number;

  @IsOptional()
  @IsNumber()
  pillCount?: number;

  @IsOptional()
  @IsString()
  bodyLocation?: string;

  @IsOptional()
  @IsIn(['left', 'right', 'bilateral', 'n/a'])
  side?: 'left' | 'right' | 'bilateral' | 'n/a';

  @IsOptional()
  @IsString()
  dressingType?: string;

  @IsOptional()
  @IsNumber()
  frequencyHours?: number;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  explicitTimes?: string[];

  @IsDateString()
  startAt!: string;

  @IsOptional()
  @IsNumber()
  endAfterOccurrences?: number;

  @IsOptional()
  @IsDateString()
  endAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
