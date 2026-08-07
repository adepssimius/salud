import { Module } from '@nestjs/common';
import { ReactionsService } from './reactions.service';
import { ReactionsController } from './reactions.controller';
import { PersistenceModule } from '../persistence/persistence.module';

@Module({
  imports: [PersistenceModule],
  providers: [ReactionsService],
  controllers: [ReactionsController],
  exports: [ReactionsService],
})
export class ReactionsModule {}
