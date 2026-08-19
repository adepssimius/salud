import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { MedicationUnitType } from '@salud/shared/types';

const UNIT_TYPES: MedicationUnitType[] = ['tablet', 'capsule', 'ml', 'drop', 'other'];

export class CreateEmbodimentDto {
  @IsString()
  @IsNotEmpty()
  label!: string;

  // Two ways in, one stored truth. `concentrationMgPerMl` is the figure the dosing engine reads;
  // the `concentrationMg` / `concentrationVolumeMl` pair is what the bottle actually prints
  // ("160 mg per 5 mL"), from which the service derives the per-mL figure. Sending both forms is
  // rejected rather than reconciled -- see api.md -> "Concentration: the label pair vs. mg/mL".
  @IsOptional()
  @IsNumber()
  @Min(0.001)
  @Max(10000)
  concentrationMgPerMl?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0.001)
  @Max(100000)
  concentrationMg?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0.001)
  @Max(1000)
  concentrationVolumeMl?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0.001)
  @Max(10000)
  strengthMgPerUnit?: number | null;

  @IsIn(UNIT_TYPES)
  unitType!: MedicationUnitType;

  @IsOptional()
  @IsString()
  notes?: string;

  // The same cabinet fields PATCH accepts. They were update-only, so `whitelist: true` silently
  // stripped them on create and the caller got a 201 with both flags false -- a write that reports
  // success while dropping what it was told. A caregiver adding the bottle they are holding should
  // be able to record everything printed on it in one request (api.md -> Cabinet awareness).
  @IsOptional()
  @IsBoolean()
  atHome?: boolean;

  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;

  @IsOptional()
  @IsBoolean()
  runningLow?: boolean;
}
