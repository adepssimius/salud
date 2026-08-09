import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PersistenceModule } from './persistence/persistence.module';
import { AuthModule } from './auth/auth.module';
import { PatientsModule } from './patients/patients.module';
import { ObservationsModule } from './observations/observations.module';
import { InterventionsModule } from './interventions/interventions.module';
import { EpisodesModule } from './episodes/episodes.module';
import { MedicationsModule } from './medications/medications.module';
import { DosingModule } from './dosing/dosing.module';
import { AdvisoriesModule } from './advisories/advisories.module';
import { SchedulesModule } from './schedules/schedules.module';
import { TimelineModule } from './timeline/timeline.module';
import { ConditionsModule } from './conditions/conditions.module';
import { ProtocolsModule } from './protocols/protocols.module';
import { ReactionsModule } from './reactions/reactions.module';
import { ErBriefModule } from './er-brief/er-brief.module';
import { WhatsNewModule } from './whats-new/whats-new.module';
import { FilesModule } from './files/files.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PersistenceModule,
    AuthModule,
    PatientsModule,
    ObservationsModule,
    InterventionsModule,
    EpisodesModule,
    MedicationsModule,
    DosingModule,
    AdvisoriesModule,
    SchedulesModule,
    TimelineModule,
    ConditionsModule,
    ProtocolsModule,
    ReactionsModule,
    ErBriefModule,
    WhatsNewModule,
    FilesModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
