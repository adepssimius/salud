import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Validate,
  ValidateNested,
} from 'class-validator';
import {
  ObservationType,
  UpdateObservationDto as UpdateObservationContract,
  UpdateObservationEntry,
} from '@salud/shared/types';
import { EntryMetadataConstraint } from './entry-metadata.dto';
import { IsNotInFuture } from '../../common/validators';

class UpdateObservationEntryDto implements UpdateObservationEntry {
  @IsOptional()
  @IsString()
  id?: string;

  // Every type create accepts round-trips, lab_result and document included (ISSUES #32;
  // api.md → PATCH /api/observations/:observationId).
  @IsIn([
    'temperature',
    'heart_rate',
    'respiratory_rate',
    'oxygen_saturation',
    'pain_score',
    'weight',
    'height',
    'lesion_size',
    'symptom',
    'note',
    'tag',
    'photo',
    'lab_result',
    'document',
  ] satisfies ObservationType[])
  type!: ObservationType;

  @Validate(EntryMetadataConstraint)
  metadata?: Record<string, any>;
}

/**
 * The correction body. The fields a correction may NOT change (`unitPreferenceAtEntry`,
 * attribution, `createdAt`, the episode-start fields) are deliberately absent here; they are
 * refused with FIELD_NOT_CORRECTABLE by `CorrectionFieldsInterceptor` on the raw body, before this
 * class's whitelist could strip them silently.
 */
export class UpdateObservationDto implements UpdateObservationContract {
  @IsOptional()
  @IsDateString()
  @IsNotInFuture()
  observedAt?: string;

  @IsOptional()
  @IsString()
  text?: string | null;

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

  // No @ArrayMinSize(1), for the reason given on CreateObservationDto.entries: the service throws
  // AT_LEAST_ONE_ENTRY_REQUIRED, which the client has a sentence for.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateObservationEntryDto)
  entries?: UpdateObservationEntryDto[];
}
