import { Module } from '@nestjs/common';
import { ConditionsService } from './conditions.service';
import { ConditionsController } from './conditions.controller';
import { PersistenceModule } from '../persistence/persistence.module';
import { RevisionsModule } from '../revisions/revisions.module';

@Module({
  imports: [PersistenceModule, RevisionsModule],
  providers: [ConditionsService],
  controllers: [ConditionsController],
  exports: [ConditionsService],
})
export class ConditionsModule {}
