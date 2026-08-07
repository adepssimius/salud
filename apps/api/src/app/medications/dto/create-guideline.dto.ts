import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateIf } from 'class-validator';
import { GuidelineType } from '@salud/shared/types';

const GUIDELINE_TYPES: GuidelineType[] = ['weight_based', 'age_band'];

export class CreateGuidelineDto {
  @IsOptional()
  @IsString()
  medicationEmbodimentId?: string;

  @IsString()
  @IsNotEmpty()
  source!: string;

  @IsIn(GUIDELINE_TYPES)
  type!: GuidelineType;

  // weight_based required
  @ValidateIf((o) => o.type === 'weight_based')
  @IsNumber()
  mgPerKg?: number;

  @ValidateIf((o) => o.type === 'weight_based')
  @IsNumber()
  maxMgPerDose?: number;

  @ValidateIf((o) => o.type === 'weight_based')
  @IsNumber()
  minIntervalHours?: number;

  // required for both types
  @IsNumber()
  maxMgPerDay!: number;

  // optional applicable-age-range on weight_based; required on age_band
  @ValidateIf((o) => o.type === 'age_band' || o.ageMinMonths !== undefined)
  @IsNumber()
  ageMinMonths?: number;

  @ValidateIf((o) => o.type === 'age_band' || o.ageMaxMonths !== undefined)
  @IsNumber()
  ageMaxMonths?: number;

  // age_band required
  @ValidateIf((o) => o.type === 'age_band')
  @IsNumber()
  doseMg?: number;

  @ValidateIf((o) => o.type === 'age_band')
  @IsNumber()
  frequencyPerDay?: number;

  // optional on age_band
  @IsOptional()
  @IsNumber()
  doseMl?: number;

  @IsOptional()
  @IsNumber()
  pillCount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
