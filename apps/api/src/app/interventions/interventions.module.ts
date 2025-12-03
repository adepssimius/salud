import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { InterventionsService } from './interventions.service';
import { InterventionsController } from './interventions.controller';

@Module({
  imports: [PersistenceModule],
  providers: [InterventionsService],
  controllers: [InterventionsController],
})
export class InterventionsModule {}
