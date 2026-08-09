import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { PersistenceModule } from '../persistence/persistence.module';
import { JwtAuthGuard } from './jwt.guard';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { resolveJwtSecret } from '../config/env';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: resolveJwtSecret(config),
        signOptions: { expiresIn: '1d' },
      }),
      inject: [ConfigService],
    }),
    PersistenceModule,
  ],
  controllers: [AuthController, UsersController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, UsersService],
  exports: [AuthService, UsersService],
})
export class AuthModule {}
