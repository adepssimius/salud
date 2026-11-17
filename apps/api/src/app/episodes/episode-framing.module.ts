import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { EpisodesModule } from './episodes.module';
import { ObservationsModule } from '../observations/observations.module';
import { InterventionsModule } from '../interventions/interventions.module';
import { RevisionsModule } from '../revisions/revisions.module';
import { ConditionsModule } from '../conditions/conditions.module';
import { EpisodeFramingService } from './episode-framing.service';
import { EpisodeFramingController } from './episode-framing.controller';

// Separate from EpisodesModule: it needs ObservationsModule and InterventionsModule, which both
// import EpisodesModule — folding this in would make the dependency circular.
@Module({
  imports: [PersistenceModule, EpisodesModule, ObservationsModule, InterventionsModule, RevisionsModule, ConditionsModule],
  providers: [EpisodeFramingService],
  controllers: [EpisodeFramingController],
})
export class EpisodeFramingModule {}
