import { Type } from 'class-transformer';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { UpdateEpisodeEventsRequest } from '@salud/shared/types';
import { EpisodeEventRefDto } from './episode-event-ref.dto';

export class UpdateEpisodeEventsDto implements UpdateEpisodeEventsRequest {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EpisodeEventRefDto)
  add?: EpisodeEventRefDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EpisodeEventRefDto)
  remove?: EpisodeEventRefDto[];
}
