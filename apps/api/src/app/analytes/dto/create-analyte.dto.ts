import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAnalyteDto {
  // The lab's printed name. Stored verbatim; uniqueness is checked case-insensitively in the
  // service (409 ANALYTE_NAME_TAKEN).
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  // Defaults to a title-cased `name` when omitted.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  unit?: string | null;

  // The panel it is reported under — context for a name that doesn't stand on its own.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  panel?: string | null;
}
