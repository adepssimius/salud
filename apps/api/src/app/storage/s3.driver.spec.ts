import { randomUUID } from 'crypto';
import { S3FileStorageDriver } from './s3.driver';

/**
 * Opt-in integration spec: skipped unless S3_TEST_ENDPOINT points at a reachable S3-compatible
 * store, so CI stays Docker-free (the same reason the DB suites run on pglite rather than a
 * container). To run it locally:
 *
 *   docker run -d -p 9000:9000 -e MINIO_ROOT_USER=salud -e MINIO_ROOT_PASSWORD=salud12345 \
 *     minio/minio server /data
 *   # create the bucket, then:
 *   S3_TEST_ENDPOINT=http://localhost:9000 S3_TEST_BUCKET=salud-attachments \
 *     S3_TEST_ACCESS_KEY_ID=salud S3_TEST_SECRET_ACCESS_KEY=salud12345 \
 *     yarn test:api --testPathPattern=s3.driver
 */
const endpoint = process.env.S3_TEST_ENDPOINT;
const bucket = process.env.S3_TEST_BUCKET;
const describeIfS3 = endpoint && bucket ? describe : describe.skip;

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describeIfS3('S3FileStorageDriver (integration)', () => {
  const driver = new S3FileStorageDriver({
    driver: 's3',
    bucket: bucket as string,
    region: process.env.S3_TEST_REGION || 'us-east-1',
    endpoint,
    forcePathStyle: true,
    prefix: 'spec/',
    credentials:
      process.env.S3_TEST_ACCESS_KEY_ID && process.env.S3_TEST_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY,
          }
        : undefined,
  });

  const key = `${randomUUID()}.bin`;

  afterAll(async () => {
    await driver.delete(key).catch(() => undefined);
  });

  it('round-trips bytes through write / read / createReadStream / delete', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x1a, 0x0a]);
    await driver.write(key, bytes, 'application/octet-stream');

    expect(await driver.read(key)).toEqual(bytes);
    expect(await collect(await driver.createReadStream(key))).toEqual(bytes);

    await driver.delete(key);
    await expect(driver.read(key)).rejects.toThrow();
  });

  it('treats deleting a missing object as a no-op', async () => {
    await expect(driver.delete(`${randomUUID()}.bin`)).resolves.toBeUndefined();
  });

  it('reports the bucket name as the label recorded on file_assets rows', () => {
    expect(driver.bucketLabel).toBe(bucket);
  });

  it('presigns a GET that serves the bytes without an Authorization header', async () => {
    const bytes = Buffer.from('presigned');
    await driver.write(key, bytes, 'text/plain');
    const url = await driver.getSignedUrl(key, 60);
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });
});
