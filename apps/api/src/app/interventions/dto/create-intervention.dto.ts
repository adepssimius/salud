import {
  ArrayUnique,
  IsArray,
  IsDateString,
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
import { IsNotInFuture } from '../../common/validators';

export class CreateInterventionDto {
  @IsDateString()
  @IsNotInFuture()
  performedAt!: string;

  @IsIn(['medication_dose', 'dressing_change'] satisfies InterventionType[])
  type!: InterventionType;

  @IsOptional()
  @IsString()
  startEpisodeName?: string;

  @IsOptional()
  @IsString()
  startEpisodeConditionId?: string;

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
  notes?: string;

  // Required when type === 'medication_dose'; enforced in InterventionsService, which also checks
  // it against the merged row on update. Without it the dosing engine's gate never fires and every
  // advisory silently skips.
  @IsOptional()
  @IsUUID('4')
  medicationId?: string;

  @IsOptional()
  @IsUUID('4')
  medicationEmbodimentId?: string;

  // 'schedule' is written by the schedule-log path, never sent by a client — see api.md.
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

  // Same bounds as a weight observation entry — it feeds the same mg/kg math.
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
