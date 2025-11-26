import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { PersistenceModule } from '../persistence/persistence.module';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { JwtStrategy } from '../auth/jwt.strategy';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    PersistenceModule,
    ConfigModule,
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-secret',
        signOptions: { expiresIn: '1d' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [PatientsController],
  providers: [PatientsService, JwtAuthGuard, JwtStrategy],
  exports: [PatientsService],
})
export class PatientsModule {}
