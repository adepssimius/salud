import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
// `openid-client` ships ESM-only ("type": "module", no CJS build). Under the jest transform's
// `module: commonjs` (apps/api/tsconfig.spec.json), TypeScript downlevels a plain `import` to
// `require()` regardless of whether it's static or dynamic, which the real package rejects. Jest
// substitutes a lightweight mock for this specifier during tests (see jest.config.ts →
// moduleNameMapper, and this module's own __mocks__/openid-client.ts) — production is unaffected,
// since webpack bundles the real ESM package directly rather than going through Node's require().
import * as client from 'openid-client';
import { AuthResponse } from '@salud/shared/types';
import { resolveOidcConfig } from './oidc.config';

export interface OidcClaims {
  sub: string;
  email: string;
  name?: string;
  groups: string[];
}

export interface AuthorizationRequest {
  url: string;
  state: string;
  nonce: string;
  verifier: string;
}

const HANDOFF_TTL_MS = 60_000;

@Injectable()
export class OidcService {
  // Lazy and memoized: discovery is a network call to Authelia, and the API and Authelia can
  // restart independently. Doing this at boot would mean a pod that starts while Authelia happens
  // to be mid-restart crash-loops for an unrelated reason; doing it lazily means only the first
  // OIDC login after a restart pays the discovery round trip.
  private configuration: Promise<client.Configuration> | null = null;

  // In-memory, not a DB table: safe specifically because the api Deployment is pinned to
  // replicas: 1 / strategy: Recreate (deployment.md — the SQLite-on-RWO-volume reason), so
  // there's never a second process without this map, and a pod restart mid-login already means
  // the login has to be retried regardless. Would need to change if Salud ever went
  // multi-replica for unrelated reasons.
  private readonly handoffs = new Map<string, { response: AuthResponse; expiresAt: number }>();

  // Config is resolved before any network call — a missing/invalid AUTHELIA_ISSUER_URL etc. fails
  // synchronously and clearly, the same fail-fast posture resolveJwtSecret() has, rather than
  // surfacing deep inside a discovery request.
  private async discover(): Promise<client.Configuration> {
    if (!this.configuration) {
      const { issuerUrl, clientId, clientSecret } = resolveOidcConfig();
      this.configuration = client.discovery(
        new URL(issuerUrl),
        clientId,
        undefined,
        client.ClientSecretPost(clientSecret),
      );
    }
    return this.configuration;
  }

  async buildAuthorizationRequest(redirectUri: string): Promise<AuthorizationRequest> {
    const configuration = await this.discover();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const verifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(verifier);

    const url = client.buildAuthorizationUrl(configuration, {
      redirect_uri: redirectUri,
      scope: 'openid profile email groups',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return { url: url.toString(), state, nonce, verifier };
  }

  /**
   * Exchanges the authorization code for tokens and returns verified ID token claims.
   * `authorizationCodeGrant` itself validates issuer, audience, signature, expiry, and that
   * `state`/`nonce` match what this request originally sent — a mismatch throws rather than
   * returning something the caller has to remember to check.
   */
  async exchangeCode(params: {
    callbackUrl: URL;
    state: string;
    nonce: string;
    verifier: string;
  }): Promise<OidcClaims> {
    const configuration = await this.discover();
    const tokens = await client.authorizationCodeGrant(configuration, params.callbackUrl, {
      expectedState: params.state,
      expectedNonce: params.nonce,
      pkceCodeVerifier: params.verifier,
    });

    const claims = tokens.claims();
    if (!claims || typeof claims.sub !== 'string' || typeof claims['email'] !== 'string') {
      throw new Error('OIDC ID token is missing required sub or email claims');
    }
    const groups = Array.isArray(claims['groups'])
      ? (claims['groups'] as unknown[]).filter((g): g is string => typeof g === 'string')
      : [];

    return {
      sub: claims.sub,
      email: claims['email'] as string,
      name: typeof claims['name'] === 'string' ? (claims['name'] as string) : undefined,
      groups,
    };
  }

  hasRequiredGroup(claims: OidcClaims): boolean {
    const { requiredGroup } = resolveOidcConfig();
    return claims.groups.includes(requiredGroup);
  }

  /**
   * Parks a freshly-issued salud JWT behind a random, single-use, short-lived code so it never
   * has to travel through a redirect URL or browser history (security.md → "OIDC login") — the
   * SPA immediately exchanges the code over a normal POST instead.
   */
  parkForHandoff(response: AuthResponse): string {
    const code = randomBytes(24).toString('base64url');
    this.handoffs.set(code, { response, expiresAt: Date.now() + HANDOFF_TTL_MS });
    return code;
  }

  /** Single-use: the entry is gone after the first read, whether or not it had expired. */
  redeemHandoff(code: string): AuthResponse | undefined {
    const entry = this.handoffs.get(code);
    this.handoffs.delete(code);
    if (!entry || entry.expiresAt < Date.now()) return undefined;
    return entry.response;
  }
}
