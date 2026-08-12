import { IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { AnalyteRangeKind } from '@salud/shared/types';

// Hand-written all-optional twin rather than PartialType — house style throughout this API.
export class UpdateAnalyteRangeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsIn(['reference', 'custom'] satisfies AnalyteRangeKind[])
  kind?: AnalyteRangeKind;

  @IsOptional()
  @IsNumber()
  low?: number | null;

  @IsOptional()
  @IsNumber()
  high?: number | null;

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
