import { ArrayUnique, IsArray, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { InterventionType } from '@salud/shared/types';

export class UpdateInterventionDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  episodeIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  resolvesEpisodeIds?: string[];

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsString()
  medicationId?: string;

  @IsOptional()
  @IsString()
  medicationEmbodimentId?: string;

  @IsOptional()
  @IsEnum(['weight_based', 'age_based', 'override'])
  doseSource?: 'weight_based' | 'age_based' | 'override';

  @IsOptional()
  @IsNumber()
  amountMg?: number;

  @IsOptional()
  @IsNumber()
  amountMl?: number | null;

  @IsOptional()
  @IsNumber()
  pillCount?: number | null;

  @IsOptional()
  @IsNumber()
  weightKgUsed?: number | null;

  @IsOptional()
  @IsNumber()
  ageMonthsUsed?: number | null;

  @IsOptional()
  @IsString()
  guidelineId?: string | null;

  @IsOptional()
  @IsString()
  interventionScheduleId?: string | null;

  @IsOptional()
  @IsString()
  bodyLocation?: string;

  @IsOptional()
  @IsEnum(['left', 'right', 'bilateral', 'n/a'])
  side?: 'left' | 'right' | 'bilateral' | 'n/a';

  @IsOptional()
  @IsString()
  dressingType?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}
