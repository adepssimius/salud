# Security Spec

## Authentication and credentials
- Use email/password authentication for phase 1.
- Store password hashes using Argon2 (argon2id recommended) with strong parameters (memory/time tuned for server profile).
- Issue JWT access tokens on login (as defined in API spec); all API routes require auth and must revalidate patient care team membership.
- `JWT_SECRET` is read in exactly one place (`apps/api/src/app/config/env.ts`). Outside
  production a well-known development fallback is used so local work needs no setup. When
  `NODE_ENV=production` the API refuses to boot if it is unset, shorter than 32 characters, or
  still set to that development value — an unsigned-in-practice deployment must fail loudly
  rather than issue forgeable tokens.
- Production is rolling over to Authelia OIDC as the sole login path — see "OIDC login" below and
  `deployment.md` → "Access control" for the staged cutover. Email/password stays the login path
  for local development and the e2e suites either way, since neither can reach a real Authelia
  server.

## Deployment perimeter

As deployed today, the instance additionally sits behind Authelia forward-auth requiring
`group:admins` (see `deployment.md`). This is a perimeter in front of the app, not a replacement
for its auth: the API still requires its own JWT on every route and still re-checks care-team
membership. The app does not read `Remote-User` or any other proxy-supplied identity header, so
nothing about being behind the proxy weakens the in-app checks — and nothing about the proxy
should be assumed present by application code. This perimeter goes away once the OIDC cutover
below completes; the app's own login becomes the only gate.

## OIDC login

Authelia also runs as this cluster's OIDC provider, and the app supports signing in through it —
gated to Authelia's `salud_users` group — as an alternative front door into the exact same
per-user JWT session the password flow issues. See `deployment.md` → "Access control" → "OIDC
login (in progress)" for why this ships in stages rather than as one atomic cutover.

- **Flow**: the API acts as an OIDC relying party (`openid-client`), authorization-code grant with
  PKCE. `state`, `nonce` and the PKCE verifier are carried across the redirect to Authelia and
  back in a single short-lived (~10 min), signed, `httpOnly`, `SameSite=Lax` cookie
  (`salud_oidc_txn`) — there is no server-side session store, and none is needed for a flow this
  short. `SameSite=Lax`, not `Strict`, because the callback is a cross-site top-level navigation
  Authelia itself initiates; `Strict` would drop the cookie before the callback handler ever sees
  it. The cookie is signed with the same secret `JWT_SECRET` resolves to (`resolveJwtSecret()`) —
  reused rather than a second provisioned secret, since the payload is opaque and lives for
  minutes, not the day a session JWT does.
- **The required group is enforced in the app, not assumed from Authelia's own gate.** A login
  that succeeds at Authelia but whose ID token's `groups` claim doesn't contain
  `OIDC_REQUIRED_GROUP` (default `salud_users`) is redirected back to `/login` with an
  explanation, not silently admitted. Authelia authenticating someone answers "is this a real
  household-network identity"; the group answers "and are they allowed into salud specifically" —
  two different questions, checked separately, on purpose.
- **Provisioning and linking** (`AuthService.loginOrProvisionOidc`): matched first by the ID
  token's `sub` claim (`users.oidc_subject`), falling back to `email` only for a subject never
  seen before. A `sub` match is authoritative and refreshes the stored email from the claim —
  Authelia's LDAP backend is the source of truth for identity once this is the primary login path,
  and an admin editing someone's email there is routine maintenance, not something that should
  spawn a duplicate account or misroute an old, later-reused email address. An `email` match on
  first sight instead **links** the existing (password-registered) account and backfills
  `oidc_subject` onto it, without touching its password. This is deliberately simpler than
  verifying email ownership out-of-band — appropriate for a single-household app with a handful of
  accounts, all of whom are already members of the same trusted network (P4 — one trusted
  household).
- **The JWT issued after OIDC login is identical in shape and lifetime** to a password-login one
  (`{sub, email}`, 1 day) — OIDC only changes how someone reaches the point of getting one.
  Everything downstream (`JwtAuthGuard`, per-service `ensurePatientAccess`) is unaware which path
  was used.
- **The bearer JWT itself never appears in a URL, redirect, or browser history entry.** The
  callback route hands the browser a random, single-use, ~60-second opaque handoff code instead
  (`GET /api/auth/oidc/callback` → redirect to `/oidc-complete?code=...`), which the SPA
  immediately exchanges for the real session over a normal `POST /api/auth/oidc/exchange`. The
  code is parked in an in-memory map, not a database table — safe specifically because the api
  Deployment is pinned to `replicas: 1` (deployment.md → "State"), so there is never a second
  process without it, and a pod restart mid-login already means retrying the whole flow regardless.
- **Password login is refused in the API, not just hidden in the web UI**, once OIDC is the active
  path (`authMode()` in `apps/api/src/app/config/env.ts`): `POST /api/auth/register` and
  `POST /api/auth/login` answer `403 PASSWORD_AUTH_DISABLED`. This matters once the forward-auth
  perimeter above is gone — without it, an un-gated registration endpoint would be reachable from
  the open internet with no check at all. `GET /api/auth/config` reports which mode is active so
  the web login page knows which form to render.

## Data handling (phase 1)
- Single-household scope; no cross-household sharing.
- Transport: HTTPS assumed.
- Storage: database and local file storage per persistence/tooling specs (SQLite by default; Postgres/MySQL later). No field-level encryption in phase 1.
- File uploads (photos/attachments) default to local filesystem under `/data/attachments`; storage backend is env-selectable.
- No hard dosing stops; client-side warnings only.

## ER Brief snapshot tokens

See `er-brief.md` for the full feature. The one deliberately unauthenticated route in the API:

- Token is 32 bytes from a CSPRNG (`crypto.randomBytes(32)`), base64url-encoded, stored unique in
  `er_brief_snapshots.token`. The token **is** the capability — anyone holding the link can read
  the frozen brief, by design (it's meant to be handed to a triage desk or texted to a partner en
  route). Nothing else about the link grants access: it is read-only, single-purpose, and time-
  limited.
- `expiresAt` is mandatory (not nullable) and capped server-side at creation (168 hours / 7 days
  max, 72-hour default) — there is no "never expires" option. A long-lived unauthenticated link
  would function like a shared password; capping the lifetime keeps it a handoff artifact, not a
  standing access grant (P4 — no read-only tiers).
- The payload is frozen at creation time and never recomputed — reading the link later cannot leak
  data that entered the record after the snapshot was taken, even if the token is still valid.
- Missing and expired tokens return the identical 404 `SNAPSHOT_NOT_FOUND` — no signal to
  distinguish "never existed" from "existed and lapsed," matching the `PATIENT_NOT_FOUND`
  non-disclosure pattern used everywhere else in the API (api.md → "Resource shape and access
  control").
- Revocation is deletion (`DELETE /api/er-brief/snapshots/:id`, authenticated + patient-scoped) —
  there is no separate "revoked" state to track; a deleted row 404s identically to an expired one.
- **The link's scheme and host are derived server-side and never from a client-supplied `Origin`
  header.** Host comes from the request's own `Host`, scheme from `X-Forwarded-Proto` behind the
  trusted proxy and forced to `https` in production (deployment.md → Trusted proxy). Two things
  follow. The link is never emitted as plaintext `http://` — it carries name, date of birth, weight,
  code status, conditions, medications and allergies, and it is copied, pasted and texted, so HSTS
  protecting a browser that has been here before is not enough. And because `Origin` is a header the
  requester chooses, honouring it would let a request decide where the capability link points.
- Because the token route bypasses `JwtAuthGuard` entirely, it must never be added to a controller
  that also serves authenticated routes without an explicit, reviewed exception — keep it in its
  own controller (`ErBriefPublicController`), the same isolation pattern already used for
  `auth/login` and `auth/register`.
- **Known gap, in progress:** on the deployed instance this route is not actually reachable by its
  intended audience. Authelia gates the whole `salud.bpd.sh` host with `group:admins`, so a share
  link handed to an ER clinician hits the login portal, not the brief. The application-level
  design above is unchanged and correct. Rather than a scoped Authelia `bypass` rule for just these
  two paths, the fix in progress is broader: the OIDC login cutover (`deployment.md` → "Access
  control" → "OIDC login (in progress)") removes the whole-host forward-auth perimeter once the
  app's own OIDC login is the real gate, which resolves this as a side effect. Until that cutover's
  final step lands, treat the feature as internal-only.

## Future/phase 2
- Native phone app and web clients should support an iMessage-like encryption scheme to authorize/deauthorize sharing of patient data with other caregivers. Encryption is performed client-side; on-device data must be stored encrypted.
- Keying model (Alice/Bob example):
  - Each patient record has its own symmetric encryption key for that patient’s data.
  - Alice (creator) holds the patient symmetric key.
  - Bob has an account with a published public key and an on-device private key (private key may be cloud-backed if it is itself encrypted with a key derived from Bob’s password).
  - To grant access, Alice encrypts the patient symmetric key with Bob’s public key and publishes the wrapped key to Bob.
  - Wrapped keys are excluded from device backups; recovery requires re-auth and key re-delivery, not a device backup restore.
  - Revocation: stop delivering the wrapped key to Bob, notify Bob’s device to purge it, and rotate the patient symmetric key as needed.
  - On-device databases remain encrypted (beyond OS disk encryption) to isolate from malware or other local actors.
- Doctor directory/appointments and lightweight caregiver-only views are future scope (see product spec); add appropriate access controls when implemented.
