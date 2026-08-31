import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { and, eq, isNull, lt } from 'drizzle-orm';
// `openid-client` ships ESM-only ("type": "module", no CJS build). Under the jest transform's
// `module: commonjs` (apps/api/tsconfig.spec.json), TypeScript downlevels a plain `import` to
// `require()` regardless of whether it's static or dynamic, which the real package rejects. Jest
// substitutes a lightweight mock for this specifier during tests (see jest.config.ts →
// moduleNameMapper, and this module's own __mocks__/openid-client.ts) — production is unaffected,
// since webpack bundles the real ESM package directly rather than going through Node's require().
import * as client from 'openid-client';
import { resolveOidcConfig } from './oidc.config';
import { DatabaseService } from '../../persistence/database.service';
import { toDate } from '../../persistence/time';
import { oidcHandoffs } from '../../../db/schema';

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

// Five minutes, not the 60 seconds this shipped with. The window has to cover a cold index.html
// plus the lazy /oidc-complete chunk on a phone with a bad signal, and nothing is weakened by the
// extra minutes: the code is single-use, high-entropy, stored only as a hash, and useless without
// also being the first to present it. A caregiver retrying a login they were told had "expired"
// is the failure this trades against.
const HANDOFF_TTL_MS = 5 * 60_000;

// How long a spent or expired row is kept before the sweep reclaims it. Not tidiness: a row that
// is gone is indistinguishable from a code that was never issued, so sweeping on the TTL itself
// would turn every honestly-expired code into "unknown" in the logs and in what the caregiver is
// told. An hour is far longer than anyone retries a login, and the table is a handful of rows.
const HANDOFF_RETENTION_MS = 60 * 60_000;

/** Why a handoff code could not be redeemed — the exchange route maps these to distinct codes. */
export type HandoffFailure = 'expired' | 'already_used' | 'unknown';

/**
 * Both members declare both fields (one of them `?: undefined`) rather than only their own. This
 * project compiles without `strictNullChecks` (no `strict` in any tsconfig), and without it TS
 * does not narrow a union on a boolean literal discriminant — `if (!result.ok)` still leaves
 * `result.reason` an error on the success member. Spelling both fields out keeps the union honest
 * under strict mode, should this ever turn it on, while compiling today.
 */
export type RedeemResult =
  | { ok: true; userId: string; reason?: undefined }
  | { ok: false; reason: HandoffFailure; userId?: undefined };

@Injectable()
export class OidcService {
  // Lazy and memoized: discovery is a network call to Authelia, and the API and Authelia can
  // restart independently. Doing this at boot would mean a pod that starts while Authelia happens
  // to be mid-restart crash-loops for an unrelated reason; doing it lazily means only the first
  // OIDC login after a restart pays the discovery round trip.
  private configuration: Promise<client.Configuration> | null = null;

  constructor(private readonly db: DatabaseService) {}

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
   * Parks the resolved user behind a random, single-use, short-lived code, so the session itself
   * never has to travel through a redirect URL or browser history (security.md → "OIDC login") —
   * the SPA exchanges the code over a normal POST instead, and the JWT is minted there.
   *
   * A row, not an in-process Map. The callback and the exchange are two independent HTTP
   * requests: with salud-api on replicas: 2 they are load-balanced separately, so an in-memory
   * code parked by one pod was simply absent when the other was asked for it — about half of all
   * logins, reported as "this sign-in link has expired or was already used". Shared storage also
   * survives the rolling deploy that would strand an in-process login even at one replica.
   */
  async parkForHandoff(userId: string): Promise<string> {
    const db = this.db.db as any;
    const code = randomBytes(24).toString('base64url');
    const now = new Date();

    // Opportunistic sweep, so this table stays a handful of rows instead of growing forever.
    // Cheap (indexed, tiny), and it needs no cron or boot hook to be correct — every login pays a
    // fraction of it. Retention, not expiry, is the cutoff: see HANDOFF_RETENTION_MS.
    await db
      .delete(oidcHandoffs)
      .where(lt(oidcHandoffs.expiresAt, new Date(now.getTime() - HANDOFF_RETENTION_MS)));

    await db.insert(oidcHandoffs).values({
      id: randomUUID(),
      codeHash: hashCode(code),
      userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + HANDOFF_TTL_MS),
    });
    return code;
  }

  /**
   * Single-use, enforced by the database rather than by read-then-write: the UPDATE matches only
   * a row that is still unredeemed and still unexpired, so two pods (or a double-submitting
   * browser) racing the same code cannot both come away with a session — exactly one UPDATE
   * matches, and the loser is told the code was already used.
   *
   * The distinction between `already_used`, `expired` and `unknown` is only ever logged and
   * mapped to an error code; all three are equally a refusal, and the caller does not vary what
   * it grants based on which one it was.
   */
  async redeemHandoff(code: string): Promise<RedeemResult> {
    const db = this.db.db as any;
    const now = new Date();
    const codeHash = hashCode(code);

    const claimed = await db
      .update(oidcHandoffs)
      .set({ redeemedAt: now })
      .where(and(eq(oidcHandoffs.codeHash, codeHash), isNull(oidcHandoffs.redeemedAt)))
      .returning({ userId: oidcHandoffs.userId, expiresAt: oidcHandoffs.expiresAt });

    if (claimed.length) {
      // Claimed, so no one else can now use it — but an expired code still buys nothing. Marking
      // it redeemed on the way past is deliberate: a code presented late is spent, not retryable.
      const row = claimed[0];
      // `!` per time.ts: expires_at is NOT NULL, and toDate is only nullable to stay symmetric
      // with normalizeTs. Never hand a row's timestamp straight to date arithmetic (CLAUDE.md →
      // Timestamps) — SQLite returns epoch seconds here where Postgres returns a Date.
      if (toDate(row.expiresAt)!.getTime() < now.getTime()) {
        return { ok: false, reason: 'expired' };
      }
      return { ok: true, userId: row.userId };
    }

    // Nothing to claim: either this code was never issued (or has been swept), or it was already
    // redeemed. Distinguished only so the log and the error code can say which.
    const existing = await db
      .select({ id: oidcHandoffs.id })
      .from(oidcHandoffs)
      .where(eq(oidcHandoffs.codeHash, codeHash))
      .limit(1);
    return { ok: false, reason: existing.length ? 'already_used' : 'unknown' };
  }
}

/**
 * Codes are stored hashed, never in the clear. They are short-lived and single-use, so this is
 * defence in depth rather than the main control — but a handoff code is a bearer credential for a
 * household's health records while it lives, and a row that leaks one is a row that grants a
 * session. SHA-256 with no salt is right here and not a lapse: the input is 24 CSPRNG bytes, so
 * there is no dictionary to precompute against.
 */
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
