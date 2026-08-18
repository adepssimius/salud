/**
 * Jest stand-in for the real (ESM-only) `openid-client` package — wired via `moduleNameMapper` in
 * `apps/api/jest.config.ts`. `openid-client` ships `"type": "module"` with no CJS build; under
 * this repo's jest transform (`module: commonjs`, apps/api/tsconfig.spec.json), any `require()` of
 * the real file throws `SyntaxError: Cannot use import statement outside a module`, static or
 * dynamic import alike. Production is unaffected — webpack bundles the real ESM package directly,
 * never through Node's `require()`.
 *
 * This mirrors only the surface `oidc.service.ts` actually calls. It does not re-implement OIDC
 * semantics (issuer verification, JWT signature checks, real PKCE) — that correctness is
 * `openid-client`'s own test suite's job, not this codebase's. What it buys is deterministic
 * route-wiring and happy-path e2e coverage (`oidc.e2e-spec.ts`) without a real or stubbed IdP.
 */

export class Configuration {
  constructor(
    public readonly issuerUrl: string,
    public readonly clientId: string,
  ) {}
}

export function discovery(server: URL, clientId: string): Promise<Configuration> {
  return Promise.resolve(new Configuration(server.toString(), clientId));
}

export function ClientSecretPost(secret?: string) {
  return { method: 'client_secret_post' as const, secret };
}

// Fixed rather than random: several e2e tests need to know the state value in advance to build a
// valid callback URL without scraping it out of a redirect Location first.
export function randomState(): string {
  return 'mock-state';
}

export function randomNonce(): string {
  return 'mock-nonce';
}

export function randomPKCECodeVerifier(): string {
  return 'mock-verifier';
}

export function calculatePKCECodeChallenge(verifier: string): Promise<string> {
  return Promise.resolve(`mock-challenge-${verifier}`);
}

export function buildAuthorizationUrl(
  configuration: Configuration,
  parameters: Record<string, string>,
): URL {
  const url = new URL(`${configuration.issuerUrl}authorize`);
  url.searchParams.set('client_id', configuration.clientId);
  url.searchParams.set('response_type', 'code');
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }
  return url;
}

// Test-controlled fixtures: a test registers the claims a given authorization `code` should
// resolve to, then hits the callback URL with `?code=<that code>`. Nothing in production code
// ever calls these two.
const claimsByCode = new Map<string, Record<string, unknown>>();

export function __setMockClaims(code: string, claims: Record<string, unknown>): void {
  claimsByCode.set(code, claims);
}

export function __resetMockClaims(): void {
  claimsByCode.clear();
}

export function authorizationCodeGrant(
  _configuration: Configuration,
  currentUrl: URL,
  checks?: { expectedState?: string },
): Promise<{ claims: () => Record<string, unknown> | undefined }> {
  const returnedState = currentUrl.searchParams.get('state');
  if (checks?.expectedState !== undefined && returnedState !== checks.expectedState) {
    return Promise.reject(new Error('mock openid-client: state mismatch'));
  }
  const code = currentUrl.searchParams.get('code');
  const claims = code ? claimsByCode.get(code) : undefined;
  if (!claims) {
    return Promise.reject(
      new Error('mock openid-client: no claims registered for this code — call __setMockClaims first'),
    );
  }
  return Promise.resolve({ claims: () => claims });
}
