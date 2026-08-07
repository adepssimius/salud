import { Module } from '@nestjs/common';
import { TimelineService } from './timeline.service';
import { TimelineController } from './timeline.controller';
import { PersistenceModule } from '../persistence/persistence.module';
import { PatientsModule } from '../patients/patients.module';
import { ObservationsModule } from '../observations/observations.module';
import { InterventionsModule } from '../interventions/interventions.module';
import { EpisodesModule } from '../episodes/episodes.module';

@Module({
  imports: [PersistenceModule, PatientsModule, ObservationsModule, InterventionsModule, EpisodesModule],
  providers: [TimelineService],
  controllers: [TimelineController],
  exports: [TimelineService],
})
export class TimelineModule {}
