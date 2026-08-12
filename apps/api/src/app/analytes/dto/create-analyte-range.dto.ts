import { IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { AnalyteRangeKind } from '@salud/shared/types';

// No numeric bounds on low/high: lab values legitimately span orders of magnitude (TSH 0.04,
// TIBC 404), so an absurdity wall here would reject real standards. "At least one of low/high/
// refText" is a cross-field rule and lives in the service with its own code, per house style.
export class CreateAnalyteRangeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label!: string;

  // Defaults to 'custom' in the service. 'reference' marks the one lineage incoming reports are
  // compared against — a functional role, not a display one.
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

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string | null;
}
