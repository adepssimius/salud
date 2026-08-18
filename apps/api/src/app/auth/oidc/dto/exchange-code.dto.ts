import { IsString, MinLength } from 'class-validator';
import { ExchangeOidcCodeDto as ExchangeOidcCodeDtoShape } from '@salud/shared/types';

export class ExchangeOidcCodeDto implements ExchangeOidcCodeDtoShape {
  @IsString()
  @MinLength(1)
  code!: string;
}
