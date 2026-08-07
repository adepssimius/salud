import { Module } from '@nestjs/common';
import { ObservationsService } from './observations.service';
import { ObservationsController } from './observations.controller';
import { PersistenceModule } from '../persistence/persistence.module';
import { EpisodesModule } from '../episodes/episodes.module';
import { AdvisoriesModule } from '../advisories/advisories.module';
import { RevisionsModule } from '../revisions/revisions.module';

@Module({
  imports: [PersistenceModule, EpisodesModule, AdvisoriesModule, RevisionsModule],
  providers: [ObservationsService],
  controllers: [ObservationsController],
  exports: [ObservationsService],
})
export class ObservationsModule {}
