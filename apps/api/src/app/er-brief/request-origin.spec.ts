import { resolveRequestOrigin } from './request-origin';

// A pure function, so it's cheap to cover exhaustively here and leave the e2e to the two
// integration-shaped cases (the XFP round trip, and the ignored Origin header).
function fakeReq(opts: { protocol?: string; host?: string; origin?: string }) {
  const headers: Record<string, string | undefined> = {
    host: opts.host,
    origin: opts.origin,
  };
  return {
    protocol: opts.protocol ?? 'http',
    get: (name: string) => headers[name.toLowerCase()],
  };
}

describe('resolveRequestOrigin', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('uses the request scheme and Host in development', () => {
    expect(resolveRequestOrigin(fakeReq({ protocol: 'http', host: 'localhost:3000' }))).toBe(
      'http://localhost:3000',
    );
  });

  it('follows X-Forwarded-Proto, which Express surfaces as req.protocol behind a trusted proxy', () => {
    expect(resolveRequestOrigin(fakeReq({ protocol: 'https', host: 'salud.bpd.sh' }))).toBe(
      'https://salud.bpd.sh',
    );
  });

  it('forces https in production even when the pod sees a plain http connection', () => {
    process.env.NODE_ENV = 'production';
    // TLS terminates at the ingress, so this is the normal case in the cluster -- and the link
    // carries a whole medical brief, so it must never go out as http://.
    expect(resolveRequestOrigin(fakeReq({ protocol: 'http', host: 'salud.bpd.sh' }))).toBe(
      'https://salud.bpd.sh',
    );
  });

  it('ignores a client-supplied Origin header', () => {
    // Origin is chosen by the requester. Honouring it would let a request decide where a bearer
    // capability link points.
    expect(
      resolveRequestOrigin(
        fakeReq({ protocol: 'https', host: 'salud.bpd.sh', origin: 'https://evil.example' }),
      ),
    ).toBe('https://salud.bpd.sh');
  });

  it('refuses to guess when there is no Host header', () => {
    expect(() => resolveRequestOrigin(fakeReq({ protocol: 'https' }))).toThrow(/Host header/);
  });
});
