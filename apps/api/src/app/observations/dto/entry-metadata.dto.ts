import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  validateSync,
} from 'class-validator';
import { ObservationType } from '@salud/shared/types';

// Per-entry-type metadata shapes, matching app-spec/data-model.md
// "Observation entry structured metadata". One class per ObservationType.
//
// The numeric bounds throughout are absurdity walls, not clinical judgment (P6) — they keep a typo
// out of the record, they don't tell a caregiver what is normal. The one that carries real weight
// is WeightMetadata.kg: it denormalizes onto patients.latest_weight_kg and from there into mg/kg
// dose calculation, so a negative value there is a dosing-input corruption.

const SIDES = ['left', 'right', 'bilateral', 'n/a'] as const;
const TEMPERATURE_METHODS = ['oral', 'tympanic', 'axillary', 'rectal', 'temporal', 'unknown'] as const;
const SYMPTOM_SEVERITIES = ['mild', 'moderate', 'severe'] as const;

const NOTE_MAX = 2000;
const TAG_MAX = 120;

// Temperature is stored in the unit it was entered in (data-model.md), not canonicalized, so the
// range depends on a sibling property. That can't be expressed with @Min/@Max, and it can't be
// expressed with two @ValidateIf branches either: class-validator's conditional metadata is
// per-property, so a second @ValidateIf on the same property ANDs into the first and both branches
// get skipped. Hence a constraint class.
@ValidatorConstraint({ name: 'temperatureInRange', async: false })
class TemperatureRangeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (typeof value !== 'number' || Number.isNaN(value)) return true; // @IsNumber owns that error
    const unit = (args.object as { unit?: string }).unit;
    if (unit === 'C') return value >= 25 && value <= 45;
    if (unit === 'F') return value >= 77 && value <= 113;
    return true; // unknown unit — @IsIn owns that error
  }

  defaultMessage(): string {
    return 'temperature is outside the plausible range for its unit';
  }
}

class TemperatureMetadata {
  @IsNumber()
  @Validate(TemperatureRangeConstraint)
  value!: number;

  @IsIn(['C', 'F'])
  unit!: 'C' | 'F';

  @IsIn(TEMPERATURE_METHODS)
  method!: (typeof TEMPERATURE_METHODS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;
}

class HeartRateMetadata {
  @IsInt()
  @Min(1)
  @Max(400)
  bpm!: number;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;
}

class RespiratoryRateMetadata {
  @IsInt()
  @Min(1)
  @Max(120)
  breathsPerMin!: number;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;
}

class OxygenSaturationMetadata {
  // 0 is deliberately allowed: a probe reading nothing is a real, reportable observation.
  @IsInt()
  @Min(0)
  @Max(100)
  percent!: number;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;
}

class PainScoreMetadata {
  @IsInt()
  @Min(0)
  @Max(10)
  score!: number;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;
}

class WeightMetadata {
  // 0.2 kg covers extreme preemies. This is the bound that matters most — see the file header.
  @IsNumber()
  @Min(0.2)
  @Max(500)
  kg!: number;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;
}

class HeightMetadata {
  @IsNumber()
  @Min(10)
  @Max(280)
  cm!: number;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;
}

class LesionSizeMetadata {
  @IsNumber()
  @Min(0)
  @Max(200)
  lengthCm!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200)
  widthCm?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200)
  depthCm?: number | null;

  @IsString()
  @IsNotEmpty()
  bodyLocation!: string;

  @IsIn(SIDES)
  side!: (typeof SIDES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;
}

// No canonical fixed symptom-tag list exists yet (the former `symptom_tags` table was orphaned
// and dropped — see CLAUDE.md). Until one is reintroduced, `tag` is validated as free text rather
// than against an enum, to avoid inventing a list that isn't backed by data anywhere.
class SymptomMetadata {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TAG_MAX)
  tag!: string;

  @IsOptional()
  @IsIn(SYMPTOM_SEVERITIES)
  severity?: (typeof SYMPTOM_SEVERITIES)[number] | null;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;
}

class TagMetadata {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TAG_MAX)
  tag!: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;
}

class PhotoMetadata {
  // Shape only. That the file exists and belongs to this patient is checked in
  // ObservationsService — a DTO constraint has no DI and can't await a lookup.
  @IsUUID('4')
  fileId!: string;

  @IsString()
  @IsNotEmpty()
  bodyLocation!: string;

  @IsIn(SIDES)
  side!: (typeof SIDES)[number];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200)
  sizeCm?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;
}

class NoteMetadata {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(TAG_MAX)
  symptom?: string;
}

const METADATA_CLASSES: Record<ObservationType, new () => object> = {
  temperature: TemperatureMetadata,
  heart_rate: HeartRateMetadata,
  respiratory_rate: RespiratoryRateMetadata,
  oxygen_saturation: OxygenSaturationMetadata,
  pain_score: PainScoreMetadata,
  weight: WeightMetadata,
  height: HeightMetadata,
  lesion_size: LesionSizeMetadata,
  symptom: SymptomMetadata,
  note: NoteMetadata,
  tag: TagMetadata,
  photo: PhotoMetadata,
};

@ValidatorConstraint({ name: 'entryMetadata', async: false })
export class EntryMetadataConstraint implements ValidatorConstraintInterface {
  validate(metadata: unknown, args: ValidationArguments): boolean {
    const type = (args.object as { type?: ObservationType }).type;
    const MetadataClass = type ? METADATA_CLASSES[type] : undefined;
    // An unknown `type` is the `type` property's own error to report, and its @IsIn will report it.
    // Claiming a metadata-schema failure on top of that gives the client two messages for one
    // mistake, and the misleading one first. Returning true here cannot let a bad request through:
    // `type` is required, so its own validator still fails the payload.
    if (!MetadataClass) return true;
    const instance = plainToInstance(MetadataClass, metadata ?? {});
    const errors = validateSync(instance as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return errors.length === 0;
  }

  defaultMessage(): string {
    return 'OBSERVATION_SCHEMA_INVALID';
  }
}
