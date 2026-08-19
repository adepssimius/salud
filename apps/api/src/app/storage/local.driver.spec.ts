import fs from 'fs';
import os from 'os';
import path from 'path';
import { LocalFileStorageDriver } from './local.driver';

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe('LocalFileStorageDriver', () => {
  let basePath: string;
  let driver: LocalFileStorageDriver;

  beforeEach(() => {
    basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'salud-local-driver-'));
    driver = new LocalFileStorageDriver({ driver: 'local', basePath });
  });

  afterEach(() => {
    fs.rmSync(basePath, { recursive: true, force: true });
  });

  it('creates the base directory on construction', () => {
    const missing = path.join(basePath, 'nested', 'attachments');
    new LocalFileStorageDriver({ driver: 'local', basePath: missing });
    expect(fs.existsSync(missing)).toBe(true);
  });

  it('round-trips bytes through write / read / createReadStream / delete', async () => {
    // Deliberately not text: the whole surface is content-agnostic, so the byte-for-byte check
    // is the one that matters.
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x1a, 0x0a]);
    await driver.write('abc.png', bytes, 'image/png');

    expect(await driver.read('abc.png')).toEqual(bytes);
    expect(await collect(await driver.createReadStream('abc.png'))).toEqual(bytes);

    await driver.delete('abc.png');
    expect(fs.existsSync(path.join(basePath, 'abc.png'))).toBe(false);
  });

  it('creates intermediate directories for a prefixed path', async () => {
    await driver.write('2026/08/abc.bin', Buffer.from('x'));
    expect(await driver.read('2026/08/abc.bin')).toEqual(Buffer.from('x'));
  });

  it('treats deleting a missing object as a no-op, like S3 DeleteObject', async () => {
    await expect(driver.delete('never-existed.bin')).resolves.toBeUndefined();
  });

  it('refuses a path that escapes the base directory', async () => {
    await expect(driver.write('../escaped.bin', Buffer.from('x'))).rejects.toThrow(
      /escapes the base directory/,
    );
    await expect(driver.read('../../etc/passwd')).rejects.toThrow(/escapes the base directory/);
  });

  it('reports the bucket label recorded on file_assets rows', () => {
    expect(driver.bucketLabel).toBe('local');
  });
});
