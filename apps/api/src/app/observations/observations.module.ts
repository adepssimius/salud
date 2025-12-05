import { Module } from '@nestjs/common';
import { ObservationsService } from './observations.service';
import { ObservationsController } from './observations.controller';
import { PersistenceModule } from '../persistence/persistence.module';
import { EpisodesModule } from '../episodes/episodes.module';

@Module({
  imports: [PersistenceModule, EpisodesModule],
  providers: [ObservationsService],
  controllers: [ObservationsController],
})
export class ObservationsModule {}
