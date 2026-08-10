import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
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
  @IsUUID('4')
  medicationId?: string;

  @IsOptional()
  @IsUUID('4')
  medicationEmbodimentId?: string;

  @IsOptional()
  @IsIn(['weight_based', 'age_based', 'override', 'schedule'])
  doseSource?: 'weight_based' | 'age_based' | 'override' | 'schedule';

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100000)
  amountMg?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  amountMl?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  pillCount?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0.2)
  @Max(500)
  weightKgUsed?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1500)
  ageMonthsUsed?: number | null;

  @IsOptional()
  @IsUUID('4')
  guidelineId?: string | null;

  @IsOptional()
  @IsString()
  interventionScheduleId?: string | null;

  @IsOptional()
  @IsString()
  bodyLocation?: string;

  @IsOptional()
  @IsIn(['left', 'right', 'bilateral', 'n/a'])
  side?: 'left' | 'right' | 'bilateral' | 'n/a';

  @IsOptional()
  @IsString()
  dressingType?: string;
}
