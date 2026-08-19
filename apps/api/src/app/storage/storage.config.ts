import path from 'path';
import { resolveDataDir } from '../persistence/paths';

export const STORAGE_DRIVERS = ['local', 's3'] as const;
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];

export interface LocalStorageConfig {
  driver: 'local';
  basePath: string;
}

export interface S3StorageConfig {
  driver: 's3';
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  prefix?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

export type FileStorageConfig = LocalStorageConfig | S3StorageConfig;

/**
 * Env lookup, parameterized so a caller can resolve a *second* storage backend from a synthetic
 * env object rather than the ambient one. That is what `tools/migrate-attachments` does to
 * describe its source driver without duplicating any of the parsing or validation below.
 */
export type StorageEnv = Record<string, string | undefined>;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`S3_FORCE_PATH_STYLE must be a boolean, got: ${value}`);
}

/**
 * Resolves the storage backend from the environment, same shape as `resolveDatabaseConfig` and
 * fail-fast for the same reason: a storage misconfiguration that only surfaces on the first upload
 * (or worse, the first *download*) looks like data loss. The old version cast an arbitrary string
 * to the driver union, so `FILE_STORAGE_DRIVER=s3` booted happily and threw hours later.
 */
export function resolveStorageConfig(env: StorageEnv = process.env): FileStorageConfig {
  const raw = env.FILE_STORAGE_DRIVER ?? 'local';
  if (!(STORAGE_DRIVERS as readonly string[]).includes(raw)) {
    throw new Error(
      `FILE_STORAGE_DRIVER must be one of ${STORAGE_DRIVERS.join(', ')}; got: ${raw}`,
    );
  }
  const driver = raw as StorageDriver;

  if (driver === 's3') {
    const bucket = env.S3_BUCKET;
    if (!bucket) {
      throw new Error('S3_BUCKET is required when FILE_STORAGE_DRIVER is s3');
    }

    const endpoint = env.S3_ENDPOINT || undefined;
    const accessKeyId = env.S3_ACCESS_KEY_ID || undefined;
    const secretAccessKey = env.S3_SECRET_ACCESS_KEY || undefined;
    if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
      throw new Error(
        'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together, or both left unset to use the default credential chain',
      );
    }

    return {
      driver,
      bucket,
      // us-east-1 rather than an AWS-flavored guess: it is what Ceph RGW and MinIO expect, and it
      // is a valid AWS region for anyone who does set S3_REGION explicitly.
      region: env.S3_REGION || 'us-east-1',
      endpoint,
      // Virtual-host addressing needs per-bucket DNS, which self-hosted stores rarely have — so a
      // custom endpoint implies path style unless the operator says otherwise.
      forcePathStyle: parseBoolean(env.S3_FORCE_PATH_STYLE, Boolean(endpoint)),
      prefix: env.S3_PREFIX || undefined,
      credentials:
        accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    };
  }

  return {
    driver,
    basePath:
      env.FILE_STORAGE_LOCAL_BASE_PATH ??
      path.join(resolveDataDir(), 'attachments'),
  };
}
