import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { FileStorageDriver } from './file-storage.driver';
import { LocalStorageConfig } from './storage.config';

/**
 * Filesystem driver — the zero-config default a self-hoster gets (persistence.md → "File storage").
 * Bodies moved here verbatim from the old StorageService; the containment guard in resolvePath is
 * the one addition.
 */
export class LocalFileStorageDriver implements FileStorageDriver {
  readonly bucketLabel = 'local';

  constructor(private readonly config: LocalStorageConfig) {
    // Errors bubble so misconfiguration is obvious at boot rather than at first upload.
    fs.mkdirSync(this.config.basePath, { recursive: true });
  }

  get basePath() {
    return this.config.basePath;
  }

  /**
   * Every path reaching here is a server-generated UUID plus the uploaded file's extension, so
   * traversal is not currently reachable. The guard is here so that stops being load-bearing —
   * a future caller that derives a path from user input fails loudly instead of writing outside
   * the attachments directory.
   */
  resolvePath(relativePath: string): string {
    const base = path.resolve(this.config.basePath);
    const full = path.resolve(base, relativePath);
    if (full !== base && !full.startsWith(base + path.sep)) {
      throw new Error(`Storage path escapes the base directory: ${relativePath}`);
    }
    return full;
  }

  async write(relativePath: string, buffer: Buffer): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, buffer);
  }

  async read(relativePath: string): Promise<Buffer> {
    return await fs.promises.readFile(this.resolvePath(relativePath));
  }

  async createReadStream(relativePath: string): Promise<Readable> {
    return fs.createReadStream(this.resolvePath(relativePath));
  }

  async delete(relativePath: string): Promise<void> {
    await fs.promises.rm(this.resolvePath(relativePath), { force: true });
  }
}
