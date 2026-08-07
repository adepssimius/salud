import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ArrayUnique, ValidateNested, IsEnum, Validate } from 'class-validator';
import { ObservationType } from '@salud/shared/types';
import { EntryMetadataConstraint } from './entry-metadata.dto';

class UpdateObservationEntryDto {
  @IsOptional()
  @IsString()
  id?: string;

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

export class UpdateObservationDto {
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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateObservationEntryDto)
  entries?: UpdateObservationEntryDto[];
}
