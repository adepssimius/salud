import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PersistenceModule } from './persistence/persistence.module';
import { AuthModule } from './auth/auth.module';
import { PatientsModule } from './patients/patients.module';
import { ObservationsModule } from './observations/observations.module';
import { InterventionsModule } from './interventions/interventions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PersistenceModule,
    AuthModule,
    PatientsModule,
    ObservationsModule,
    InterventionsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
