import { IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';
import { IsNotInFuture } from '../../common/validators';

export class LogScheduleDto {
  @IsOptional()
  @IsDateString()
  @IsNotInFuture()
  performedAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Log the prescribed double ("take two next time"); 400 DOUBLE_DOSE_NOT_DUE unless in force. */
  @IsOptional()
  @IsBoolean()
  double?: boolean;
}
