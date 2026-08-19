import fs from 'fs';
import os from 'os';
import path from 'path';
import { LocalFileStorageDriver } from '../app/storage/local.driver';
import { migrateBlobs, describeStore } from './migrate-attachments';

/**
 * Driven with two real local drivers over temp directories. The bookkeeping is what matters here —
 * what gets copied, what gets skipped on a re-run, and what an operator is told about a row whose
 * blob is gone. The S3 client itself is covered by s3.driver.spec.ts.
 */
describe('migrateBlobs', () => {
  let sourceDir: string;
  let destDir: string;
  let source: LocalFileStorageDriver;
  let destination: LocalFileStorageDriver;
  let stamped: string[];

  const row = (id: string, bucket = 'local', originalName: string | null = null) => ({
    id,
    path: `${id}.bin`,
    bucket,
    sizeBytes: 3,
    originalName,
  });

  beforeEach(() => {
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-mig-src-'));
    destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-mig-dst-'));
    source = new LocalFileStorageDriver({ driver: 'local', basePath: sourceDir });
    // Distinct label so the "already at destination" skip is actually exercised.
    destination = new LocalFileStorageDriver({ driver: 'local', basePath: destDir });
    Object.defineProperty(destination, 'bucketLabel', { value: 'destination-store' });
    stamped = [];
  });

  afterEach(() => {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(destDir, { recursive: true, force: true });
  });

  const onMigrated = async (id: string) => {
    stamped.push(id);
  };

  it('copies each blob and stamps the row only once it is verified at the destination', async () => {
    await source.write('a.bin', Buffer.from('aaa'));
    await source.write('b.bin', Buffer.from('bbb'));

    const summary = await migrateBlobs([row('a'), row('b')], source, destination, onMigrated);

    expect(summary).toMatchObject({ copied: 2, skipped: 0, missing: [], failed: [] });
    expect(stamped.sort()).toEqual(['a', 'b']);
    expect(await destination.read('a.bin')).toEqual(Buffer.from('aaa'));
    expect(await destination.read('b.bin')).toEqual(Buffer.from('bbb'));
  });

  it('leaves the source copy in place as a rollback path', async () => {
    await source.write('a.bin', Buffer.from('aaa'));
    await migrateBlobs([row('a')], source, destination, onMigrated);
    expect(await source.read('a.bin')).toEqual(Buffer.from('aaa'));
  });

  it('skips rows already stamped with the destination, so an interrupted run resumes', async () => {
    await source.write('a.bin', Buffer.from('aaa'));
    await source.write('b.bin', Buffer.from('bbb'));

    const summary = await migrateBlobs(
      [row('a', 'destination-store'), row('b')],
      source,
      destination,
      onMigrated,
    );

    expect(summary).toMatchObject({ copied: 1, skipped: 1 });
    expect(stamped).toEqual(['b']);
    expect(fs.existsSync(path.join(destDir, 'a.bin'))).toBe(false);
  });

  it('re-copies an already-stamped row under --force', async () => {
    await source.write('a.bin', Buffer.from('aaa'));
    const summary = await migrateBlobs(
      [row('a', 'destination-store')],
      source,
      destination,
      onMigrated,
      { force: true },
    );
    expect(summary).toMatchObject({ copied: 1, skipped: 0 });
  });

  it('reports a row whose blob is missing and never stamps it', async () => {
    await source.write('a.bin', Buffer.from('aaa'));

    const summary = await migrateBlobs(
      [row('a'), row('gone', 'local', 'labs.pdf')],
      source,
      destination,
      onMigrated,
    );

    expect(summary.copied).toBe(1);
    expect(summary.missing).toHaveLength(1);
    // The operator needs the display name to find it, not just an opaque uuid.
    expect(summary.missing[0]).toContain('labs.pdf');
    expect(stamped).toEqual(['a']);
  });

  it('writes nothing and stamps nothing in dry-run mode', async () => {
    await source.write('a.bin', Buffer.from('aaa'));

    const summary = await migrateBlobs([row('a')], source, destination, onMigrated, {
      dryRun: true,
    });

    expect(summary.copied).toBe(1);
    expect(stamped).toEqual([]);
    expect(fs.existsSync(path.join(destDir, 'a.bin'))).toBe(false);
  });

  it('records a failure rather than stamping when the destination write throws', async () => {
    await source.write('a.bin', Buffer.from('aaa'));
    jest.spyOn(destination, 'write').mockRejectedValueOnce(new Error('bucket unreachable'));

    const summary = await migrateBlobs([row('a')], source, destination, onMigrated);

    expect(summary.copied).toBe(0);
    expect(summary.failed[0]).toContain('bucket unreachable');
    expect(stamped).toEqual([]);
  });

  it('catches a destination that accepts the write but returns different bytes', async () => {
    await source.write('a.bin', Buffer.from('aaa'));
    jest.spyOn(destination, 'read').mockResolvedValueOnce(Buffer.from('xxx'));

    const summary = await migrateBlobs([row('a')], source, destination, onMigrated);

    expect(summary.copied).toBe(0);
    expect(summary.failed[0]).toContain('verification mismatch');
    expect(stamped).toEqual([]);
  });
});

describe('describeStore', () => {
  it('distinguishes two buckets on the same endpoint', () => {
    const base = { driver: 's3' as const, region: 'us-east-1', forcePathStyle: true, endpoint: 'http://rgw' };
    expect(describeStore({ ...base, bucket: 'a' })).not.toBe(describeStore({ ...base, bucket: 'b' }));
  });

  it('distinguishes two prefixes in the same bucket', () => {
    const base = { driver: 's3' as const, bucket: 'a', region: 'us-east-1', forcePathStyle: true };
    expect(describeStore({ ...base, prefix: 'x/' })).not.toBe(describeStore({ ...base, prefix: 'y/' }));
  });

  it('treats the same local path as the same store', () => {
    expect(describeStore({ driver: 'local', basePath: '/data/attachments' })).toBe(
      describeStore({ driver: 'local', basePath: '/data/attachments' }),
    );
  });
});
