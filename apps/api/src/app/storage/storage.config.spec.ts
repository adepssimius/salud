import os from 'os';
import path from 'path';
import { resolveStorageConfig, S3StorageConfig, LocalStorageConfig } from './storage.config';

/**
 * The point of these is the fail-fast boundary (persistence.md → "File storage"). The previous
 * config cast an arbitrary env string to the driver union, so a typo or a half-finished s3 setup
 * booted cleanly and only exploded on the first upload.
 */
describe('resolveStorageConfig', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('S3_') || key.startsWith('FILE_STORAGE_')) delete process.env[key];
    }
    process.env.DATA_DIR = os.tmpdir();
  });

  afterAll(() => {
    process.env = { ...saved };
  });

  describe('local', () => {
    it('is the default with no env set at all', () => {
      const config = resolveStorageConfig() as LocalStorageConfig;
      expect(config.driver).toBe('local');
      expect(config.basePath).toBe(path.join(os.tmpdir(), 'attachments'));
    });

    it('honours FILE_STORAGE_LOCAL_BASE_PATH', () => {
      process.env.FILE_STORAGE_LOCAL_BASE_PATH = '/var/lib/salud/blobs';
      expect((resolveStorageConfig() as LocalStorageConfig).basePath).toBe('/var/lib/salud/blobs');
    });
  });

  describe('validation', () => {
    it('rejects an unknown driver at resolve time rather than at first use', () => {
      process.env.FILE_STORAGE_DRIVER = 'gcs';
      expect(() => resolveStorageConfig()).toThrow(/FILE_STORAGE_DRIVER must be one of/);
    });

    it('requires S3_BUCKET when the driver is s3', () => {
      process.env.FILE_STORAGE_DRIVER = 's3';
      expect(() => resolveStorageConfig()).toThrow(/S3_BUCKET is required/);
    });

    it('rejects a half-configured credential pair', () => {
      process.env.FILE_STORAGE_DRIVER = 's3';
      process.env.S3_BUCKET = 'salud';
      process.env.S3_ACCESS_KEY_ID = 'key';
      expect(() => resolveStorageConfig()).toThrow(/must be set together/);
    });

    it('rejects a non-boolean S3_FORCE_PATH_STYLE', () => {
      process.env.FILE_STORAGE_DRIVER = 's3';
      process.env.S3_BUCKET = 'salud';
      process.env.S3_FORCE_PATH_STYLE = 'sometimes';
      expect(() => resolveStorageConfig()).toThrow(/must be a boolean/);
    });
  });

  describe('s3', () => {
    beforeEach(() => {
      process.env.FILE_STORAGE_DRIVER = 's3';
      process.env.S3_BUCKET = 'salud-attachments';
    });

    it('defaults to AWS-shaped config when no endpoint is given', () => {
      const config = resolveStorageConfig() as S3StorageConfig;
      expect(config).toMatchObject({
        driver: 's3',
        bucket: 'salud-attachments',
        region: 'us-east-1',
        endpoint: undefined,
        forcePathStyle: false,
        prefix: undefined,
        credentials: undefined,
      });
    });

    it('turns on path-style addressing as soon as a custom endpoint is set', () => {
      process.env.S3_ENDPOINT = 'http://localhost:9000';
      const config = resolveStorageConfig() as S3StorageConfig;
      expect(config.endpoint).toBe('http://localhost:9000');
      expect(config.forcePathStyle).toBe(true);
    });

    it('lets an explicit S3_FORCE_PATH_STYLE override that default', () => {
      process.env.S3_ENDPOINT = 'https://s3.example.com';
      process.env.S3_FORCE_PATH_STYLE = 'false';
      expect((resolveStorageConfig() as S3StorageConfig).forcePathStyle).toBe(false);
    });

    it('carries region, prefix and a complete credential pair through', () => {
      process.env.S3_REGION = 'eu-central-1';
      process.env.S3_PREFIX = 'salud/attachments/';
      process.env.S3_ACCESS_KEY_ID = 'key';
      process.env.S3_SECRET_ACCESS_KEY = 'secret';
      expect(resolveStorageConfig()).toMatchObject({
        region: 'eu-central-1',
        prefix: 'salud/attachments/',
        credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
      });
    });

    it('treats empty strings as unset, so a blank env var is not a blank credential', () => {
      process.env.S3_ENDPOINT = '';
      process.env.S3_ACCESS_KEY_ID = '';
      process.env.S3_SECRET_ACCESS_KEY = '';
      const config = resolveStorageConfig() as S3StorageConfig;
      expect(config.endpoint).toBeUndefined();
      expect(config.credentials).toBeUndefined();
      expect(config.forcePathStyle).toBe(false);
    });
  });
});
