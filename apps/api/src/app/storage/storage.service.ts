import { Inject, Injectable } from '@nestjs/common';
import fs from 'fs';
import path from 'path';
import { STORAGE_CONFIG_TOKEN } from './storage.providers';
import { FileStorageConfig } from './storage.config';

@Injectable()
export class StorageService {
  constructor(
    @Inject(STORAGE_CONFIG_TOKEN)
    private readonly config: FileStorageConfig,
  ) {
    this.ensureBasePath();
  }

  get driver() {
    return this.config.driver;
  }

  get basePath() {
    return this.config.basePath;
  }

  // Ensure the directory exists; errors bubble so misconfiguration is obvious.
  private ensureBasePath() {
    if (this.config.driver !== 'local') {
      return;
    }
    fs.mkdirSync(this.config.basePath, { recursive: true });
  }

  resolveLocalPath(relativePath: string) {
    if (this.config.driver !== 'local') {
      throw new Error('Local path resolution is only available for local driver');
    }
    return path.join(this.config.basePath, relativePath);
  }

  async write(relativePath: string, buffer: Buffer): Promise<void> {
    const fullPath = this.resolveLocalPath(relativePath);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, buffer);
  }

  createReadStream(relativePath: string): fs.ReadStream {
    return fs.createReadStream(this.resolveLocalPath(relativePath));
  }

  async delete(relativePath: string): Promise<void> {
    await fs.promises.rm(this.resolveLocalPath(relativePath), { force: true });
  }
}
