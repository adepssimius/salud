import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// The context a report printed alongside the name. Applied only when the analyte is created —
// an import never rewrites what the catalog already says.
class ResolveAnalyteInputDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  unit?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  panel?: string | null;
}

export class ResolveAnalytesDto {
  // A full panel is ~35 analytes; 200 leaves room for the largest reports without letting a
  // runaway client create an unbounded number of catalog rows in one call.
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ResolveAnalyteInputDto)
  analytes!: ResolveAnalyteInputDto[];
}
