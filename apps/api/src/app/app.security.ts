import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

/**
 * Trust-proxy and security-header setup, shared by `main.ts` and the e2e suites.
 *
 * It lives in a function rather than inline in `main.ts` because the e2e suites build their app
 * through `Test.createTestingModule` and never execute `main.ts` (ISSUES #26) — anything inline
 * there is both untestable and silently different from what deploys.
 */
export function applyAppSecurity(app: NestExpressApplication) {
  // Exactly one L7 hop sits in front of the pod: the nginx Ingress controller. The Kubernetes
  // Service between them is L4 DNAT and adds no forwarding header (deployment.md → Trusted proxy).
  //
  // `1`, not `true`. Express's compiled trust function for a number n is `(addr, i) => i < n`, and
  // `req.protocol` calls it with i = 0 — so 1 means "trust the immediate peer" and nothing beyond.
  // `true` trusts an arbitrarily long forwarded chain, which lets a client prepend whatever it
  // likes. This is what makes `X-Forwarded-Proto` readable at all: TLS terminates at the ingress,
  // so `req.protocol` at the pod is otherwise always `http`.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // This API serves zero HTML, so the correct policy is the empty one — not helmet's
      // `default-src 'self'` web-app default. It is load-bearing for exactly one route:
      // GET /api/files/:id streams user-uploaded bytes with their stored contentType and no
      // Content-Disposition. An uploaded SVG opened as a top-level document on this origin would
      // otherwise be stored XSS. The web app's own (much larger) policy lives in nginx.conf,
      // because only the layer serving the document can author it.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'none'"],
          'form-action': ["'none'"],
          sandbox: [],
        },
      },
      // helmet defaults to SAMEORIGIN; nothing should ever frame a JSON API.
      frameguard: { action: 'deny' },
      // Everything else takes helmet's defaults, of which `X-Content-Type-Options: nosniff` is the
      // one that matters most here — again for the file-download route.
    }),
  );
}
