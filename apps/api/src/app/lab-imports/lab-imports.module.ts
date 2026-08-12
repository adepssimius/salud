import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { FilesModule } from '../files/files.module';
import { AnalytesModule } from '../analytes/analytes.module';
import { LabImportsService } from './lab-imports.service';
import { LabImportsController } from './lab-imports.controller';
import { PdfTextService } from './pdf-text.service';

@Module({
  imports: [PersistenceModule, FilesModule, AnalytesModule],
  providers: [LabImportsService, PdfTextService],
  controllers: [LabImportsController],
})
export class LabImportsModule {}
