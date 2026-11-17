import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

/**
 * Where the repo catalog file is fetched from (api.md → "Repo catalog").
 *
 * Read from the environment on every call, never from a request: the URL is configuration, and a
 * caller able to choose it could make the API fetch any host it can reach. Read per call rather
 * than once at boot, which is also what lets the e2e suite repoint it between requests.
 */
export const DEFAULT_CATALOG_SEED_URL =
  'https://raw.githubusercontent.com/adepssimius/salud/main/catalog/medication-catalog.json';

export const CATALOG_FETCH_TIMEOUT_MS = 10_000;
export const CATALOG_MAX_BYTES = 256 * 1024;

export class CatalogSourceNotConfigured extends Error {}
export class CatalogSourceUnavailable extends Error {}

export interface CatalogSource {
  url: string;
  text: string;
  /** SHA-256 hex of the fetched bytes — what apply compares against the preview. */
  hash: string;
}

export function resolveCatalogSeedUrl(): string {
  const configured = process.env.CATALOG_SEED_URL;
  if (configured === undefined) return DEFAULT_CATALOG_SEED_URL;
  return configured.trim();
}

async function readFileSource(url: string): Promise<Buffer> {
  const path = fileURLToPath(url);
  const stat = await fs.stat(path);
  if (stat.size > CATALOG_MAX_BYTES) throw new CatalogSourceUnavailable(`${url} is over ${CATALOG_MAX_BYTES} bytes`);
  return fs.readFile(path);
}

async function readHttpSource(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS),
    redirect: 'follow',
    headers: { accept: 'application/json, text/plain' },
  });
  if (!response.ok) throw new CatalogSourceUnavailable(`${url} answered ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > CATALOG_MAX_BYTES) {
    throw new CatalogSourceUnavailable(`${url} declares ${declared} bytes, over ${CATALOG_MAX_BYTES}`);
  }
  // Counted while streaming as well: content-length is optional and a server is free to lie.
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > CATALOG_MAX_BYTES) {
      await reader.cancel();
      throw new CatalogSourceUnavailable(`${url} is over ${CATALOG_MAX_BYTES} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function fetchCatalogSource(): Promise<CatalogSource> {
  const url = resolveCatalogSeedUrl();
  if (!url) throw new CatalogSourceNotConfigured('CATALOG_SEED_URL is empty');

  let bytes: Buffer;
  try {
    if (url.startsWith('file:')) bytes = await readFileSource(url);
    else if (url.startsWith('https:') || url.startsWith('http:')) bytes = await readHttpSource(url);
    else throw new CatalogSourceUnavailable(`unsupported CATALOG_SEED_URL scheme: ${url}`);
  } catch (err) {
    if (err instanceof CatalogSourceUnavailable) throw err;
    throw new CatalogSourceUnavailable(`${url}: ${(err as Error).message}`);
  }

  return {
    url,
    text: bytes.toString('utf8'),
    hash: createHash('sha256').update(bytes).digest('hex'),
  };
}
