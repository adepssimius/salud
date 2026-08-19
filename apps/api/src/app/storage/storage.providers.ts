import { Provider } from '@nestjs/common';
import { FileStorageConfig, resolveStorageConfig } from './storage.config';
import { FileStorageDriver } from './file-storage.driver';
import { LocalFileStorageDriver } from './local.driver';
import { S3FileStorageDriver } from './s3.driver';

export const STORAGE_CONFIG_TOKEN = 'STORAGE_CONFIG_TOKEN';
export const FILE_STORAGE_DRIVER_TOKEN = 'FILE_STORAGE_DRIVER_TOKEN';

export const storageConfigProvider: Provider = {
  provide: STORAGE_CONFIG_TOKEN,
  useFactory: () => resolveStorageConfig(),
};

export function createFileStorageDriver(config: FileStorageConfig): FileStorageDriver {
  // The discriminated union is what makes this exhaustive: adding a third driver without a branch
  // here is a compile error, not a runtime surprise.
  switch (config.driver) {
    case 's3':
      return new S3FileStorageDriver(config);
    case 'local':
      return new LocalFileStorageDriver(config);
  }
}

export const fileStorageDriverProvider: Provider = {
  provide: FILE_STORAGE_DRIVER_TOKEN,
  inject: [STORAGE_CONFIG_TOKEN],
  useFactory: (config: FileStorageConfig) => createFileStorageDriver(config),
};
