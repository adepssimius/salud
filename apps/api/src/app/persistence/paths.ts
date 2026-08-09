import fs from 'fs';
import path from 'path';
import { isProduction } from '../config/env';

/**
 * Resolve a writable data directory, preferring the container-friendly /data path.
 *
 * The cwd fallback exists for local dev, where `/data` is not writable and nobody wants to
 * create it by hand. In production it is a trap (ISSUES #27): if the PVC mounted at /data is
 * not writable by the container's uid, the API would silently fall back to the pod's ephemeral
 * filesystem, appear to work, and lose every patient record and attachment on the next restart
 * with nothing in the logs. A pod that cannot reach its volume must fail loudly instead.
 */
export function resolveDataDir(): string {
  const preferred = process.env.DATA_DIR ?? '/data';
  const fallback = path.join(process.cwd(), 'data');
  try {
    fs.mkdirSync(preferred, { recursive: true });
    // mkdirSync succeeds on an already-existing directory regardless of its mode, so the
    // interesting failure — a volume mounted with the wrong owner — only shows up here.
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch (err) {
    if (isProduction()) {
      throw new Error(
        `Data directory ${preferred} is not writable (${(err as Error).message}). ` +
          'Refusing to fall back to ephemeral storage — check the volume mount and fsGroup.',
      );
    }
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}
