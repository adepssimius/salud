import { IsNotEmpty, IsString } from 'class-validator';
import { UpdateCodeStatusDto as UpdateCodeStatusDtoShape } from '@salud/shared/types';

export class UpdateCodeStatusDto implements UpdateCodeStatusDtoShape {
  @IsString()
  @IsNotEmpty()
  codeStatus!: string;
}
