import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { LabFormat } from '@salud/shared/types';

export class CreateLabImportDto {
  @IsUUID('4')
  fileId!: string;

  // Optional: forces a specific parser instead of sniffing (api.md → "Lab imports").
  @IsOptional()
  @IsIn(['quest'] satisfies LabFormat[])
  format?: LabFormat;
}
