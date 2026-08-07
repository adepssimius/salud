import { ArrayUnique, IsArray, IsBoolean, IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class CreateMedicationDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  brandNames?: string[];

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  defaultActive?: boolean;
}
