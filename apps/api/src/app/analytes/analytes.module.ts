import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { AnalytesService } from './analytes.service';
import { AnalytesController } from './analytes.controller';

// A leaf on the module DAG (PersistenceModule only), so observations, timeline and lab-imports can
// all import it without cycle risk. Exports its service deliberately — MedicationsModule not doing
// so is why TimelineService and ErBriefService hand-roll medication queries.
@Module({
  imports: [PersistenceModule],
  providers: [AnalytesService],
  controllers: [AnalytesController],
  exports: [AnalytesService],
})
export class AnalytesModule {}
