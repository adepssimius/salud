import { IsDateString, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateReferenceRangeDto {
  @IsOptional()
  @IsNumber()
  refLow?: number | null;

  @IsOptional()
  @IsNumber()
  refHigh?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  refText?: string | null;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string | null;
}
