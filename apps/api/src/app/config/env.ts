import { ConfigService } from '@nestjs/config';

/** Anything shorter is not a credible HS256 key, and `expiresIn: '1d'` tokens are bearer-only. */
const MIN_JWT_SECRET_LENGTH = 32;

export const DEV_JWT_SECRET = 'dev-secret';

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Which login path is active: `'oidc'` (Authelia only; `POST /auth/register|login` refuse with
 * `PASSWORD_AUTH_DISABLED`) or `'password'` (today's email/password flow).
 *
 * Local dev and the e2e suites can't reach a real Authelia server, so they always report
 * `'password'`. In production this is gated behind `OIDC_ENABLED` rather than being a bare
 * `isProduction()` check — a rollout safety valve (deployment.md → "Access control"): it lets the
 * OIDC code path, the schema migration, and the web UI's mode-branching all ship and run in
 * production while password login keeps working, so the actual cutover is a one-variable flip
 * verified separately, not bundled into the same deploy as the code. Once that cutover has
 * happened this collapses to `isProduction()` and the variable goes away.
 */
export function authMode(): 'oidc' | 'password' {
  return isProduction() && process.env.OIDC_ENABLED === 'true' ? 'oidc' : 'password';
}

/**
 * The single place `JWT_SECRET` is read. It used to be read in two — auth.module.ts and
 * jwt.strategy.ts — each with its own `?? 'dev-secret'`, which meant an unset secret in a
 * deployed environment silently signed every token with a value published in this repo, and
 * nothing failed or logged.
 *
 * Outside production the dev fallback stays, so `nx serve` and the e2e suites need no setup.
 * In production an unset or too-short secret is fatal at boot: a pod that cannot authenticate
 * safely should CrashLoopBackOff where it is visible, not serve forgeable sessions.
 */
export function resolveJwtSecret(config?: ConfigService): string {
  const secret = config?.get<string>('JWT_SECRET') ?? process.env.JWT_SECRET;

  if (!isProduction()) return secret ?? DEV_JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET is required when NODE_ENV=production');
  }
  if (secret === DEV_JWT_SECRET) {
    throw new Error(
      'JWT_SECRET is set to the well-known development value; generate a real one',
    );
  }
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters when NODE_ENV=production`,
    );
  }
  return secret;
}
