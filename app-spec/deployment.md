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

SQLite on a 10Gi ReadWriteOnce Ceph volume mounted at `/data` — `/data/salud.db` plus
`/data/attachments`. This is why the api Deployment is pinned to one replica with
`strategy: Recreate`: a rolling update would put a second writer on the same database file.
Every deploy is therefore a few seconds of downtime.

Postgres remains specced (`persistence.md`) but unexercised: `apps/api/src/db/schema.ts` is
written against Drizzle's `sqlite-core` throughout and there are no postgres migrations. A
`salud` role and database are already provisioned on the shared CNPG cluster
(`k8s-infra` → `apps/databases/cnpg/init-jobs/salud-job.yaml`), so the port is a code change with
no infrastructure work in front of it.

## Access control

The host sits behind Authelia forward-auth, `policy: one_factor`, `subject: group:admins` — the
rule lives in `k8s-infra` → `apps/iam/authelia/values.yaml`, not on the Ingress. salud's own
email/password + JWT login runs *behind* that gate and remains the real per-user access control;
Authelia is a perimeter, not a replacement. There is no trusted-header auth: the app ignores
`Remote-User` entirely.

Consequence worth knowing: the ER Brief capability URLs (`/api/er-brief/shared/:token` and the
`/brief/:token` SPA route), which `security.md` describes as links to hand to a triage desk, are
gated too. They do not currently work for anyone without a cluster account. See `security.md`.

## Configuration

Set on the api container; `JWT_SECRET` comes from the `Salud Prod Secrets` 1Password item via
the 1Password Connect operator, everything else is a literal.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` — also switches on the fail-fast checks below |
| `PORT` | `3000` |
| `DATA_DIR` | `/data` |
| `DB_CLIENT` | `sqlite` |
| `JWT_SECRET` | from `salud-secrets`; ≥32 chars, required |
| `ACCESS_LOG` | unset (on). `false` disables the HTTP access log — see Logging |
| `SLOW_REQUEST_MS` | unset (1000). Requests at or over this are logged at warn and tagged `SLOW` |

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

`scripts/release.sh` cuts a `YYYYMMDD-HHMMSS` tag. That publishes an image but does **not**
deploy — Flux matches only the `main-` form. It exists to pin a release you want to point at.
