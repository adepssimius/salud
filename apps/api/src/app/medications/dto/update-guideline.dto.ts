import { IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import type { GuidelineUnderDose } from '@salud/shared/types';

// Bounds mirror CreateGuidelineDto. There is deliberately no age-range ordering constraint here:
// both halves are independently optional, so `PATCH { ageMinMonths: 200 }` against a row whose max
// is 60 is invisible to any DTO. GuidelinesService.update checks the merged row instead, and that
// is the authoritative implementation.
export class UpdateGuidelineDto {
  @IsOptional()
  @IsString()
  medicationEmbodimentId?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  source?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(1000)
  mgPerKg?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100000)
  maxMgPerDose?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100000)
  maxMgPerDay?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.25)
  @Max(168)
  minIntervalHours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1500)
  ageMinMonths?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1500)
  ageMaxMonths?: number;

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
  @IsInt()
  @Min(1)
  @Max(24)
  frequencyPerDay?: number;

  // Whether a dose below this guideline's dose is fine or atypical (data-model.md ->
  // MedicationGuideline). Defaults to 'allowed' on create. The values are inlined, not imported:
  // tools/seed-catalog.ts loads this DTO under plain ts-node, where @salud/shared/types only
  // resolves for type-only imports.
  @IsOptional()
  @IsIn(['allowed', 'flagged'] satisfies GuidelineUnderDose[])
  underDose?: GuidelineUnderDose;

  @IsOptional()
  @IsString()
  notes?: string;
}
