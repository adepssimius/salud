import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  Validate,
  ValidateIf,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { GuidelineType } from '@salud/shared/types';

const GUIDELINE_TYPES: GuidelineType[] = ['weight_based', 'age_band'];

// Note on the bounds below: @ValidateIf gates *every* validation on a property, so the @Min/@Max
// pairs inherit the same condition as the @IsNumber they sit with. That is what we want — an
// age_band guideline shouldn't be range-checked on mgPerKg it never supplies.

// An inverted band matches no patient and fails silently: guidance simply never appears, with
// nothing on screen to say why. @ValidateIf can't express this — it gates, it doesn't compare —
// so this is a constraint class. Attached to ageMaxMonths rather than ageMinMonths so the message
// points at the field more likely to have been mistyped.
//
// This only catches the both-supplied case, which is all a DTO can see. GuidelinesService applies
// the same rule to the merged row, and that check is the authoritative one — a PATCH supplying only
// one half is invisible here.
@ValidatorConstraint({ name: 'ageRangeOrdered', async: false })
export class AgeRangeOrderedConstraint implements ValidatorConstraintInterface {
  validate(max: unknown, args: ValidationArguments): boolean {
    const min = (args.object as { ageMinMonths?: unknown }).ageMinMonths;
    if (typeof min !== 'number' || typeof max !== 'number') return true;
    return min <= max;
  }

  defaultMessage(): string {
    return 'GUIDELINE_AGE_RANGE_INVALID';
  }
}

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
  @Min(0.01)
  @Max(1000)
  mgPerKg?: number;

  @ValidateIf((o) => o.type === 'weight_based')
  @IsNumber()
  @Min(0.01)
  @Max(100000)
  maxMgPerDose?: number;

  @ValidateIf((o) => o.type === 'weight_based')
  @IsNumber()
  @Min(0.25)
  @Max(168)
  minIntervalHours?: number;

  // required for both types
  @IsNumber()
  @Min(0.01)
  @Max(100000)
  maxMgPerDay!: number;

  // optional applicable-age-range on weight_based; required on age_band
  @ValidateIf((o) => o.type === 'age_band' || o.ageMinMonths !== undefined)
  @IsInt()
  @Min(0)
  @Max(1500)
  ageMinMonths?: number;

  @ValidateIf((o) => o.type === 'age_band' || o.ageMaxMonths !== undefined)
  @IsInt()
  @Min(0)
  @Max(1500)
  @Validate(AgeRangeOrderedConstraint)
  ageMaxMonths?: number;

  // age_band required
  @ValidateIf((o) => o.type === 'age_band')
  @IsNumber()
  @Min(0.01)
  @Max(100000)
  doseMg?: number;

  @ValidateIf((o) => o.type === 'age_band')
  @IsInt()
  @Min(1)
  @Max(24)
  frequencyPerDay?: number;

  // optional on age_band
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
  notes?: string;
}
