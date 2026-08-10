import { IsBoolean, IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { MedicationUnitType } from '@salud/shared/types';

const UNIT_TYPES: MedicationUnitType[] = ['tablet', 'capsule', 'ml', 'drop', 'other'];

export class UpdateEmbodimentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

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

  @IsOptional()
  @IsIn(UNIT_TYPES)
  unitType?: MedicationUnitType;

  @IsOptional()
  @IsString()
  notes?: string;

  // Cabinet awareness fields (F-9.1–F-9.3)
  @IsOptional()
  @IsBoolean()
  atHome?: boolean;

  // Not future-bounded: an expiry in the past is the *warning* condition (the expired_embodiment
  // advisory), and one in the future is the normal case.
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;

  @IsOptional()
  @IsBoolean()
  runningLow?: boolean;
}
