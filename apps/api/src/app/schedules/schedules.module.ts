import { Module } from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { SchedulesController } from './schedules.controller';
import { PersistenceModule } from '../persistence/persistence.module';
import { InterventionsModule } from '../interventions/interventions.module';

@Module({
  imports: [PersistenceModule, InterventionsModule],
  providers: [SchedulesService],
  controllers: [SchedulesController],
  exports: [SchedulesService],
})
export class SchedulesModule {}
