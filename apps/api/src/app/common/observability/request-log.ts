/**
 * Formatting and redaction for the HTTP access log.
 *
 * Pure functions, no Nest and no Express types beyond the two fields each one reads, so the
 * redaction rules below can be unit-tested directly — they are the part that must not regress.
 *
 * WHAT IS DELIBERATELY NOT LOGGED, and why:
 *  - **Request bodies.** Every write path in this app carries clinical data (temperatures, doses,
 *    symptom notes, a child's weight) and `POST /api/auth/register|login` carries a plaintext
 *    password. There is no body worth logging that is safe to log.
 *  - **Query values.** `GET /api/users/search?email=` is an email address and
 *    `GET /api/medications?q=` is a free-text search. Only the parameter *names* are kept — enough
 *    to tell `?from,to` from `?episodeId` when reading a slow-request line, with none of the data.
 *  - **The `Authorization` header**, or any header at all.
 *  - **The ER Brief share token**, which `app-spec/security.md` defines as the capability itself:
 *    anyone holding the link can read the brief. A token in a log line is a leaked credential that
 *    outlives the request, so it is stripped before the path is ever handed to the logger.
 *
 * The patient/observation UUIDs left in the path are opaque internal identifiers, and are what
 * makes a line actionable when a caregiver reports "it failed on this patient".
 */

/** `/api/er-brief/shared/:token` — the one path segment that is a credential. */
const SHARED_BRIEF_PATH = /^(\/api\/er-brief\/shared\/)[^/?#]+/;

/**
 * The request path with the share token removed and the query reduced to its parameter names.
 * Takes `originalUrl` (not `path`) so the query is visible to be reduced in the first place.
 */
export function redactUrl(originalUrl: string): string {
  const [rawPath, rawQuery] = splitQuery(originalUrl);
  const path = rawPath.replace(SHARED_BRIEF_PATH, '$1[redacted]');
  if (!rawQuery) return path;

  const names = new Set<string>();
  for (const pair of rawQuery.split('&')) {
    if (!pair) continue;
    const name = pair.split('=')[0];
    // An empty name (a stray "&&" or a leading "=") carries no information worth a log character.
    if (name) names.add(decodeURIComponent(name));
  }
  if (!names.size) return path;
  return `${path}?${[...names].sort().join(',')}`;
}

function splitQuery(url: string): [string, string | null] {
  const i = url.indexOf('?');
  if (i === -1) return [url, null];
  return [url.slice(0, i), url.slice(i + 1)];
}

export interface AccessLogFields {
  method: string;
  originalUrl: string;
  statusCode: number;
  durationMs: number;
  userId?: string;
  /** The machine-readable code from the thrown exception, when there was one. */
  errorCode?: string;
  /**
   * The response never finished writing because the connection died first. Note this cannot see
   * every abandoned request — see the note in `app.observability.ts`.
   */
  aborted?: boolean;
}

/**
 * One line per request. Key=value rather than JSON because the only reader today is
 * `kubectl logs` (deployment.md names no log aggregator), and `grep SLOW` / `grep ' 5[0-9][0-9] '`
 * has to work by eye.
 */
export function formatAccessLine(f: AccessLogFields, slowMs: number): string {
  const parts = [f.method, redactUrl(f.originalUrl), String(f.statusCode), `${f.durationMs}ms`];
  if (f.userId) parts.push(`user=${f.userId}`);
  if (f.errorCode) parts.push(`code=${f.errorCode}`);
  // The two markers worth grepping for.
  if (f.aborted) parts.push('ABORTED');
  if (f.durationMs >= slowMs) parts.push('SLOW');
  return parts.join(' ');
}

export type LogLevel = 'error' | 'warn' | 'log';

/**
 * 5xx is an error, 4xx is a warning, and an otherwise-fine request that took too long is also a
 * warning — the point of the threshold is that slow successes are exactly what a latency
 * complaint is made of, and they are invisible if success is always logged quietly.
 */
export function levelFor(statusCode: number, durationMs: number, slowMs: number): LogLevel {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  if (durationMs >= slowMs) return 'warn';
  return 'log';
}

/**
 * Successful liveness/readiness probes only. The kubelet hits these every few seconds forever;
 * logging them buries every real line in the pod's log. A probe that *fails* is left to log
 * loudly — that is a genuine event, and the readiness probe's 503 is how a sick database surfaces.
 */
export function isSuppressedProbe(url: string, statusCode: number): boolean {
  if (statusCode >= 400) return false;
  const [path] = splitQuery(url);
  return path === '/api/health' || path === '/api/health/ready';
}
