import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Request,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthConfigResponse } from '@salud/shared/types';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './jwt.guard';
import { authMode } from '../config/env';

@Controller('auth')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Unguarded and cheap on purpose: the login page calls this before it knows which form to
  // render at all, so it can't be behind the very auth it's asking about (security.md → "OIDC
  // login").
  @Get('config')
  config(): AuthConfigResponse {
    return { mode: authMode() };
  }

  @Post('register')
  register(@Body() dto: RegisterDto) {
    this.assertPasswordAuthEnabled();
    return this.auth.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    this.assertPasswordAuthEnabled();
    return this.auth.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Request() req: any) {
    return this.auth.me(req.user.userId);
  }

  // Once OIDC is the active login path, an un-gated register/login is a completely open,
  // internet-reachable account-creation endpoint — the forward-auth perimeter that used to sit in
  // front of the whole host is gone by then (deployment.md → "Access control"). This has to be
  // enforced here, not just by the web UI hiding the form: a direct API caller must be refused too.
  private assertPasswordAuthEnabled() {
    if (authMode() === 'oidc') {
      throw new ForbiddenException('PASSWORD_AUTH_DISABLED');
    }
  }
}
