import { ArrayUnique, IsArray, IsBoolean, IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class UpdateMedicationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  brandNames?: string[];

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  defaultActive?: boolean;
}
