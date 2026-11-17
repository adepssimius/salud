import { IsIn, IsUUID } from 'class-validator';
import { EpisodeEventRef } from '@salud/shared/types';

export class EpisodeEventRefDto implements EpisodeEventRef {
  @IsIn(['observation', 'intervention'])
  type!: EpisodeEventRef['type'];

  @IsUUID('4')
  id!: string;
}
