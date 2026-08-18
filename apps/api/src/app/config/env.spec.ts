import { authMode } from './env';

describe('authMode', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalOidcEnabled = process.env.OIDC_ENABLED;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalOidcEnabled === undefined) delete process.env.OIDC_ENABLED;
    else process.env.OIDC_ENABLED = originalOidcEnabled;
  });

  it('is password outside production regardless of OIDC_ENABLED', () => {
    process.env.NODE_ENV = 'development';
    process.env.OIDC_ENABLED = 'true';
    expect(authMode()).toBe('password');
  });

  it('is password in production until OIDC_ENABLED is explicitly true', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.OIDC_ENABLED;
    expect(authMode()).toBe('password');
  });

  it('is password in production if OIDC_ENABLED is set to anything other than the string "true"', () => {
    process.env.NODE_ENV = 'production';
    process.env.OIDC_ENABLED = 'yes';
    expect(authMode()).toBe('password');
  });

  it('is oidc only in production with OIDC_ENABLED=true — the Stage C cutover this flag exists for', () => {
    process.env.NODE_ENV = 'production';
    process.env.OIDC_ENABLED = 'true';
    expect(authMode()).toBe('oidc');
  });
});
