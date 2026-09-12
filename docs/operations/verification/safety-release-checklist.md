# Safety Release Checklist

Copy this checklist into a dated verification record for each rollout or
rollback. Check items only from observed evidence. A completed checklist does
not replace explicit authorization for production writes, provider spend, or
automatic enforcement.

## 1. Scope and authorization

- [ ] Exact source commit and intended runtime file set recorded.
- [ ] Production mutations, migrations, restart count, disposable data, and
  expected impact stated before execution.
- [ ] Separate authorization exists for this production checkpoint.
- [ ] Separate authorization exists for any paid provider call, including model,
  maximum calls, maximum CNY spend, approved rates/budget, and expected output.
- [ ] Enforce activation, if in scope, has its own explicit authorization.
- [ ] No merge, push, unrelated production service, or secret handling is
  inferred from a generic instruction to continue.

## 2. Local automated verification

- [ ] `npm --prefix backend test` passes with the exact count recorded.
- [ ] `PG_BINDIR=<PostgreSQL-16-bin> npm --prefix backend run test:db` passes
  with the exact count recorded and its temporary cluster is removed.
- [ ] `swift test --package-path .` passes with the exact count recorded.
- [ ] The iPhone 17 Pro Debug simulator build reports `BUILD SUCCEEDED`:

```bash
xcodebuild -project ZhouBianTuan.xcodeproj \
  -scheme ZhouBianTuan \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  CODE_SIGNING_ALLOWED=NO build
```

- [ ] `git diff --check` passes.
- [ ] No test server, PostgreSQL cluster, browser automation process, simulator
  helper, SSH tunnel, or test port remains after verification.

## 3. Local browser and client QA

- [ ] Administrator login requires password plus a signed approved device.
- [ ] Pending device cannot log in before signed root approval.
- [ ] Queue filtering, case detail, redacted evidence, audited reveal, decision,
  correction comparison, appeal, audit, AI Health, device approval/revocation,
  and logout pass at 1440x900.
- [ ] The same critical path passes at 390x844 with no horizontal overflow,
  clipped control, trapped focus, or keyboard-only blocker.
- [ ] Empty, loading, expired-session, stale-case, provider-unavailable,
  budget-blocked, and failed-request states are understandable and recoverable.
- [ ] Screenshots are stored only under ignored `output/playwright/`, visually
  inspected, then removed or left ignored as intended.
- [ ] Two iOS simulators verify all five report entries, collection-scope
  confirmation, offline retry, default block, My Reports, Content Remediation,
  same-ID restoration, one appeal, realtime update, and foreground sync.
- [ ] No three-second idle polling is present.

## 4. Secret, privacy, and staged-file checks

- [ ] The tracked-tree scan returns no secret values:

```bash
git grep -nE 'DASHSCOPE_API_KEY[=][^[:space:]]+|ALIYUN_ACCESS_KEY_SECRET[=][^[:space:]]+|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|zbt_admin_session[=][^[:space:]]+|WS_TEST_TOKEN[=][^[:space:]]+' -- \
  ':!docs/superpowers/plans/**' ':!backend/.env.example' \
  ':!backend/scripts/run-db-tests.sh' ':!backend/test/**'
```

- [ ] The excluded example/test files contain only their reviewed fixed
  placeholders and synthetic values; no copied environment value is present.
- [ ] A second scan covers the release archive/staging directory without
  printing matched values into a verification record.
- [ ] No `.env`, private environment file, backup, dump, credential, recovery
  code, bootstrap code, device short code, session cookie, API key, private key,
  raw model response, or evidence body is staged.
- [ ] `git status --short --branch` was inspected.
- [ ] `git diff --cached --name-only` contains only intentional release files.
- [ ] User-owned `CODEX_HANDOFF.md` remains outside commits unless explicitly
  requested.
- [ ] Reporter identity remains absent from owner-facing APIs/UI; administrator
  evidence remains redacted until an audited reveal.

## 5. Backup and migration preflight

- [ ] Current service state, restart counter, runtime release marker, migration
  list, flags, and aggregate row counts recorded without private values.
- [ ] Database backup/snapshot is current, mode `600` where applicable, and a
  restore-list or equivalent integrity check passes.
- [ ] Runtime and Nginx backups exist, preserve ownership/mode, and have verified
  checksums or file manifests.
- [ ] The exact not-yet-applied migration set is recorded.
- [ ] Migration order is P0, 013, 014, 015, 016, administrator 017 changes, then
  safety AI 017 and retry audit 018; each migration is additive or its index
  replacement is stated.
- [ ] Migration runs in a controlled transaction and its migration record is
  verified before runtime activation.
- [ ] Down migrations are excluded from the ordinary production rollback plan.
- [ ] The prepared rollback command contains the verified private backup paths
  and a fresh incident suffix, but no secret values:

```bash
sudo systemctl stop zbt-backend.service
sudo mv /opt/zbt-backend /opt/zbt-backend.failed-<UTC>
sudo cp -a <verified-runtime-backup> /opt/zbt-backend
sudo cp -a <verified-nginx-backup> /etc/nginx/sites-enabled/zbt-backend
sudo nginx -t
sudo systemctl start zbt-backend.service
sudo systemctl reload nginx
sudo systemctl is-active zbt-backend.service
```

## 6. Flag and provider preflight

- [ ] Private environment file ownership and mode `600` verified without
  printing contents.
- [ ] Expected checkpoint flags recorded by name: case intake, AI mode,
  automatic actions, budget, token rates, upload/supplement bounds, and
  administrator web.
- [ ] First deployment is cases off, AI off, actions false, budget zero.
- [ ] Intake checkpoint is cases on, AI off, actions false, budget zero.
- [ ] AI schema checkpoint is AI off, actions false, budget zero.
- [ ] Shadow checkpoint is `shadow` with actions false; any nonzero budget has
  separate paid authorization.
- [ ] Enforce checkpoint is `enforce` with actions true only after explicit
  approval and a passing non-bypassable gate.
- [ ] AI Health reports exact current model/prompt/policy/fixture versions,
  provider mode, spend state, job state, and gate checks without a bypass UI.
- [ ] Synthetic evaluations are excluded from the 30-real-comparison gate.
- [ ] Automatic account action count is zero.

## 7. Deployment and immediate verification

- [ ] Release closure includes required runtime dependencies and excludes tests,
  artifacts, local dependencies, secrets, and private backups unless explicitly
  required and reviewed.
- [ ] Locked production dependencies install successfully in staging.
- [ ] JavaScript syntax and runtime dependency loading pass in staging.
- [ ] Runtime switch is atomic or has a verified immediate restore path.
- [ ] Service restart count matches the announced count and service is active.
- [ ] No startup-failure, unhandled rejection, secret-value, evidence-body, or
  unexpected provider-call marker appears in recent logs.
- [ ] Public health returns HTTP 200.
- [ ] Public privacy policy returns HTTP 200.
- [ ] Consumer feed and one authenticated consumer endpoint return HTTP 200.
- [ ] Cursor sync returns the expected event and cursor progression.
- [ ] Authenticated WebSocket receives `sync.available`; an invalid token is
  rejected during upgrade.
- [ ] `/admin` matches the intended enabled/disabled checkpoint.
- [ ] Unauthenticated and App-JWT requests to administrator APIs return 401.
- [ ] Administrator cookie cannot authorize a consumer endpoint.

## 8. Safety workflow smoke

- [ ] Create one uniquely prefixed disposable consumer report only after the
  exact cleanup scope is prepared.
- [ ] Report API, evidence ownership, case row, immutable evidence, and
  `case_received` job match the expected checkpoint.
- [ ] AI-off routes to human review with no provider call; shadow persists a run
  and proposals without changing public state; budget zero records a block with
  zero usage/action.
- [ ] Administrator can log in from the approved root device and inspect the
  case without seeing reporter identity by default.
- [ ] One disposable second-device request is pending before root approval,
  approved only after signed confirmation, then revoked with its session dead.
- [ ] One temporary content action affects only the exact target and persists an
  administrator audit event plus owner/reporter sync events.
- [ ] Owner correction publishes to the same ID and preserves interactions.
- [ ] Collection correction leaves independently hidden child content hidden.
- [ ] Appeal acceptance, duplicate rejection, and AI non-decision are verified
  when that boundary is in scope.
- [ ] Disposable rows/objects are deleted only by an exact-count transaction;
  retained audit events and unrelated rows are explicitly accounted for.

## 9. Rollback drill and closeout

- [ ] Disable automatic actions first, then AI, then intake compatibility only
  if needed; each step has a stated verification.
- [ ] One disposable automatic action is rolled back without changing a human
  or sibling-case restriction.
- [ ] Runtime restore drill validates backup contents and permissions.
- [ ] Nginx backup passes `nginx -t`; authenticated WebSocket and REST fallback
  pass after the drill.
- [ ] Health, privacy, feed, consumer auth, sync, WebSocket, administrator
  isolation, flags, jobs, spend, service, logs, and aggregate counts match the
  predeclared postconditions.
- [ ] All temporary tunnels, ports, browsers, simulators, test processes, and
  disposable data are removed.
- [ ] Dated verification record contains counts and conclusions only—no secrets,
  private addresses, credentials, evidence bodies, or raw provider output.
- [ ] Residual risks and the exact next authorization boundary are recorded.
