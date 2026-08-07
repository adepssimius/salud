import { Module } from '@nestjs/common';
import { ProtocolsService } from './protocols.service';
import { ProtocolsController } from './protocols.controller';
import { PersistenceModule } from '../persistence/persistence.module';
import { ConditionsModule } from '../conditions/conditions.module';

@Module({
  imports: [PersistenceModule, ConditionsModule],
  providers: [ProtocolsService],
  controllers: [ProtocolsController],
  exports: [ProtocolsService],
})
export class ProtocolsModule {}
