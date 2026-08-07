import { ArrayNotEmpty, IsArray, IsDateString, IsEnum, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { ScheduleStatus } from '@salud/shared/types';

export class UpdateScheduleDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @IsOptional()
  @IsString()
  episodeId?: string | null;

  @IsOptional()
  @IsString()
  conditionId?: string | null;

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

  @IsOptional()
  @IsNumber()
  endAfterOccurrences?: number;

  @IsOptional()
  @IsDateString()
  endAt?: string | null;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(['active', 'paused', 'completed'] satisfies ScheduleStatus[])
  status?: ScheduleStatus;
}
