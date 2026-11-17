import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { CreateEpisodeRequest } from '@salud/shared/types';
import { EpisodeEventRefDto } from './episode-event-ref.dto';

// An empty `events` is a service check (EPISODE_EVENTS_REQUIRED), not ArrayNotEmpty, so the
// client gets a code it can show rather than class-validator prose (core/error-display.ts).
export class CreateEpisodeDto implements CreateEpisodeRequest {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsUUID('4')
  conditionId?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EpisodeEventRefDto)
  events!: EpisodeEventRefDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => EpisodeEventRefDto)
  resolvedBy?: EpisodeEventRefDto | null;
}
