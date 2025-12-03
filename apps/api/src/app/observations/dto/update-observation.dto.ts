import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ArrayUnique, ValidateNested, IsEnum } from 'class-validator';
import { ObservationType } from '@salud/shared/types';

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
    'photo',
  ] satisfies ObservationType[])
  type!: ObservationType;

  @IsOptional()
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
  symptomTags?: string[];

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
