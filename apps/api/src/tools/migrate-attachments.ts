/**
 * Copies attachment blobs between two storage backends — local disk ⇄ S3, or S3 ⇄ S3.
 *
 * Switching `FILE_STORAGE_DRIVER` is a data migration, not a config change (app-spec/persistence.md
 * → "Switching drivers is a data migration"). `file_assets` rows live in the database and survive
 * the flip untouched, but their bytes do not move on their own, and reads always resolve through
 * the *currently configured* driver. Flip the driver without running this and every existing
 * attachment becomes a broken image in the timeline and the ER Brief.
 *
 * This is a real, documented utility rather than a one-off script for one cluster's cutover, for
 * the same reason `migrate:sqlite-to-postgres` is: local and s3 are both first-class targets, so
 * "outgrew the local volume, moving to object storage" is a path other self-hosters walk too — as
 * is the reverse, which is why this runs in either direction.
 *
 * Usage — from a checkout:
 *
 *   FILE_STORAGE_DRIVER=s3 S3_BUCKET=... S3_ENDPOINT=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
 *   MIGRATE_SOURCE_DRIVER=local MIGRATE_SOURCE_LOCAL_BASE_PATH=/data/attachments \
 *   DB_CLIENT=postgres DATABASE_URL=postgresql://... \
 *     yarn migrate:attachments --dry-run
 *
 * Usage — in a container (the bundle ships in the api image alongside main.js, so a Job can mount
 * the old volume and run it with the app's own environment):
 *
 *   node migrate-attachments.js
 *
 * The destination is described by the ordinary app storage variables — the same ones the API will
 * run with after the cutover. The source is described by `MIGRATE_SOURCE_*`, parsed by the exact
 * same resolver, so both ends get identical validation:
 *
 *   MIGRATE_SOURCE_DRIVER                 local | s3   (default: local)
 *   MIGRATE_SOURCE_LOCAL_BASE_PATH        local source
 *   MIGRATE_SOURCE_S3_BUCKET              s3 source (required for s3)
 *   MIGRATE_SOURCE_S3_REGION
 *   MIGRATE_SOURCE_S3_ENDPOINT
 *   MIGRATE_SOURCE_S3_FORCE_PATH_STYLE
 *   MIGRATE_SOURCE_S3_PREFIX
 *   MIGRATE_SOURCE_S3_ACCESS_KEY_ID / _SECRET_ACCESS_KEY
 *
 * Flags: --dry-run (report only), --force (re-copy rows already marked as at the destination).
 *
 * What it does, in order:
 *   1. Resolves both backends and refuses to run if they are the same store — a no-op that would
 *      otherwise report a clean success and leave the operator believing the data moved.
 *   2. Enumerates work from `file_assets`, not from a directory listing. The table is the
 *      authoritative list of what the app will try to read; a blob on disk with no row is
 *      unreachable anyway, and a row whose blob is missing is exactly what the operator needs
 *      told about.
 *   3. Copies each blob, then verifies it by reading it *back out of the destination* and
 *      comparing size and SHA-256. Writing without reading back proves only that the SDK call
 *      returned.
 *   4. Updates that row's `bucket` to the destination's label as each blob lands, which makes the
 *      run resumable: an interrupted migration re-run skips what already moved.
 *   5. Exits non-zero if anything failed or any blob was missing at the source, and prints a
 *      per-category summary. A partial success is a failure here — the operator must not flip the
 *      driver on "mostly copied".
 *
 * It never deletes from the source. The old copy is the rollback path until the operator is
 * satisfied, and reclaiming that space is a separate, deliberate act.
 */
import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { fileAssets } from '../db/schema';
import { databaseConnectionProvider } from '../app/persistence/database.providers';
import { resolveStorageConfig, FileStorageConfig, StorageEnv } from '../app/storage/storage.config';
import { createFileStorageDriver } from '../app/storage/storage.providers';
import { FileStorageDriver } from '../app/storage/file-storage.driver';

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

/**
 * Rewrites MIGRATE_SOURCE_* into the variable names resolveStorageConfig already understands, so
 * the source gets the same validation as the destination rather than a second, looser parser.
 */
function sourceEnv(): StorageEnv {
  const e = process.env;
  return {
    FILE_STORAGE_DRIVER: e.MIGRATE_SOURCE_DRIVER ?? 'local',
    FILE_STORAGE_LOCAL_BASE_PATH: e.MIGRATE_SOURCE_LOCAL_BASE_PATH,
    S3_BUCKET: e.MIGRATE_SOURCE_S3_BUCKET,
    S3_REGION: e.MIGRATE_SOURCE_S3_REGION,
    S3_ENDPOINT: e.MIGRATE_SOURCE_S3_ENDPOINT,
    S3_FORCE_PATH_STYLE: e.MIGRATE_SOURCE_S3_FORCE_PATH_STYLE,
    S3_PREFIX: e.MIGRATE_SOURCE_S3_PREFIX,
    S3_ACCESS_KEY_ID: e.MIGRATE_SOURCE_S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: e.MIGRATE_SOURCE_S3_SECRET_ACCESS_KEY,
  };
}

/** Human-readable identity of a backend, used for the same-store guard and the log header. */
export function describeStore(config: FileStorageConfig): string {
  return config.driver === 'local'
    ? `local:${config.basePath}`
    : `s3:${config.bucket}/${config.prefix ?? ''}@${config.endpoint ?? 'aws'}`;
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

interface Row {
  id: string;
  path: string;
  bucket: string;
  sizeBytes: number;
  originalName: string | null;
}

export interface MigrationSummary {
  copied: number;
  skipped: number;
  missing: string[];
  failed: string[];
}

/**
 * Exported for the spec, which drives it with two real local drivers over a temp directory. The
 * verification and bookkeeping are the parts worth testing; the S3 client itself is not.
 */
export async function migrateBlobs(
  rows: Row[],
  source: FileStorageDriver,
  destination: FileStorageDriver,
  onMigrated: (id: string) => Promise<void>,
  options: { dryRun?: boolean; force?: boolean } = {},
): Promise<MigrationSummary> {
  const summary: MigrationSummary = { copied: 0, skipped: 0, missing: [], failed: [] };

  for (const row of rows) {
    // Resumability: a row already stamped with the destination's label moved on an earlier run.
    if (row.bucket === destination.bucketLabel && !options.force) {
      summary.skipped++;
      continue;
    }

    let bytes: Buffer;
    try {
      bytes = await source.read(row.path);
    } catch {
      // A row whose blob is gone is not a transient failure and retrying will not help. Collect
      // it and keep going, so one orphan does not hide the state of everything after it.
      summary.missing.push(`${row.id} (${row.originalName ?? 'unnamed'}) at ${row.path}`);
      continue;
    }

    if (options.dryRun) {
      summary.copied++;
      continue;
    }

    try {
      await destination.write(row.path, bytes);
      // Read back from the destination rather than trusting the write call's return.
      const roundTripped = await destination.read(row.path);
      if (roundTripped.length !== bytes.length || sha256(roundTripped) !== sha256(bytes)) {
        summary.failed.push(`${row.id}: verification mismatch after write`);
        continue;
      }
      await onMigrated(row.id);
      summary.copied++;
    } catch (error) {
      summary.failed.push(`${row.id}: ${(error as Error).message}`);
    }
  }

  return summary;
}

async function main() {
  const destinationConfig = resolveStorageConfig();
  const sourceConfig = resolveStorageConfig(sourceEnv());

  console.log(`Source:      ${describeStore(sourceConfig)}`);
  console.log(`Destination: ${describeStore(destinationConfig)}`);
  if (DRY_RUN) console.log('Mode:        DRY RUN (nothing will be written)');

  if (describeStore(sourceConfig) === describeStore(destinationConfig)) {
    throw new Error(
      'Source and destination are the same store. Set MIGRATE_SOURCE_* to describe where the ' +
        'blobs are now, and the ordinary FILE_STORAGE_DRIVER/S3_* variables to describe where ' +
        'they should end up.',
    );
  }

  const source = createFileStorageDriver(sourceConfig);
  const destination = createFileStorageDriver(destinationConfig);

  const connection: any = await (databaseConnectionProvider as any).useFactory();
  const db = connection.db as any;

  try {
    const rows: Row[] = await db
      .select({
        id: fileAssets.id,
        path: fileAssets.path,
        bucket: fileAssets.bucket,
        sizeBytes: fileAssets.sizeBytes,
        originalName: fileAssets.originalName,
      })
      .from(fileAssets);

    console.log(`\n${rows.length} file_assets row(s) to consider.\n`);

    const summary = await migrateBlobs(
      rows,
      source,
      destination,
      async (id) => {
        await db
          .update(fileAssets)
          .set({ bucket: destination.bucketLabel })
          .where(eq(fileAssets.id, id));
      },
      { dryRun: DRY_RUN, force: FORCE },
    );

    console.log(`Copied:  ${summary.copied}${DRY_RUN ? ' (would copy)' : ''}`);
    console.log(`Skipped: ${summary.skipped} (already at destination)`);

    if (summary.missing.length) {
      console.error(`\nMissing at source (${summary.missing.length}):`);
      for (const entry of summary.missing) console.error(`  - ${entry}`);
      console.error(
        '\nThese rows point at blobs that are not in the source store. They are already broken ' +
          'attachments today; migrating cannot fix them. Investigate before flipping the driver.',
      );
    }
    if (summary.failed.length) {
      console.error(`\nFailed (${summary.failed.length}):`);
      for (const entry of summary.failed) console.error(`  - ${entry}`);
    }

    if (summary.missing.length || summary.failed.length) {
      throw new Error('Migration incomplete — do not switch FILE_STORAGE_DRIVER yet.');
    }

    console.log(
      DRY_RUN
        ? '\nDry run complete. Re-run without --dry-run to copy.'
        : '\nAll blobs copied and verified. The source copy is left intact as a rollback path.',
    );
  } finally {
    // better-sqlite3 exposes close(); pg's Pool exposes end().
    await connection.raw?.end?.();
    connection.raw?.close?.();
  }
}

// Only when invoked as a CLI. Without the guard, importing this module for its exported helpers —
// which the spec does — would run the whole migration and then call process.exit.
if (require.main === module) {
  main().catch((error) => {
    console.error(`\n${error.message}`);
    process.exit(1);
  });
}
