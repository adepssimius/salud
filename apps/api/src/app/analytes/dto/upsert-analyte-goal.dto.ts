import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

// A goal needs at least one bound — checked in the service (400 ANALYTE_GOAL_EMPTY), since
// "neither field present" is a cross-field rule.
export class UpsertAnalyteGoalDto {
  @IsOptional()
  @IsNumber()
  goalLow?: number | null;

  @IsOptional()
  @IsNumber()
  goalHigh?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
