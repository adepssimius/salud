import { ArrayMaxSize, IsArray, IsHexadecimal, IsString, Length, MaxLength } from 'class-validator';
import type { CatalogSeedApplyRequest } from '@salud/shared/types';

export class ApplyCatalogSeedDto implements CatalogSeedApplyRequest {
  // SHA-256 hex of the file the caregiver previewed.
  @IsString()
  @IsHexadecimal()
  @Length(64, 64)
  sourceHash!: string;

  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  select!: string[];
}
