import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { DoseCheckDto as DoseCheckContract } from '@salud/shared/types';

export class DoseCheckDto implements DoseCheckContract {
  @IsString()
  @IsNotEmpty()
  medicationId!: string;

  @IsOptional()
  @IsString()
  medicationEmbodimentId?: string;

  @IsOptional()
  @IsNumber()
  amountMg?: number;

  // Not future-bounded: dose-checks is a preview that persists nothing, and its whole job is to
  // answer "what if I gave this at X" (api.md -> Conventions).
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  // The dose being corrected, so the preview doesn't count it as its own prior dose (api.md →
  // dose-checks). Only ever narrows the prior doses of the route's patient: an id from another
  // patient matches nothing and changes nothing, so it can't be used to probe their doses.
  @IsOptional()
  @IsUUID('4')
  excludeInterventionId?: string;
}
