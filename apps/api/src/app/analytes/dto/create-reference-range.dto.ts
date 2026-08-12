import { IsDateString, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

// At least one of refLow/refHigh/refText is required — checked in the service against the merged
// row, since a partial PATCH can empty a range in a way no per-field validator can see
// (400 ANALYTE_RANGE_EMPTY). No numeric bounds: lab values span orders of magnitude.
export class CreateReferenceRangeDto {
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

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string | null;
}
