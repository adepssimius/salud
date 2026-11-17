import { IsBoolean, IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { DOSAGE_FORMS, DosageForm, MedicationUnitType } from '@salud/shared/types';

const UNIT_TYPES: MedicationUnitType[] = ['tablet', 'capsule', 'ml', 'drop', 'other'];

export class UpdateEmbodimentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  // Same pair-or-per-mL contract as create, but checked against the *merged* row: a PATCH carrying
  // only `concentrationMg` is validated against the stored `concentrationVolumeMl`. Nulls are
  // meaningful here -- nulling either half clears the pair and the derived figure together.
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

  @IsOptional()
  @IsIn(UNIT_TYPES)
  unitType?: MedicationUnitType;

  // Sets `unitType` from the form, so it is under the same lock: a change of form that moves the
  // unit (liquid -> tablet) is refused once doses or schedules use the row, one that doesn't
  // (tablet -> chewable, other -> cream) is not. `null` clears the form and leaves `unitType`.
  @IsOptional()
  @IsIn([...DOSAGE_FORMS, null])
  dosageForm?: DosageForm | null;

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
