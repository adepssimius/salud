import { Module } from '@nestjs/common';
import {
  DATABASE_CONNECTION_TOKEN,
  DATABASE_CONFIG_TOKEN,
  databaseConfigProvider,
  databaseConnectionProvider,
} from './database.providers';
import { DatabaseService } from './database.service';
import { storageConfigProvider, STORAGE_CONFIG_TOKEN } from '../storage/storage.providers';
import { StorageService } from '../storage/storage.service';

@Module({
  providers: [
    databaseConfigProvider,
    databaseConnectionProvider,
    DatabaseService,
    storageConfigProvider,
    StorageService,
  ],
  exports: [
    DATABASE_CONFIG_TOKEN,
    DATABASE_CONNECTION_TOKEN,
    DatabaseService,
    STORAGE_CONFIG_TOKEN,
    StorageService,
  ],
})
export class PersistenceModule {}
