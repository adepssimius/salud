# Security Spec

## Authentication and credentials
- Use email/password authentication for phase 1.
- Store password hashes using Argon2 (argon2id recommended) with strong parameters (memory/time tuned for server profile).
- Issue JWT access tokens on login (as defined in API spec); all API routes require auth and must revalidate patient care team membership.

## Data handling (phase 1)
- Single-household scope; no cross-household sharing.
- Transport: HTTPS assumed.
- Storage: database and local file storage per persistence/tooling specs (SQLite by default; Postgres/MySQL later). No field-level encryption in phase 1.
- File uploads (photos/attachments) default to local filesystem under `/data/attachments`; storage backend is env-selectable.
- No hard dosing stops; client-side warnings only.

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
