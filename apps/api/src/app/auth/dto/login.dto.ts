import { IsEmail, IsString, MinLength } from 'class-validator';
import { LoginDto as LoginDtoShape } from '@salud/shared/types';

export class LoginDto implements LoginDtoShape {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
