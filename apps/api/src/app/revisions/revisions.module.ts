import { Module } from '@nestjs/common';
import { RevisionsService } from './revisions.service';
import { PersistenceModule } from '../persistence/persistence.module';

@Module({
  imports: [PersistenceModule],
  providers: [RevisionsService],
  exports: [RevisionsService],
})
export class RevisionsModule {}
