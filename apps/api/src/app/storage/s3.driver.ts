import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { FileStorageDriver } from './file-storage.driver';
import { S3StorageConfig } from './storage.config';

/**
 * S3-compatible object storage driver. Targets the S3 *API*, not the AWS service specifically:
 * with `S3_ENDPOINT` set it drives Ceph RGW, MinIO, R2 or B2 just as well (persistence.md →
 * "File storage"). Same four operations as the local driver, same relative paths — the bucket and
 * optional prefix are this driver's business and never reach a caller.
 */
export class S3FileStorageDriver implements FileStorageDriver {
  readonly bucketLabel: string;
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.bucketLabel = config.bucket;
    this.client = new S3Client({
      region: config.region,
      // Both undefined against real AWS, which is what makes the region-derived endpoint and the
      // default credential chain (IRSA, instance profile) apply.
      endpoint: config.endpoint,
      credentials: config.credentials,
      forcePathStyle: config.forcePathStyle,
    });
  }

  private key(relativePath: string): string {
    return `${this.config.prefix ?? ''}${relativePath}`;
  }

  async write(relativePath: string, buffer: Buffer, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: this.key(relativePath),
        Body: buffer,
        ContentLength: buffer.length,
        ContentType: contentType,
      }),
    );
  }

  async read(relativePath: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: this.key(relativePath) }),
    );
    if (!response.Body) {
      throw new Error(`S3 object has no body: ${this.key(relativePath)}`);
    }
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async createReadStream(relativePath: string): Promise<Readable> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: this.key(relativePath) }),
    );
    if (!response.Body) {
      throw new Error(`S3 object has no body: ${this.key(relativePath)}`);
    }
    // In Node the SDK's mixed-in body is a Readable; the union also covers the browser types.
    return response.Body as Readable;
  }

  async delete(relativePath: string): Promise<void> {
    // DeleteObject is idempotent — a missing key is a 204, matching `fs.rm({ force: true })`.
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: this.key(relativePath) }),
    );
  }

  /** See FileStorageDriver.getSignedUrl — implemented, deliberately not wired to a route. */
  async getSignedUrl(relativePath: string, ttlSeconds: number): Promise<string> {
    return await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: this.key(relativePath) }),
      { expiresIn: ttlSeconds },
    );
  }
}
