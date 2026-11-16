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
import {
  CorrectableDoseSource,
  UpdateInterventionDto as UpdateInterventionContract,
} from '@salud/shared/types';
import { IsNotInFuture } from '../../common/validators';

/**
 * The correction body. `type` and `interventionScheduleId` are deliberately absent, and
 * `doseSource` lists only the correctable sources: those are refused with FIELD_NOT_CORRECTABLE
 * by `CorrectionFieldsInterceptor` on the raw body, before this class's whitelist (or `@IsIn`)
 * could swallow them (ISSUES #36; api.md → PATCH /api/interventions/:interventionId).
 */
export class UpdateInterventionDto implements UpdateInterventionContract {
  @IsOptional()
  @IsDateString()
  @IsNotInFuture()
  performedAt?: string;

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
  @IsIn(['weight_based', 'age_based', 'override'] satisfies CorrectableDoseSource[])
  doseSource?: CorrectableDoseSource;

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
  bodyLocation?: string;

  @IsOptional()
  @IsIn(['left', 'right', 'bilateral', 'n/a'])
  side?: 'left' | 'right' | 'bilateral' | 'n/a';

  @IsOptional()
  @IsString()
  dressingType?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}
