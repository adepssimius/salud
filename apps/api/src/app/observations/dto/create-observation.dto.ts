import { Type } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, IsArray, IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ObservationType } from '@salud/shared/types';

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
    'photo',
  ] satisfies ObservationType[])
  type!: ObservationType;

  @IsOptional()
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
  @IsString()
  startEpisodeName?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ObservationEntryDto)
  entries!: ObservationEntryDto[];
}
