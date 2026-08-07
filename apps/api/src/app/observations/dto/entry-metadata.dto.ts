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
  Min,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  validateSync,
} from 'class-validator';
import { ObservationType } from '@salud/shared/types';

// Per-entry-type metadata shapes, matching app-spec/data-model.md
// "Observation entry structured metadata". One class per ObservationType.

const SIDES = ['left', 'right', 'bilateral', 'n/a'] as const;
const TEMPERATURE_METHODS = ['oral', 'tympanic', 'axillary', 'rectal', 'temporal', 'unknown'] as const;
const SYMPTOM_SEVERITIES = ['mild', 'moderate', 'severe'] as const;

class TemperatureMetadata {
  @IsNumber()
  value!: number;

  @IsIn(['C', 'F'])
  unit!: 'C' | 'F';

  @IsIn(TEMPERATURE_METHODS)
  method!: (typeof TEMPERATURE_METHODS)[number];

  @IsOptional()
  @IsString()
  note?: string;
}

class HeartRateMetadata {
  @IsInt()
  bpm!: number;

  @IsOptional()
  @IsString()
  note?: string;
}

class RespiratoryRateMetadata {
  @IsInt()
  breathsPerMin!: number;

  @IsOptional()
  @IsString()
  note?: string;
}

class OxygenSaturationMetadata {
  @IsInt()
  @Min(0)
  @Max(100)
  percent!: number;

  @IsOptional()
  @IsString()
  note?: string;
}

class PainScoreMetadata {
  @IsInt()
  @Min(0)
  @Max(10)
  score!: number;

  @IsOptional()
  @IsString()
  note?: string;
}

class WeightMetadata {
  @IsNumber()
  kg!: number;

  @IsOptional()
  @IsString()
  note?: string;
}

class HeightMetadata {
  @IsNumber()
  cm!: number;

  @IsOptional()
  @IsString()
  note?: string;
}

class LesionSizeMetadata {
  @IsNumber()
  lengthCm!: number;

  @IsOptional()
  @IsNumber()
  widthCm?: number | null;

  @IsOptional()
  @IsNumber()
  depthCm?: number | null;

  @IsString()
  @IsNotEmpty()
  bodyLocation!: string;

  @IsIn(SIDES)
  side!: (typeof SIDES)[number];

  @IsOptional()
  @IsString()
  note?: string;
}

// No canonical fixed symptom-tag list exists yet (the former `symptom_tags` table was orphaned
// and dropped — see CLAUDE.md). Until one is reintroduced, `tag` is validated as free text rather
// than against an enum, to avoid inventing a list that isn't backed by data anywhere.
class SymptomMetadata {
  @IsString()
  @IsNotEmpty()
  tag!: string;

  @IsOptional()
  @IsIn(SYMPTOM_SEVERITIES)
  severity?: (typeof SYMPTOM_SEVERITIES)[number] | null;

  @IsOptional()
  @IsString()
  note?: string;
}

class TagMetadata {
  @IsString()
  @IsNotEmpty()
  tag!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

class PhotoMetadata {
  @IsUUID('4')
  fileId!: string;

  @IsString()
  @IsNotEmpty()
  bodyLocation!: string;

  @IsIn(SIDES)
  side!: (typeof SIDES)[number];

  @IsOptional()
  @IsNumber()
  sizeCm?: number | null;

  @IsOptional()
  @IsString()
  note?: string;
}

class NoteMetadata {
  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsOptional()
  @IsString()
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
    if (!MetadataClass) return false;
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
