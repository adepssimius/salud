import { Module } from '@nestjs/common';
import { WhatsNewService } from './whats-new.service';
import { WhatsNewController } from './whats-new.controller';
import { PersistenceModule } from '../persistence/persistence.module';
import { TimelineModule } from '../timeline/timeline.module';

@Module({
  imports: [PersistenceModule, TimelineModule],
  providers: [WhatsNewService],
  controllers: [WhatsNewController],
})
export class WhatsNewModule {}
