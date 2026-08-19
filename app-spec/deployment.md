# Deployment

The single deployed instance lives at **https://salud.bpd.sh**, on the `jl-k3s` cluster. All
manifests live in the separate `k8s-infra` repository under `apps/salud/`; nothing in this repo
is applied to the cluster directly.

## Topology

Two images, two Deployments, one origin.

| | |
| --- | --- |
| `ghcr.io/adepssimius/salud-api` | NestJS, port 3000, `replicas: 1` |
| `ghcr.io/adepssimius/salud-web` | nginx serving the Angular bundle, port 80, `replicas: 2` |

An nginx Ingress splits the single host: `/api` → the api Service, `/` → the web Service. The
split is exact rather than conventional — `main.ts` sets a global `api` prefix, so every backend
route is under `/api` and everything else is the SPA.

**The two cannot be split onto separate hostnames.** The API enables no CORS, and
`apps/web/src/app/core/api.config.ts` hardcodes a relative `/api` base. Same origin is a
requirement, not a convenience.

### Trusted proxy

There is **exactly one L7 hop** in front of the api pod: the nginx Ingress controller. The
Kubernetes Service between them is L4 DNAT and adds no forwarding header. Express is therefore
configured with `trust proxy = 1` — trust the immediate peer, and only it. `true` would trust an
arbitrarily long forwarded chain, which lets a client prepend whatever it likes.

This matters because **TLS terminates at the ingress**, so `req.protocol` at the pod is always
`http`. `X-Forwarded-Proto` is the only source of truth for the scheme a user actually saw, and
anything that builds an absolute URL — today, the ER Brief share link — must read it rather than the
connection's own scheme. `X-Forwarded-Host` is deliberately *not* used: ingress-nginx does not set
it, so honouring it would open an injection surface the `Host` header does not have (a request whose
`Host` doesn't match the ingress rule never reaches the pod at all).

### Security headers

Ownership splits by layer, because only the layer that serves a document can author its policy:

| Header | Owner |
| --- | --- |
| `X-Content-Type-Options` | both — the API for `/api/files/:id` downloads, the web for the bundle |
| `Content-Security-Policy` | both, different policies — the API serves no HTML and gets `default-src 'none'`; the web gets the real app policy |
| `X-Frame-Options` / `frame-ancestors` | both — clickjacking is a document concern, but a JSON API should refuse framing too |
| `Referrer-Policy` | both |
| `Strict-Transport-Security` | the ingress preferentially (it is the only layer that sees a plain-HTTP request); harmless from either app |
| `Permissions-Policy` | web only — meaningful only for a document |

The API's near-empty CSP is load-bearing for exactly one route: `GET /api/files/:id` streams
user-uploaded bytes with their stored `contentType`. An uploaded SVG opened as a top-level document
on this origin would otherwise be stored XSS.

## State

The database is **Postgres**, on the cluster's shared CloudNativePG instance (`postgres-main`, ns
`databases` in `k8s-infra`) — `DB_CLIENT=postgres`, credentials from the `salud-secrets` 1Password
item, database/role provisioned by `apps/databases/cnpg/init-jobs/salud-job.yaml`. That gets this
deployment continuous WAL archiving and weekly base backups with 30-day retention for free — real
point-in-time recovery, which the previous SQLite-on-a-PVC setup had none of.

Attachments (`persistence.md`) are unaffected by that move and still live on a 10Gi ReadWriteOnce
Ceph volume mounted at `/data/attachments` — only the database file left that volume. **The api
Deployment is still pinned to one replica with `strategy: Recreate`** because of that volume, same
as before; the reason is now "the attachments volume is RWO," not "SQLite is a single-writer file."
A rolling update would still put two pods on the same PVC.

That pin is now a choice rather than a constraint. `FILE_STORAGE_DRIVER=s3` moves attachments off
the PVC entirely (`persistence.md` → "File storage"), and with both the database and the blobs
external the api has no node-local state left to serialize on — the RWO volume was the last thing
holding it at `replicas: 1`. **This deployment has not made that switch**: attachments are still on
Ceph RWO, and flipping the driver is a data migration, not a config change, since nothing dual-reads
`file_assets.bucket`. Ceph RGW on the same cluster is the obvious target if and when it's worth
doing; the trigger would be wanting rolling updates, not capacity.

See "Self-hosting" below for the other supported configuration — SQLite, zero extra infrastructure
— which is what this same image runs with no environment configuration at all.

### Self-hosting

This deployment (Postgres, above) is one configuration of a generally self-hostable app —
`persistence.md` documents both `DB_CLIENT` values as equally real, not one "production" and one
"fallback." A self-hoster with no interest in running a Postgres cluster gets a working instance
from the SQLite default with zero database configuration: point `DATA_DIR` at a persistent volume
and go — `/data/salud.db` plus `/data/attachments`, one process, no separate database service to
run or back up. The `replicas: 1` / `strategy: Recreate` posture applies for the same reason it
does here, just with the database file itself also on that volume.

Moving from that starting point to Postgres later — outgrowing a single-file database, wanting
managed backups — is supported, not a one-way door requiring a fresh install:
`yarn migrate:sqlite-to-postgres` (`persistence.md`) copies an existing SQLite instance's data
across intact, with a pre-flight check and a row-count verification.

## Access control

As deployed today, the host still sits behind Authelia forward-auth, `policy: one_factor`,
`subject: group:admins` — the rule lives in `k8s-infra` → `apps/iam/authelia/values.yaml`, not on
the Ingress. salud's own email/password + JWT login runs *behind* that gate and remains the real
per-user access control; Authelia is a perimeter, not a replacement. There is no trusted-header
auth: the app ignores `Remote-User` entirely.

Consequence worth knowing: the ER Brief capability URLs (`/api/er-brief/shared/:token` and the
`/brief/:token` SPA route), which `security.md` describes as links to hand to a triage desk, are
gated too. They do not currently work for anyone without a cluster account. See `security.md`.

### OIDC login (in progress)

The app now also supports signing in via Authelia's own OIDC provider, gated to the `salud_users`
group — see `security.md` → "OIDC login" for the flow itself. This ships in stages, on purpose,
because it touches the only thing standing between the internet and this household's health
records:

1. **Shipped in this change**: the OIDC login code path, a nullable `users.password_hash` +
   `users.oidc_subject` migration, and the web UI's mode-branching. `authMode()`
   (`apps/api/src/app/config/env.ts`) governs which login path is active and is `'password'`
   everywhere until `OIDC_ENABLED=true` is set **and** `NODE_ENV=production` — so merging this
   changes nothing about how anyone signs in today.
2. **Manual verification against production**, with `OIDC_ENABLED=true` but the forward-auth
   perimeter still up (a temporary double gate) — walking the full flow for real before anything
   about today's access control changes.
3. **The actual cutover**: `OIDC_ENABLED` collapses into plain `isProduction()` (password login
   hard-disabled in prod), and — in the same change or immediately after, never before — the
   `access_control` rule and the `ingress.yaml` forward-auth annotations described above are
   removed from `k8s-infra`. Order matters: dropping the perimeter while the API still accepts
   passwords would leave `POST /api/auth/register` open to the internet with no gate at all.

Once step 3 lands, the "Consequence worth knowing" paragraph above stops applying: removing the
perimeter is what lets the ER Brief's capability URLs work for people without a cluster account,
which is what `security.md` always intended for them.

## Configuration

Set on the api container; `JWT_SECRET` comes from the `Salud Prod Secrets` 1Password item via
the 1Password Connect operator, everything else is a literal.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` — also switches on the fail-fast checks below |
| `PORT` | `3000` |
| `DATA_DIR` | `/data` — attachments only now; the database itself is Postgres, see "State" |
| `FILE_STORAGE_DRIVER` | unset (`local`). `s3` switches attachments to object storage — see "State". Any other value refuses to boot |
| `FILE_STORAGE_LOCAL_BASE_PATH` | unset (`$DATA_DIR/attachments`) |
| `S3_BUCKET` | unset. **Required** when `FILE_STORAGE_DRIVER=s3`; missing it refuses to boot |
| `S3_REGION` | unset (`us-east-1`) — the value Ceph RGW and MinIO expect |
| `S3_ENDPOINT` | unset (real AWS). Set to an S3-compatible endpoint, e.g. Ceph RGW on this cluster |
| `S3_FORCE_PATH_STYLE` | unset — `true` when `S3_ENDPOINT` is set, `false` otherwise. Override only for a store that wants the non-default addressing |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | unset. Both or neither; neither falls through to the AWS default credential chain. Would come from `salud-secrets` |
| `S3_PREFIX` | unset. Optional key prefix within the bucket |
| `DB_CLIENT` | `postgres` |
| `DATABASE_URL` | assembled in the container command from `salud-secrets`' `dbUsername`/`dbPassword`/`dbDatabase` against `postgresql.databases.svc.cluster.local:5432`, percent-encoding the password so it's never stored as a second, fully-formed connection string |
| `JWT_SECRET` | from `salud-secrets`; ≥32 chars, required |
| `ACCESS_LOG` | unset (on). `false` disables the HTTP access log — see Logging |
| `SLOW_REQUEST_MS` | unset (1000). Requests at or over this are logged at warn and tagged `SLOW` |
| `OIDC_ENABLED` | unset (off). `true` (with `NODE_ENV=production`) is the actual login-mode cutover — see "Access control" → "OIDC login" |
| `AUTHELIA_ISSUER_URL` | `https://auth.bpd.sh`. Required for `GET /api/auth/oidc/login\|callback` to work at all — those routes are always registered, independent of `OIDC_ENABLED` |
| `OIDC_CLIENT_ID` | `salud`. Same requirement as `AUTHELIA_ISSUER_URL` |
| `OIDC_CLIENT_SECRET` | from `salud-secrets`. Same requirement as `AUTHELIA_ISSUER_URL` |
| `OIDC_REQUIRED_GROUP` | unset (`salud_users`). The Authelia group a login must carry |

In production the API refuses to start rather than degrade quietly: an unset, too-short, or
well-known `JWT_SECRET` is fatal, and an unwritable `/data` is fatal instead of silently falling
back to the pod's ephemeral filesystem.

## First run

A freshly provisioned instance starts with an **empty medication catalog**, and every dose-guidance
feature is inert until it has one — no medications means no embodiments, no guidelines, no
weight-based or age-band math, and no atypical-dose detection. Populate it with `yarn seed:catalog`
run against the instance (development.md), or enter medications by hand.

The API deliberately does **not** seed at boot. `main.ts` applies pending migrations before it
listens, but it must never write rows: the catalog is the household's own data, and a pod restart
silently inserting into it is exactly the surprise write the one-replica/`Recreate` posture exists to
avoid.

## Health

- `GET /api/health` — dependency-free, used for liveness.
- `GET /api/health/ready` — runs `select 1`, used for readiness.

Both are unauthenticated by necessity; kubelet carries no bearer token. Liveness deliberately
does not touch the database — restarting a pod does not repair a sick database.

## Logging

The API writes **one line per request** to stdout, plus a stack trace for any 5xx. There is no log
aggregator: `kubectl logs` is the reader, so the format is greppable key=value rather than JSON.

```
GET /api/patients/<id>/timeline 200 847ms user=<uuid> SLOW
GET /api/patients/<id>/timeline 404 3ms user=<uuid> code=PATIENT_NOT_FOUND
POST /api/patients/<id>/observations 400 9ms user=<uuid> code=AT_LEAST_ONE_ENTRY_REQUIRED
```

Levels are chosen so that `grep WARN` is a useful triage pass: 5xx is `error`, 4xx is `warn`, a
successful request slower than `SLOW_REQUEST_MS` is `warn`, everything else is `log`.

**Why this exists.** Nest's `BaseExceptionFilter` returns early for anything that is an
`HttpException` and logs only in its unknown-error branch. Because every domain failure in this
codebase is signalled by throwing one (`NotFoundException('PATIENT_NOT_FOUND')` and friends), the
API used to log *nothing at all* for a 400, 401 or 404 — the web app rendered a sentence at the
caregiver and the server kept no record the request had happened. `AllExceptionsFilter` restores
the record; it deliberately changes no status code and no response body, because
`apps/web/src/app/core/error-display.ts` parses those bodies and `api.md` → "Error codes" is the
contract.

### What is never logged

Request bodies, header values, and query **values** never reach the log. Only query parameter
*names* are kept (`?from,to`), which is enough to read a slow-request line without recording a
child's temperature, a caregiver's search term, or the password on `POST /api/auth/login`.

The ER Brief share token is redacted to `/api/er-brief/shared/[redacted]`. `security.md` defines
that token as the capability itself, so a token sitting in a pod log is a leaked brief that
outlives the request.

Patient and observation UUIDs in the path **are** kept: they are opaque internal identifiers, and
they are what makes a line actionable when a caregiver reports a failure on a specific patient.

### Known limit: abandoned requests

A request whose connection dies before the response is written out is tagged `ABORTED`. This does
not catch every abandoned request. Once the kernel has buffered the whole response, Node reports
the write as successful even if the client is already gone, so a caregiver's phone dropping the
connection — or an ingress that stopped waiting — still logs as a normal 200. A client-side error
with no matching server-side line is therefore still possible, and the duration on that line is
the thing to read.

## Release flow

Every push to `main` publishes both images tagged `main-<CI run number>-<short sha>`. Flux's
`ImagePolicy` sorts numerically on the run number and `ImageUpdateAutomation` commits the bump
back to `k8s-infra`, which reconciles it. **Merging to `main` is the deploy.**

The run number rather than a timestamp is deliberate: it is identical across both jobs in the
publish matrix, so api and web can never land on different tags, and it is monotonic without
depending on fixed-width formatting.

Neither image is compiled inside Docker. CI builds the workspace once, in the job that also lints
and tests it, and hands `dist/api` and `dist/apps/web/browser` to the publish jobs as artifacts;
each Dockerfile ends its from-source path in a `dist` stage that the build substitutes with those
(`--build-context`), which prunes the compile out of the image graph. Running `docker build` on
either Dockerfile with no extra flags still builds from source, so the images remain reproducible
outside CI — that path is just not what a release takes.

Pull requests build both images too, and throw them away; only a push pushes. The image build is
nearly free now that it carries no compile, and without it a change that breaks an image would
stay green until it had already merged and started deploying.

`scripts/release.sh` cuts a `YYYYMMDD-HHMMSS` tag. That publishes an image but does **not**
deploy — Flux matches only the `main-` form. It exists to pin a release you want to point at.

**Docs-only changes skip the pipeline entirely** (`paths-ignore` on markdown and `app-spec/` in
`ci.yml`): a docs-only PR runs no checks, and a docs-only merge to `main` publishes no image and
therefore deploys nothing — the images don't contain the docs, so there is nothing to roll out.
Tag pushes are exempt (GitHub doesn't evaluate path filters for tags), so cutting a release tag
always publishes.
