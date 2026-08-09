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

## Deployment perimeter

The deployed instance additionally sits behind Authelia forward-auth requiring `group:admins`
(see `deployment.md`). This is a perimeter in front of the app, not a replacement for its auth:
the API still requires its own JWT on every route and still re-checks care-team membership. The
app does not read `Remote-User` or any other proxy-supplied identity header, so nothing about
being behind the proxy weakens the in-app checks — and nothing about the proxy should be assumed
present by application code.

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
- Because the token route bypasses `JwtAuthGuard` entirely, it must never be added to a controller
  that also serves authenticated routes without an explicit, reviewed exception — keep it in its
  own controller (`ErBriefPublicController`), the same isolation pattern already used for
  `auth/login` and `auth/register`.
- **Known gap:** on the deployed instance this route is not actually reachable by its intended
  audience. Authelia gates the whole `salud.bpd.sh` host with `group:admins`, so a share link
  handed to an ER clinician hits the login portal, not the brief. The application-level design
  above is unchanged and correct; making it work end to end needs an Authelia `bypass` rule
  scoped to `^/api/er-brief/shared/` and `^/brief/`. Deliberately deferred — until then, treat
  the feature as internal-only.

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
