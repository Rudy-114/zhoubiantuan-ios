# Admin Web Console Production Deployment - 2026-07-14

Status: PASS

## Scope

- Console source through `c907bf0`; root-device revocation source: `5aba94e`
- Production service: `zbt-backend.service`
- Production directory: `/opt/zbt-backend`
- Web flag: `ADMIN_WEB_ENABLED=true`
- Additional migration: `017_admin_device_revocation.sql`
- Paid APIs: not called

The console, isolated administrator APIs, safety-case APIs, publication review,
audit view, and trusted-device UI are active at `/admin`. The administrator
identity remains isolated from consumer users and App JWT authorization.

## Rollback Points

- Pre-console full directory copy: `/opt/zbt-backend.backup-20260714-193514`
- Pre-revocation full directory copy:
  `/opt/zbt-backend.pre-revoke-20260714-140122`
- Pre-console PostgreSQL 16 custom backup: private ignored file
  `.project-secrets/backups/zbt-before-admin-web-20260714-193514.dump`
- The database backup passed `pg_restore --list` validation and remained mode
  `600`.
- The production environment remained mode `600`.

No backup, environment file, administrator credential, recovery code,
bootstrap code, device short code, session token, or private key is tracked by
Git or recorded in this document.

## Deployment Safety Events

The first console restart exposed an incomplete selective archive that omitted
an existing runtime dependency. The service was immediately restored from the
pre-console copy with the web flag disabled. Health returned to HTTP 200 and
the console returned to HTTP 404 before a complete runtime-closure archive was
preflighted and deployed.

The later device-revocation rollout stopped twice during staging: once because
the preflight used the wrong health path, and once because the server-local
Node migration process could not complete its RDS protocol exchange. Both
stops occurred before runtime replacement or service restart. Migration 017's
small additive constraint change was then applied atomically through a
temporary PostgreSQL 16 SSH tunnel, its migration record was verified, and the
tunnel was closed before deployment continued.

## Automated Verification

- Node suite: 92/92 passed.
- PostgreSQL integration suite: 195/195 passed.
- Device revocation followed a red-green cycle: the initial public lifecycle
  test received HTTP 400 for unsupported `revoke_device`; the completed route
  returns success and invalidates the target session.
- The lifecycle test proves a pending device receives HTTP 401 and no session
  cookie before root approval.
- The lifecycle test proves the active root cannot revoke itself.
- Browser canonical bytes include the exact target-bound `revoke_device`
  challenge.
- Final Standards review: no P1/P2.
- Final Spec review: no P1/P2 after adding the missing pre-approval assertion.
- `node --check` passed for every changed runtime JavaScript file.
- `git diff --check` passed.

## Production Boundary Verification

| Check | Result |
| --- | --- |
| Public `/api/health` | HTTP 200 |
| Public `/admin` | HTTP 200 |
| Unauthenticated `/admin/api/cases` | HTTP 401 |
| Public privacy page | HTTP 200 |
| Public consumer feed | HTTP 200 |
| Admin CSP | strict self-only policy present |
| Permissive admin CORS | absent |
| Admin cache policy | `Cache-Control: no-store` |
| Valid App JWT against admin auth | HTTP 401 |
| Admin session against consumer `/api/me` | HTTP 401 |
| Approved root devices after verification | 1 |
| Revoked test devices after verification | 1 |
| Active root sessions after verification | 1 |
| Active non-root sessions after verification | 0 |
| Live pending device requests | 0 |
| `admin.device_revoked` audit events | 1 |

## Credential And Root Enrollment Verification

- Rudy entered the separate administrator username and password only through a
  local hidden terminal workflow.
- The production CLI created exactly one administrator.
- Bootstrap and ten recovery codes were displayed only in the local protected
  flow; the saved-material marker is mode `600` and contains no codes.
- The current Chrome device enrolled as the sole root device.
- Logout followed by a fresh password plus signed challenge login succeeded,
  proving that the browser retained and used its device key. Static and unit
  checks prove the key generation call marks the private key non-exportable.

## Second-Device Trust Verification

1. An independent headed browser submitted correct credentials and remained
   pending without a session.
2. One request was deliberately rejected from the root device; server state
   returned to one approved root, zero pending requests, and one active root
   session with an `admin.device_rejected` audit event.
3. The independent browser applied again. The root compared the six-character
   code locally and approved the request without recording the code.
4. The independent browser obtained console access only after approval and a
   fresh password plus signed challenge login.
5. The root used the production revocation dialog, supplied a reason, and
   signed a fresh target-bound `revoke_device` challenge.
6. The root UI showed the device as revoked. Refreshing the independent
   browser returned it to the administrator login page with the explicit
   session-expired message.
7. Production state then showed one approved root, one revoked test device,
   one active root session, zero active non-root sessions, zero live pending
   requests, and one revocation audit event. The independent browser session
   and its temporary automation artifacts were closed and removed.

## Rollback Boundary

Because a real administrator and recovery material now exist, never apply the
Stage 5 down migration in ordinary rollback. To disable console exposure, set
`ADMIN_WEB_ENABLED=false` and restart `zbt-backend.service`; consumer APIs
continue. To roll back only the device-revocation runtime, restore
`/opt/zbt-backend.pre-revoke-20260714-140122` and restart the service. The
additive challenge-purpose constraint may safely remain because earlier code
does not use the added value.

## Consumer Admin Retirement Verification

Before removing the legacy consumer authorization path, the production root
device exercised every publication-review action through the isolated web
console. The temporary data consisted only of one `.invalid` synthetic user,
five synthetic posts, and five synthetic moderation reviews with a dedicated
Stage 6 Task 7 prefix.

| Web action | Review status | Synthetic post status |
| --- | --- | --- |
| Approve | `active` | `active` |
| Reject | `rejected` | `rejected` |
| Hide | `hidden` | `hidden` |
| Remove | `removed` | `removed` |
| Ignore signal | `ignored` | unchanged at `review` |

All five records had a handled timestamp and the expected synthetic reason.
The administrator audit page displayed five `moderation.review_decided`
events with five distinct synthetic subjects. After verification, the
synthetic user, posts, and moderation reviews were deleted transactionally;
the five administrator audit events were retained, the three pre-existing
pending reviews remained unchanged, and the temporary database tunnel was
closed.

Commit `b229b95` then removed the consumer iOS admin route and prototype views,
the consumer moderation list/decision endpoints, and the `ADMIN_EMAILS`
authorization contract. The isolated `/admin/api/moderation-reviews` API and
web console remain available. Verification passed as follows:

- Node tests: 92/92.
- PostgreSQL integration tests: 195/195. The legacy consumer GET and POST
  endpoints return HTTP 404 while the administrator API continues to pass.
- Swift package tests: 27/27.
- iPhone 17 Pro Debug simulator build: `BUILD SUCCEEDED`.
- Hidden-file reference scan and `git diff --check`: clean.
- Standards review: PASS with no P1/P2.
- Specification review: PASS after removing the stale `ADMIN_EMAILS` example.
