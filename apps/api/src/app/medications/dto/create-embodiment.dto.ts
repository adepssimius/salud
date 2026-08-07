import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { MedicationUnitType } from '@salud/shared/types';

const UNIT_TYPES: MedicationUnitType[] = ['tablet', 'capsule', 'ml', 'drop', 'other'];

export class CreateEmbodimentDto {
  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsOptional()
  @IsNumber()
  concentrationMgPerMl?: number | null;

  @IsOptional()
  @IsNumber()
  strengthMgPerUnit?: number | null;

  @IsIn(UNIT_TYPES)
  unitType!: MedicationUnitType;

  @IsOptional()
  @IsString()
  notes?: string;
}
