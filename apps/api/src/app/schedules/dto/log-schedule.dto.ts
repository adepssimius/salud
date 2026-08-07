import { IsDateString, IsOptional, IsString } from 'class-validator';

export class LogScheduleDto {
  @IsOptional()
  @IsDateString()
  performedAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
