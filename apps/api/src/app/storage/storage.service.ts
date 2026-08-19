import { Inject, Injectable } from '@nestjs/common';
import { Readable } from 'stream';
import { FILE_STORAGE_DRIVER_TOKEN, STORAGE_CONFIG_TOKEN } from './storage.providers';
import { FileStorageConfig } from './storage.config';
import { FileStorageDriver } from './file-storage.driver';

/**
 * Facade over the configured FileStorageDriver. Deliberately adds nothing but delegation: it stays
 * the single injected dependency for `files.service.ts`, `lab-imports.service.ts` and
 * `patients.service.ts` so none of them knows, or can branch on, which backend is live.
 */
@Injectable()
export class StorageService {
  constructor(
    @Inject(STORAGE_CONFIG_TOKEN)
    private readonly config: FileStorageConfig,
    @Inject(FILE_STORAGE_DRIVER_TOKEN)
    private readonly driverImpl: FileStorageDriver,
  ) {}

  /** Diagnostics only (health/startup logging) — no service should branch on this. */
  get driver() {
    return this.config.driver;
  }

  /** Recorded in `file_assets.bucket` on write; see FileStorageDriver.bucketLabel. */
  get bucketLabel() {
    return this.driverImpl.bucketLabel;
  }

  async write(relativePath: string, buffer: Buffer, contentType?: string): Promise<void> {
    await this.driverImpl.write(relativePath, buffer, contentType);
  }

  async createReadStream(relativePath: string): Promise<Readable> {
    return await this.driverImpl.createReadStream(relativePath);
  }

  // Whole-file read for consumers that must parse the bytes (lab imports).
  async read(relativePath: string): Promise<Buffer> {
    return await this.driverImpl.read(relativePath);
  }

  async delete(relativePath: string): Promise<void> {
    await this.driverImpl.delete(relativePath);
  }
}
