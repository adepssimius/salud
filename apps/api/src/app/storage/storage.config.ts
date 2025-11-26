import path from 'path';
import { resolveDataDir } from '../persistence/paths';

export type StorageDriver = 'local';

export interface FileStorageConfig {
  driver: StorageDriver;
  basePath: string;
}

export function resolveStorageConfig(): FileStorageConfig {
  const driver = (process.env.FILE_STORAGE_DRIVER ?? 'local') as StorageDriver;
  const basePath =
    process.env.FILE_STORAGE_LOCAL_BASE_PATH ??
    path.join(resolveDataDir(), 'attachments');

  return {
    driver,
    basePath,
  };
}
