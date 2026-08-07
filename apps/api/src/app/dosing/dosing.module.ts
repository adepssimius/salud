import { Module } from '@nestjs/common';
import { DosingService } from './dosing.service';
import { DosingController } from './dosing.controller';
import { PersistenceModule } from '../persistence/persistence.module';

@Module({
  imports: [PersistenceModule],
  providers: [DosingService],
  controllers: [DosingController],
  exports: [DosingService],
})
export class DosingModule {}
