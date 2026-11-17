import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsInt,
  IsNumber,
  Max,
  Min,
  IsOptional,
  IsString,
} from 'class-validator';
import { InterventionType } from '@salud/shared/types';

export class CreateScheduleDto {
  @IsIn(['medication_dose', 'dressing_change'] satisfies InterventionType[])
  type!: InterventionType;

  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsOptional()
  @IsString()
  episodeId?: string;

  @IsOptional()
  @IsString()
  conditionId?: string;

  @IsOptional()
  @IsString()
  medicationId?: string;

  @IsOptional()
  @IsString()
  medicationEmbodimentId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100000)
  doseMg?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(1000)
  doseMl?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.25)
  @Max(100)
  pillCount?: number;

  @IsOptional()
  @IsString()
  bodyLocation?: string;

  @IsOptional()
  @IsIn(['left', 'right', 'bilateral', 'n/a'])
  side?: 'left' | 'right' | 'bilateral' | 'n/a';

  @IsOptional()
  @IsString()
  dressingType?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.25)
  @Max(8760)
  frequencyHours?: number;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  explicitTimes?: string[];

  // IANA zone (e.g. "America/Chicago") the explicitTimes are wall-clock times in. The web sends
  // the browser's zone; an unknown zone is rejected in the service as INVALID_TIME_ZONE so the
  // code reaches the user rather than a generic validation message.
  @IsOptional()
  @IsString()
  timeZone?: string;

  // No @IsNotInFuture here, deliberately: a course starts and ends in the future by definition
  // (api.md -> Conventions). Same for endAt below.
  @IsDateString()
  startAt!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  endAfterOccurrences?: number;

  @IsOptional()
  @IsDateString()
  endAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
