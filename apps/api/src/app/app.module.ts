import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PersistenceModule } from './persistence/persistence.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PersistenceModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
