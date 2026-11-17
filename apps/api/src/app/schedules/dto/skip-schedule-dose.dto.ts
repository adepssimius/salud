import { IsInt, IsOptional, Min } from 'class-validator';
import { SkipScheduleDoseRequest } from '@salud/shared/types';

export class SkipScheduleDoseDto implements SkipScheduleDoseRequest {
  /** Epoch seconds of the slot to skip; must be the current missed slot. Omitted: that slot. */
  @IsOptional()
  @IsInt()
  @Min(0)
  slotAt?: number;
}
