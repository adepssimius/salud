import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { CreateErBriefSnapshotDto as CreateErBriefSnapshotDtoShape } from '@salud/shared/types';

export class CreateSnapshotDto implements CreateErBriefSnapshotDtoShape {
  @IsOptional()
  @IsUUID('4')
  episodeId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  expiresInHours?: number;
}
