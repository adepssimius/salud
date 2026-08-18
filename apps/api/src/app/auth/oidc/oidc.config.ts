import { ConfigService } from '@nestjs/config';

const DEFAULT_REQUIRED_GROUP = 'salud_users';

export interface OidcConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  requiredGroup: string;
}

/**
 * The single place OIDC env vars are read, mirroring `resolveJwtSecret`'s shape
 * (`config/env.ts`). Called lazily from `OidcService` the first time an OIDC route is actually
 * hit, not at module init — so a deployment that never enables OIDC (local dev, or prod before
 * `OIDC_ENABLED` is flipped, per `authMode()`) never needs these vars set at all. Once something
 * does call it, an incomplete config is fatal rather than a confusing downstream failure deep
 * inside the token exchange.
 */
export function resolveOidcConfig(config?: ConfigService): OidcConfig {
  const get = (key: string) => config?.get<string>(key) ?? process.env[key];

  const issuerUrl = get('AUTHELIA_ISSUER_URL');
  const clientId = get('OIDC_CLIENT_ID');
  const clientSecret = get('OIDC_CLIENT_SECRET');
  const requiredGroup = get('OIDC_REQUIRED_GROUP') ?? DEFAULT_REQUIRED_GROUP;

  if (!issuerUrl || !clientId || !clientSecret) {
    throw new Error(
      'AUTHELIA_ISSUER_URL, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET must all be set to use OIDC login',
    );
  }

  return { issuerUrl, clientId, clientSecret, requiredGroup };
}
