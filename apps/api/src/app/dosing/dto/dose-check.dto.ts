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

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}
