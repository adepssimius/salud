import { Module } from '@nestjs/common';
import { AdvisoriesService } from './advisories.service';
import { AdvisoriesController } from './advisories.controller';
import { PersistenceModule } from '../persistence/persistence.module';

@Module({
  imports: [PersistenceModule],
  providers: [AdvisoriesService],
  controllers: [AdvisoriesController],
  exports: [AdvisoriesService],
})
export class AdvisoriesModule {}
