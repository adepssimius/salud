import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { createTestApp } from '../../../testing/create-test-app';
import { DatabaseService } from '../../persistence/database.service';
import { AuthService } from '../auth.service';
import { oidcHandoffs } from '../../../db/schema';
import { applyAppSecurity } from '../../app.security';
import { OidcService } from './oidc.service';
// Jest resolves this to auth/oidc/__mocks__/openid-client.ts (jest.config.ts →
// moduleNameMapper), not the real package -- see that file's header for why. __setMockClaims lets
// a test register what a given authorization `code` resolves to, standing in for a real Authelia
// exchange.
import { __resetMockClaims, __setMockClaims } from 'openid-client';

/**
 * Exercises the full Authelia OIDC flow end-to-end through real HTTP requests, using the mocked
 * `openid-client` in place of a real or stubbed IdP. What's genuinely unverified here — issuer
 * discovery, ID token signature/audience/nonce validation, real PKCE — is `openid-client`'s own
 * job, not this codebase's; what IS verified is everything this app is responsible for: the
 * state/PKCE cookie round trip, the groups-claim gate, provisioning vs. linking (unit-covered
 * again here through the HTTP layer, not just in auth.service.spec.ts), and that the JWT never
 * appears anywhere but the one-time handoff exchange.
 */
describe('OIDC routes (e2e)', () => {
  let app: INestApplication;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ app, close } = await createTestApp('oidc', {
      env: {
        AUTHELIA_ISSUER_URL: 'https://auth.example.com/',
        OIDC_CLIENT_ID: 'salud',
        OIDC_CLIENT_SECRET: 'test-oidc-secret',
      },
      configureApp: (app) => applyAppSecurity(app as any),
    }));
  });

  afterAll(async () => {
    await close();
    delete process.env.AUTHELIA_ISSUER_URL;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
  });

  afterEach(() => {
    __resetMockClaims();
    // OidcService memoizes discovery on its instance (deliberately, for production — see
    // oidc.service.ts). That means it also memoizes across tests sharing this one app instance;
    // without resetting it, a test that deletes AUTHELIA_ISSUER_URL after an earlier test already
    // discovered successfully would silently keep using the cached configuration instead of
    // re-validating. Every test here should see a config resolver that runs fresh.
    (app.get(OidcService) as any).configuration = null;
  });

  // Follows the login redirect, then hits the callback with the given code and the cookie login
  // set -- the shape every real browser round trip through Authelia takes.
  async function loginAndCallback(code: string) {
    const loginRes = await request(app.getHttpServer()).get('/api/auth/oidc/login').expect(302);
    const cookie = loginRes.headers['set-cookie'];
    expect(cookie).toBeDefined();

    // randomState() is fixed to 'mock-state' by the mock, so it's known without parsing the
    // redirect Location.
    return request(app.getHttpServer())
      .get('/api/auth/oidc/callback')
      .query({ code, state: 'mock-state' })
      .set('Cookie', cookie);
  }

  it('redirects to Authelia with state, nonce and a PKCE challenge, and sets the transaction cookie', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/oidc/login').expect(302);

    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe('https://auth.example.com/authorize');
    expect(location.searchParams.get('state')).toBe('mock-state');
    expect(location.searchParams.get('nonce')).toBe('mock-nonce');
    expect(location.searchParams.get('code_challenge')).toBe('mock-challenge-mock-verifier');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('scope')).toBe('openid profile email groups');
    expect(location.searchParams.get('redirect_uri')).toMatch(/\/api\/auth\/oidc\/callback$/);

    const cookie = res.headers['set-cookie']?.[0];
    expect(cookie).toContain('salud_oidc_txn=');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('fails loudly rather than hanging when OIDC is not configured', async () => {
    const originalIssuer = process.env.AUTHELIA_ISSUER_URL;
    delete process.env.AUTHELIA_ISSUER_URL;
    try {
      // resolveOidcConfig() throws before any discovery call, so this exercises the config
      // resolver's fail-fast end-to-end through the HTTP layer, the same posture
      // resolveJwtSecret() has in production -- no network and no real IdP involved.
      await request(app.getHttpServer()).get('/api/auth/oidc/login').expect(500);
    } finally {
      process.env.AUTHELIA_ISSUER_URL = originalIssuer;
    }
  });

  it('redirects to login with an error when the callback has no transaction cookie', async () => {
    // A direct hit on the callback URL (no prior /login redirect, so no cookie) is what a stale
    // bookmark, a replayed link, or a forged callback attempt all look like.
    const res = await request(app.getHttpServer())
      .get('/api/auth/oidc/callback')
      .query({ code: 'irrelevant', state: 'irrelevant' })
      .expect(302);
    expect(res.headers.location).toBe('/login?error=oidc_state');
  });

  it('redirects to login with an error when the returned state does not match', async () => {
    const loginRes = await request(app.getHttpServer()).get('/api/auth/oidc/login').expect(302);
    const cookie = loginRes.headers['set-cookie'];

    const res = await request(app.getHttpServer())
      .get('/api/auth/oidc/callback')
      .query({ code: 'some-code', state: 'wrong-state' })
      .set('Cookie', cookie)
      .expect(302);
    expect(res.headers.location).toBe('/login?error=oidc_state');
  });

  it('provisions a new user, parks a one-time handoff code, and never exposes the JWT in the redirect', async () => {
    __setMockClaims('code-new-user', {
      sub: 'authelia|e2e-new',
      email: `oidc-new-${Date.now()}@example.com`,
      name: 'New OIDC User',
      groups: ['salud_users'],
    });

    const callbackRes = await loginAndCallback('code-new-user');
    expect(callbackRes.status).toBe(302);
    const location = callbackRes.headers.location as string;
    expect(location).toMatch(/^\/oidc-complete\?code=/);
    expect(location).not.toContain('token');

    const handoffCode = new URLSearchParams(location.split('?')[1]).get('code')!;

    const exchangeRes = await request(app.getHttpServer())
      .post('/api/auth/oidc/exchange')
      .send({ code: handoffCode })
      .expect(201);
    expect(exchangeRes.body.token).toEqual(expect.any(String));
    expect(exchangeRes.body.user.email).toContain('oidc-new-');
    expect(exchangeRes.body.user.displayName).toBe('New OIDC User');

    // The handoff code is single-use, and says so specifically: a spent code is not the same
    // situation as one that was never issued, and the caregiver is told a different sentence.
    await request(app.getHttpServer())
      .post('/api/auth/oidc/exchange')
      .send({ code: handoffCode })
      .expect(404)
      .expect((res) => {
        expect(res.body.message).toBe('OIDC_HANDOFF_ALREADY_USED');
      });
  });

  it('links a pre-existing password-registered account by email on first OIDC login', async () => {
    const email = `oidc-link-${Date.now()}@example.com`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'password123', displayName: 'Password User' })
      .expect(201);

    __setMockClaims('code-link', {
      sub: 'authelia|e2e-link',
      email,
      groups: ['salud_users'],
    });

    const callbackRes = await loginAndCallback('code-link');
    expect(callbackRes.status).toBe(302);
    const handoffCode = new URLSearchParams(
      (callbackRes.headers.location as string).split('?')[1],
    ).get('code')!;

    const exchangeRes = await request(app.getHttpServer())
      .post('/api/auth/oidc/exchange')
      .send({ code: handoffCode })
      .expect(201);
    expect(exchangeRes.body.user.email).toBe(email);
    expect(exchangeRes.body.user.displayName).toBe('Password User');
  });

  it('denies a login that succeeds at Authelia but lacks the required group', async () => {
    __setMockClaims('code-no-group', {
      sub: 'authelia|e2e-nogroup',
      email: `no-group-${Date.now()}@example.com`,
      groups: ['some_other_group'],
    });

    const res = await loginAndCallback('code-no-group');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?error=oidc_forbidden');
  });

  it('returns OIDC_HANDOFF_NOT_FOUND for an unknown or already-used handoff code', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/oidc/exchange')
      .send({ code: 'never-issued' })
      .expect(404)
      .expect((res) => {
        expect(res.body.message).toBe('OIDC_HANDOFF_NOT_FOUND');
      });
  });

  it('rejects a malformed exchange body before touching the handoff store', async () => {
    await request(app.getHttpServer()).post('/api/auth/oidc/exchange').send({}).expect(400);
  });

  /**
   * The regression this whole change exists for.
   *
   * salud-api runs replicas: 2 (k8s-infra → apps/salud/prod/api-deployment.yaml). The callback and
   * the exchange are two independent HTTP requests, load-balanced separately, so the pod that
   * parks a handoff code is routinely not the pod asked to redeem it. While the store was an
   * in-process Map, that made roughly half of all production logins fail with "this sign-in link
   * has expired or was already used" on the first click.
   *
   * A second OidcService built on the same DatabaseService is the smallest honest stand-in for
   * that second pod: separate instance, separate (empty) in-process state, one shared database.
   * It must be able to redeem what the app's own instance parked, and — the other half of the
   * guarantee — the two must not both be able to redeem it.
   */
  describe('across two api instances (the replicas: 2 case)', () => {
    let otherPod: OidcService;
    let userId: string;

    beforeEach(async () => {
      otherPod = new OidcService(app.get(DatabaseService));
      const auth = app.get(AuthService);
      const user = await auth.resolveOidcUser({
        sub: `authelia|two-pods-${Date.now()}`,
        email: `two-pods-${Date.now()}@example.com`,
      });
      userId = user.id;
    });

    it('redeems on one instance a code parked by another', async () => {
      const code = await app.get(OidcService).parkForHandoff(userId);

      const result = await otherPod.redeemHandoff(code);

      expect(result).toEqual({ ok: true, userId });
    });

    it('lets exactly one of two instances racing the same code win', async () => {
      const code = await app.get(OidcService).parkForHandoff(userId);

      // Both in flight at once, which is what a double-submitting browser behind a round-robin
      // service looks like. Single-use is enforced by the conditional UPDATE, not by ordering.
      const [first, second] = await Promise.all([
        app.get(OidcService).redeemHandoff(code),
        otherPod.redeemHandoff(code),
      ]);

      const winners = [first, second].filter((r) => r.ok);
      expect(winners).toHaveLength(1);
      expect(winners[0]).toEqual({ ok: true, userId });
      expect([first, second].find((r) => !r.ok)).toEqual({
        ok: false,
        reason: 'already_used',
      });
    });

    it('refuses an expired code as expired rather than as never-issued', async () => {
      const code = await app.get(OidcService).parkForHandoff(userId);
      // Age the row past its TTL in place: nothing here should depend on a real five-minute wait,
      // and the retention window (an hour) deliberately keeps the row around to say "expired".
      await (app.get(DatabaseService).db as any)
        .update(oidcHandoffs)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(oidcHandoffs.userId, userId));

      expect(await otherPod.redeemHandoff(code)).toEqual({ ok: false, reason: 'expired' });
    });

    it('never stores the handoff code itself, only a hash of it', async () => {
      const code = await app.get(OidcService).parkForHandoff(userId);

      const rows = await (app.get(DatabaseService).db as any)
        .select()
        .from(oidcHandoffs)
        .where(eq(oidcHandoffs.userId, userId));

      expect(rows).toHaveLength(1);
      expect(rows[0].codeHash).not.toBe(code);
      expect(rows[0].codeHash).toBe(createHash('sha256').update(code).digest('hex'));
      // And nothing bearer-shaped: the row names a user, it does not carry a session. Matching
      // the JWT shape (three base64url segments) rather than the column list, so this keeps
      // holding if someone later adds a column to this table.
      const jwtShaped = /\b[\w-]+\.[\w-]+\.[\w-]+\b/;
      expect(JSON.stringify(rows[0])).not.toMatch(jwtShaped);
    });
  });
});
