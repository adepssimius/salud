import {
  formatAccessLine,
  isSuppressedProbe,
  levelFor,
  redactUrl,
} from './request-log';

describe('redactUrl', () => {
  it('keeps a plain path untouched', () => {
    expect(redactUrl('/api/dashboard')).toBe('/api/dashboard');
  });

  it('keeps resource ids, which are what make a line actionable', () => {
    expect(redactUrl('/api/patients/2116550f-9530-4dde-9601-d206c77fa998/timeline')).toBe(
      '/api/patients/2116550f-9530-4dde-9601-d206c77fa998/timeline',
    );
  });

  it('reduces the query to its parameter names, dropping every value', () => {
    expect(redactUrl('/api/patients/p1/timeline?from=1700000000&to=1700086400')).toBe(
      '/api/patients/p1/timeline?from,to',
    );
  });

  // The reason the rule is names-only rather than an allowlist of "safe" parameters.
  it('never leaks a search term or an email address', () => {
    expect(redactUrl('/api/users/search?email=parent@example.com')).toBe('/api/users/search?email');
    expect(redactUrl('/api/medications?q=amoxicillin&tag=antibiotic')).toBe(
      '/api/medications?q,tag',
    );
  });

  it('sorts and de-duplicates parameter names so the same request logs the same way', () => {
    expect(redactUrl('/api/x?to=2&from=1&to=3')).toBe('/api/x?from,to');
  });

  // app-spec/security.md: the token IS the capability. A leaked log line is a leaked brief.
  it('redacts the ER Brief share token', () => {
    expect(redactUrl('/api/er-brief/shared/uAqRSbT2Xk9wq3nP0ZlLmO7yH1cD4vF8gJ6kN2sQ5tY')).toBe(
      '/api/er-brief/shared/[redacted]',
    );
  });

  it('redacts the share token even with a query attached', () => {
    expect(redactUrl('/api/er-brief/shared/secret-token?format=json')).toBe(
      '/api/er-brief/shared/[redacted]?format',
    );
  });

  it('does not confuse the authenticated snapshot routes with the public token route', () => {
    expect(redactUrl('/api/er-brief/snapshots/abc123')).toBe('/api/er-brief/snapshots/abc123');
  });

  it('tolerates a malformed query without emitting a stray separator', () => {
    expect(redactUrl('/api/x?')).toBe('/api/x');
    expect(redactUrl('/api/x?&&')).toBe('/api/x');
    expect(redactUrl('/api/x?=novalue')).toBe('/api/x');
  });
});

describe('formatAccessLine', () => {
  const base = { method: 'GET', originalUrl: '/api/dashboard', statusCode: 200, durationMs: 12 };

  it('writes one greppable line', () => {
    expect(formatAccessLine({ ...base, userId: 'u1' }, 1000)).toBe(
      'GET /api/dashboard 200 12ms user=u1',
    );
  });

  it('omits the user on an unauthenticated request', () => {
    expect(formatAccessLine(base, 1000)).toBe('GET /api/dashboard 200 12ms');
  });

  it('carries the error code so a failure is identifiable without the response body', () => {
    expect(
      formatAccessLine(
        { ...base, statusCode: 404, errorCode: 'PATIENT_NOT_FOUND', userId: 'u1' },
        1000,
      ),
    ).toBe('GET /api/dashboard 404 12ms user=u1 code=PATIENT_NOT_FOUND');
  });

  it('tags a slow request', () => {
    expect(formatAccessLine({ ...base, durationMs: 1500 }, 1000)).toBe(
      'GET /api/dashboard 200 1500ms SLOW',
    );
  });

  it('tags a request whose connection died before the response finished', () => {
    expect(formatAccessLine({ ...base, aborted: true }, 1000)).toBe(
      'GET /api/dashboard 200 12ms ABORTED',
    );
  });
});

describe('levelFor', () => {
  it.each([
    [500, 10, 'error'],
    [503, 10, 'error'],
    [404, 10, 'warn'],
    [400, 10, 'warn'],
    [401, 10, 'warn'],
    [200, 10, 'log'],
    [201, 10, 'log'],
    [304, 10, 'log'],
  ])('status %i at %ims logs as %s', (status, ms, expected) => {
    expect(levelFor(status as number, ms as number, 1000)).toBe(expected);
  });

  // A slow success is the whole substance of a "the app is slow" report.
  it('raises a slow success to warn', () => {
    expect(levelFor(200, 1000, 1000)).toBe('warn');
    expect(levelFor(200, 999, 1000)).toBe('log');
  });
});

describe('isSuppressedProbe', () => {
  it('suppresses successful kubelet probes, which would otherwise bury every real line', () => {
    expect(isSuppressedProbe('/api/health', 200)).toBe(true);
    expect(isSuppressedProbe('/api/health/ready', 200)).toBe(true);
  });

  it('never suppresses a failing probe — a 503 readiness is how a sick database surfaces', () => {
    expect(isSuppressedProbe('/api/health/ready', 503)).toBe(false);
  });

  it('does not suppress ordinary traffic', () => {
    expect(isSuppressedProbe('/api/dashboard', 200)).toBe(false);
    expect(isSuppressedProbe('/api/health-check-something', 200)).toBe(false);
  });
});
