import { Module } from '@nestjs/common';
import { ErBriefService } from './er-brief.service';
import { ErBriefController } from './er-brief.controller';
import { ErBriefPublicController } from './er-brief-public.controller';
import { PersistenceModule } from '../persistence/persistence.module';
import { PatientsModule } from '../patients/patients.module';
import { EpisodesModule } from '../episodes/episodes.module';
import { ConditionsModule } from '../conditions/conditions.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { TimelineModule } from '../timeline/timeline.module';
import { CareDocumentsModule } from '../care-documents/care-documents.module';

@Module({
  imports: [
    PersistenceModule,
    PatientsModule,
    EpisodesModule,
    ConditionsModule,
    SchedulesModule,
    TimelineModule,
    CareDocumentsModule,
  ],
  providers: [ErBriefService],
  controllers: [ErBriefController, ErBriefPublicController],
})
export class ErBriefModule {}
