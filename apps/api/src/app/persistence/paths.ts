import fs from 'fs';
import path from 'path';

// Resolve a writable data directory, preferring the container-friendly /data path.
export function resolveDataDir(): string {
  const preferred = process.env.DATA_DIR ?? '/data';
  const fallback = path.join(process.cwd(), 'data');
  try {
    fs.mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch {
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}
