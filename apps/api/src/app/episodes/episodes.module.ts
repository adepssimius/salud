import { Module } from '@nestjs/common';
import { EpisodesService } from './episodes.service';
import { EpisodesController } from './episodes.controller';
import { PersistenceModule } from '../persistence/persistence.module';

@Module({
  imports: [PersistenceModule],
  providers: [EpisodesService],
  controllers: [EpisodesController],
  exports: [EpisodesService],
})
export class EpisodesModule {}
