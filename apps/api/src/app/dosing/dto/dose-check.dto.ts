import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class DoseCheckDto {
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
}
