import { Module } from '@nestjs/common';
import { MedicationsService } from './medications.service';
import { EmbodimentsService } from './embodiments.service';
import { GuidelinesService } from './guidelines.service';
import { MedicationsController } from './medications.controller';
import { CatalogSeedService } from './catalog-seed/catalog-seed.service';
import { PersistenceModule } from '../persistence/persistence.module';

@Module({
  imports: [PersistenceModule],
  providers: [MedicationsService, EmbodimentsService, GuidelinesService, CatalogSeedService],
  controllers: [MedicationsController],
})
export class MedicationsModule {}
