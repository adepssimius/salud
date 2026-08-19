import { Readable } from 'stream';

/**
 * The storage contract every driver implements. Kept deliberately small — four operations, all
 * keyed by a server-generated relative path — because that is the entire surface the rest of the
 * API needs (`files.service.ts` writes and streams, `lab-imports.service.ts` reads whole bytes,
 * `patients.service.ts` deletes). Anything wider would start leaking filesystem or bucket
 * semantics into callers, which is exactly what this indirection exists to prevent.
 */
export interface FileStorageDriver {
  /**
   * Label recorded in `file_assets.bucket` for blobs this driver writes — the literal `local`, or
   * the bucket name under s3. Nothing dual-reads it today (persistence.md → "Switching drivers is
   * a data migration"); it exists so a future local↔s3 copy tool can tell blobs apart.
   */
  readonly bucketLabel: string;

  write(relativePath: string, buffer: Buffer, contentType?: string): Promise<void>;

  /** Whole-file read for consumers that must parse the bytes (lab imports). */
  read(relativePath: string): Promise<Buffer>;

  /**
   * Async, and typed as the base `Readable`, because S3's GetObject cannot be resolved
   * synchronously and its body is not an `fs.ReadStream`. `StreamableFile` accepts either.
   */
  createReadStream(relativePath: string): Promise<Readable>;

  /** Best-effort delete; missing objects are not an error (see patients.service.ts). */
  delete(relativePath: string): Promise<void>;

  /**
   * Presigned-URL seam, implemented by s3 only and **deliberately unused** by the controller.
   * api.md → Files explains why bytes still proxy through the API on both drivers: the web client
   * needs the Authorization header, and the download route is where the hardened CSP lives.
   */
  getSignedUrl?(relativePath: string, ttlSeconds: number): Promise<string>;
}
