import { Module } from '@nestjs/common';
import { CareDocumentsService } from './care-documents.service';
import { CareDocumentsController } from './care-documents.controller';
import { PersistenceModule } from '../persistence/persistence.module';

@Module({
  imports: [PersistenceModule],
  providers: [CareDocumentsService],
  controllers: [CareDocumentsController],
  // Exported for the ER Brief, which reads the same map into its header.
  exports: [CareDocumentsService],
})
export class CareDocumentsModule {}
