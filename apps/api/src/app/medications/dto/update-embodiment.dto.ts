import { IsBoolean, IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { MedicationUnitType } from '@salud/shared/types';

const UNIT_TYPES: MedicationUnitType[] = ['tablet', 'capsule', 'ml', 'drop', 'other'];

export class UpdateEmbodimentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @IsOptional()
  @IsNumber()
  concentrationMgPerMl?: number | null;

  @IsOptional()
  @IsNumber()
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

  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;

  @IsOptional()
  @IsBoolean()
  runningLow?: boolean;
}
