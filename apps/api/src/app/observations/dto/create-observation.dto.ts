import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, Validate, ValidateNested } from 'class-validator';
import { LengthUnit, ObservationType, TempUnit, WeightUnit } from '@salud/shared/types';
import { EntryMetadataConstraint } from './entry-metadata.dto';
import { IsNotInFuture } from '../../common/validators';

// All three keys required when the object is present — a partial snapshot of "what was on screen"
// is worse than none, since a reader can't tell which units were defaulted.
class UnitPreferenceDto {
  @IsIn(['C', 'F'] satisfies TempUnit[])
  temp!: TempUnit;

  @IsIn(['kg', 'lb', 'st'] satisfies WeightUnit[])
  weight!: WeightUnit;

  @IsIn(['cm', 'in'] satisfies LengthUnit[])
  length!: LengthUnit;
}

class ObservationEntryDto {
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
  ] satisfies ObservationType[])
  type!: ObservationType;

  @Validate(EntryMetadataConstraint)
  metadata?: Record<string, any>;
}
export class CreateObservationDto {
  @IsDateString()
  @IsNotInFuture()
  observedAt!: string;

  @IsOptional()
  @IsString()
  text?: string;

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
  startEpisodeName?: string;

  @IsOptional()
  @IsString()
  startEpisodeConditionId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => UnitPreferenceDto)
  unitPreferenceAtEntry?: UnitPreferenceDto;

  // No @ArrayMinSize(1): it fired first and produced class-validator prose
  // ("entries must contain at least 1 elements"), which error-display.ts deliberately never shows
  // -- so the caregiver got a generic fallback instead of the AT_LEAST_ONE_ENTRY_REQUIRED sentence
  // already sitting in the catalog. ObservationsService throws that code instead.
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ObservationEntryDto)
  entries!: ObservationEntryDto[];
}
