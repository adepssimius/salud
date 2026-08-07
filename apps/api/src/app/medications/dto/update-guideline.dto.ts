import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateGuidelineDto {
  @IsOptional()
  @IsString()
  medicationEmbodimentId?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  source?: string;

  @IsOptional()
  @IsNumber()
  mgPerKg?: number;

  @IsOptional()
  @IsNumber()
  maxMgPerDose?: number;

  @IsOptional()
  @IsNumber()
  maxMgPerDay?: number;

  @IsOptional()
  @IsNumber()
  minIntervalHours?: number;

  @IsOptional()
  @IsNumber()
  ageMinMonths?: number;

  @IsOptional()
  @IsNumber()
  ageMaxMonths?: number;

  @IsOptional()
  @IsNumber()
  doseMg?: number;

  @IsOptional()
  @IsNumber()
  doseMl?: number;

  @IsOptional()
  @IsNumber()
  pillCount?: number;

  @IsOptional()
  @IsNumber()
  frequencyPerDay?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
