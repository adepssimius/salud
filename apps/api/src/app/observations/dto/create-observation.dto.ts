import { Type } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, IsArray, IsDateString, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, Validate, ValidateNested } from 'class-validator';
import { LengthUnit, ObservationType, TempUnit, WeightUnit } from '@salud/shared/types';
import { EntryMetadataConstraint } from './entry-metadata.dto';

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
  @IsEnum([
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

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ObservationEntryDto)
  entries!: ObservationEntryDto[];
}
