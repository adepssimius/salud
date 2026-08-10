import { IsDateString, IsOptional, IsString } from 'class-validator';
import { IsNotInFuture } from '../../common/validators';

export class LogScheduleDto {
  @IsOptional()
  @IsDateString()
  @IsNotInFuture()
  performedAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
