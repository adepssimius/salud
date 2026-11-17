import { Module } from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { SchedulesController } from './schedules.controller';
import { PersistenceModule } from '../persistence/persistence.module';
import { InterventionsModule } from '../interventions/interventions.module';
import { RevisionsModule } from '../revisions/revisions.module';

@Module({
  imports: [PersistenceModule, InterventionsModule, RevisionsModule],
  providers: [SchedulesService],
  controllers: [SchedulesController],
  exports: [SchedulesService],
})
export class SchedulesModule {}
