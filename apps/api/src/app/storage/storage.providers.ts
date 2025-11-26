import { Provider } from '@nestjs/common';
import { resolveStorageConfig } from './storage.config';

export const STORAGE_CONFIG_TOKEN = 'STORAGE_CONFIG_TOKEN';

export const storageConfigProvider: Provider = {
  provide: STORAGE_CONFIG_TOKEN,
  useFactory: () => resolveStorageConfig(),
};
