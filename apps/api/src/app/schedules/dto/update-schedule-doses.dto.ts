import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import { UpdateScheduleDosesRequest } from '@salud/shared/types';

export class UpdateScheduleDosesDto implements UpdateScheduleDosesRequest {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  link?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  unlink?: string[];
}
