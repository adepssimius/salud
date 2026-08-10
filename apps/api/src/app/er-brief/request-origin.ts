/**
 * The absolute origin an ER Brief share link should point at.
 *
 * A plain non-provider module, following `whats-new-window.ts` / `persistence/paths.ts` — it needs
 * no DI and is far cheaper to unit-test this way.
 *
 * The share URL is a bearer capability to a complete medical brief — name, date of birth, weight,
 * code status, conditions, medications, allergies — that gets copied, pasted and texted. Two rules
 * follow, and both matter (security.md → ER Brief snapshot tokens):
 *
 *  - **The client's `Origin` header is never read.** It is a header the requester chooses, so
 *    honouring it would let a request decide where the capability link points.
 *  - **The scheme comes from the proxy, and is forced to https in production.** TLS terminates at
 *    the ingress, so `req.protocol` at the pod is `http` and an unguarded link would go out in
 *    plaintext. HSTS only protects a browser that has already been here.
 */
export function resolveRequestOrigin(req: {
  protocol: string;
  get(name: string): string | undefined;
}): string {
  // `req.get('host')`, not `req.hostname`: with trust proxy on, `req.hostname` prefers
  // `X-Forwarded-Host`, which ingress-nginx does not set — so honouring it would open an injection
  // surface that `Host` doesn't have (a request whose Host doesn't match the ingress rule never
  // reaches the pod). `Host` also keeps the port, which local dev needs.
  const host = req.get('host');
  if (!host) {
    throw new Error('Cannot build a share URL: the request carried no Host header');
  }
  const scheme = process.env.NODE_ENV === 'production' ? 'https' : req.protocol;
  return `${scheme}://${host}`;
}
