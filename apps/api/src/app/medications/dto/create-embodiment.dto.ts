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

  @IsOptional()
  @IsNumber()
  @Min(0.001)
  @Max(10000)
  concentrationMgPerMl?: number | null;

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
