import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { EpisodesModule } from '../episodes/episodes.module';
import { DosingModule } from '../dosing/dosing.module';
import { AdvisoriesModule } from '../advisories/advisories.module';
import { RevisionsModule } from '../revisions/revisions.module';
import { InterventionsService } from './interventions.service';
import { InterventionsController } from './interventions.controller';

@Module({
  imports: [PersistenceModule, EpisodesModule, DosingModule, AdvisoriesModule, RevisionsModule],
  providers: [InterventionsService],
  controllers: [InterventionsController],
  exports: [InterventionsService],
})
export class InterventionsModule {}
