import { OidcService, OidcClaims } from './oidc.service';

describe('OidcService.hasRequiredGroup', () => {
  const ENV_KEYS = ['AUTHELIA_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REQUIRED_GROUP'];
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
    process.env.AUTHELIA_ISSUER_URL = 'https://auth.example.com';
    process.env.OIDC_CLIENT_ID = 'salud';
    process.env.OIDC_CLIENT_SECRET = 'unit-test-secret';
    delete process.env.OIDC_REQUIRED_GROUP;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  function claims(groups: string[]): OidcClaims {
    return { sub: 's1', email: 'a@example.com', groups };
  }

  it('defaults the required group to salud_users', () => {
    const service = new OidcService();
    expect(service.hasRequiredGroup(claims(['salud_users']))).toBe(true);
    expect(service.hasRequiredGroup(claims(['some_other_group']))).toBe(false);
  });

  it('is false when the ID token carries no groups at all', () => {
    const service = new OidcService();
    expect(service.hasRequiredGroup(claims([]))).toBe(false);
  });

  it('respects an overridden OIDC_REQUIRED_GROUP', () => {
    process.env.OIDC_REQUIRED_GROUP = 'household_members';
    const service = new OidcService();
    expect(service.hasRequiredGroup(claims(['salud_users']))).toBe(false);
    expect(service.hasRequiredGroup(claims(['household_members']))).toBe(true);
  });

  it('matches only the exact group name, not a prefix or substring', () => {
    const service = new OidcService();
    expect(service.hasRequiredGroup(claims(['salud_users_extra']))).toBe(false);
  });
});
