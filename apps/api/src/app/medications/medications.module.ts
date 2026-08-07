import { Module } from '@nestjs/common';
import { MedicationsService } from './medications.service';
import { EmbodimentsService } from './embodiments.service';
import { GuidelinesService } from './guidelines.service';
import { MedicationsController } from './medications.controller';
import { PersistenceModule } from '../persistence/persistence.module';

@Module({
  imports: [PersistenceModule],
  providers: [MedicationsService, EmbodimentsService, GuidelinesService],
  controllers: [MedicationsController],
})
export class MedicationsModule {}
