# Stage 8 Production Shadow Rollout and Rollback Drill - 2026-07-16

Status: PASS — SHADOW ACTIVE; AUTOMATIC ACTIONS DISABLED; ENFORCEMENT GATE CLOSED

## Scope and authorization

- Authorized source commit: `04af0c913cb37fb18bf68758cac06626bd150d39`.
- Production service: `zbt-backend.service`.
- Authorized mutations: fresh database/runtime/Nginx backups, migration
  `018_safety_ai_retry_runs.sql`, one atomic runtime switch, one planned service
  restart, one uniquely prefixed disposable report, a human no-action decision,
  a reversible temporary action and rollback, and exact-count cleanup.
- Required flags stayed unchanged: cases enabled, AI shadow, automatic actions
  disabled, monthly service budget zero, and administrator web enabled.
- No paid provider call, enforcement activation, Nginx reload, merge, push, or
  unrelated production mutation was in scope or performed.

## Release closure and preflight

- The source-only release closure contained 137 archive entries and excluded
  tests, documentation, `.env`, `node_modules`, local artifacts, and backups.
- Clean archive SHA-256:
  `fcc4c85f812258ff417273815300f643ee91b55d3fa6b15879320c42883f77ac`.
- The uploaded checksum and full release marker matched the authorized commit.
- Locked production dependencies installed successfully on the Linux candidate.
  Runtime dependency loading, every runtime JavaScript syntax check, shell
  syntax, archive structure, and source/archive secret scans passed.
- The unchanged dependency lock reported two moderate audit advisories. They
  were already present in the production dependency set and were not changed
  during this rollout.
- A first macOS-created candidate exposed `._app.js` as an AppleDouble sidecar;
  server-side syntax checking rejected it before migration or runtime switch.
  That candidate and archive were removed, then rebuilt from `git archive`.
- A first Nginx backup copy placed under `sites-enabled` was correctly rejected
  by `nginx -t` as a duplicate listener. No reload occurred and the live Nginx
  process was unaffected. The copy was immediately moved outside the included
  directory; the repeated configuration test passed.

## Backups and rollback points

- PostgreSQL 16 custom-format backup, private ignored file:
  `.project-secrets/backups/zbt-before-stage8-20260716-200847.dump`.
- Database backup SHA-256:
  `445b2c3ce87860d44b6eeabb7d97acbd0ef1b08c67e9a57ffd61716e2fff670c`.
- The database backup remained mode `600` and passed `pg_restore --list`.
- Verified runtime backup:
  `/opt/zbt-backend.stage8-task8-backup-20260716-200847`.
- Immediate pre-switch runtime:
  `/opt/zbt-backend.stage8-task8-replaced-20260716-200847`.
- Verified Nginx backup outside `sites-enabled`:
  `/etc/nginx/zbt-backend.stage8-task8-backup-20260716-200847`.
- Runtime backup diff, Nginx byte comparison, environment ownership/mode, and
  final `nginx -t` all passed.
- Ordinary rollback restores the verified runtime and Nginx copy, then restarts
  the backend once. Migration 018 and administrator audit evidence remain in
  place; a database restore is reserved for a separately authorized emergency.

## Migration and activation

- Production PostgreSQL reported version 16.13.
- The exact not-yet-applied migration set was only
  `018_safety_ai_retry_runs.sql`.
- The migration runner skipped 001 through all 017 migrations and applied 018
  in its controlled transaction.
- Post-migration verification found one migration record, `retryable boolean
  NOT NULL DEFAULT false`, one valid unique partial index, no legacy full
  evidence-identity constraint, and no invalid indexes.
- Aggregate row counts were unchanged by the migration.
- The runtime switch was atomic. PID changed from 338023 to 340609. The journal
  contains exactly one planned stop and one planned start; `NRestarts` remains
  zero.
- A health request issued immediately after systemd returned active arrived
  before Node bound port 8080. The same process logged `server.started` within
  one second and the subsequent health check returned HTTP 200; no second
  restart was performed.

## Public, consumer, realtime, and administrator smoke

| Check | Result |
| --- | --- |
| Public health | HTTP 200 |
| Public feed | HTTP 200 |
| Privacy policy | HTTP 200 |
| Administrator shell | HTTP 200 |
| Unauthenticated administrator API | HTTP 401 |
| App JWT against administrator API | HTTP 401 |
| Authenticated consumer profile/bootstrap | HTTP 200 |
| Authenticated sync and reporter status | HTTP 200 |
| Authenticated WebSocket notification | `sync.available` |
| Invalid WebSocket token | HTTP 401 |
| Root-device signed administrator login | PASS |
| Administrator browser console warnings/errors | 0 |

The disposable report produced one manual-review case, one immutable evidence
row, two completed jobs, and one non-synthetic shadow AI run. With service
budget zero, the run stopped before network access as `budget_blocked` /
`budget_disabled`, with zero tokens, zero cost, empty raw response, no usage
row, and no safety action.

The approved root device then recorded these human decisions in order:

1. no action;
2. temporary post hide;
3. restore content.

During the temporary action the public post endpoint returned 404, the owner
content-action endpoint exposed the exact case, and the reporter saw the report
as handled. After rollback, the post returned HTTP 200, the case was
`resolved_restored`, manual hold was false, and the sole `hide_post` action was
`rolled_back`. The case timeline contained one rollback event. The audit page
showed all three decisions from the signed root device.

## Exact-count cleanup

Before cleanup, a single transaction asserted exactly:

- 2 disposable users;
- 1 post, 1 report, 1 case, and 1 evidence row;
- 6 case events, 1 rolled-back action, and 2 completed jobs;
- 1 zero-budget AI run, 0 usage rows, and 0 AI evaluations;
- 7 disposable-user sync events;
- 3 administrator decision audit rows to retain;
- 0 applied system/AI actions.

The transaction deleted the report before the RESTRICT-linked case, then the
post and two users. Case-linked evidence, events, jobs, action, and AI run were
removed by the declared cascades; user-linked sync events were removed by their
cascades. All preconditions and postconditions passed before commit.

Final aggregates are users 5, reports 0, cases 3, AI runs 3, AI usage rows 3,
AI evaluations 0, and safety actions 0. The three administrator audit rows were
retained as authorized. Migration 018 remains applied.

## Final production state

- Release marker: `04af0c913cb37fb18bf68758cac06626bd150d39`.
- Service: active/running, PID 340609, `NRestarts=0`.
- Flags: cases on, shadow, automatic actions false, monthly budget zero,
  administrator web on.
- AI state: zero active runs, zero real runs, zero automatic actions, committed
  synthetic validation spend CNY 0.006918, reserved CNY 0.
- AI Health: zero pending/running/failed analysis jobs, 100/100 fixtures, zero
  scope-expansion errors, zero automatic account actions, and 0/30 real human
  comparisons.
- Public health/feed/privacy/admin returned 200; unauthenticated administrator
  API returned 401.
- Since activation: one planned stop/start, zero startup-failure markers, zero
  provider-call markers, and zero sensitive-value markers.
- Temporary database tunnel, rejected candidate, remote upload, and local test
  staging were removed. Local database port 55440 is free.

## Remaining operational boundaries

- The first 30 real current-version cases still require sole-admin final
  decisions and AI comparison records. No synthetic or budget-blocked run counts
  toward that gate.
- Enforcement remains closed. Any later `enforce` mode or automatic-action
  activation requires passing metrics and a separate explicit production
  authorization.
