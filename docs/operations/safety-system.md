# Safety System Operations Runbook

This runbook is the operator reference for the report, remediation, isolated
administrator, and AI-shadow subsystems. It describes safe defaults and the
order of operations; it does not grant production, paid-provider, or automatic
enforcement authorization.

## Safety invariants

- Consumer and administrator identities are separate. An App JWT is not an
  administrator credential, and an administrator session is not a consumer
  credential.
- Reporter identity is never returned to the reported user and is anonymous by
  default in the administrator UI.
- AI output is advisory data until the deterministic policy and the runtime
  enforcement gate both accept it. Missing configuration, stale state, provider
  failure, invalid schema, exhausted budget, or failed gate evidence closes to
  human review.
- AI and system actors cannot restrict accounts, decide copyright cases,
  resolve appeals, permanently remove content, approve administrator devices,
  or recover administrator access.
- Human terminal decisions, appealed cases, and `manual_hold` take precedence
  over later AI work. An automatic rollback never rolls back a human action.
- Safety actions are idempotent and retain before/after state. Roll back one
  action only after checking for other active restrictions on the same target.
- A collection restriction changes the collection's effective visibility or
  contact presentation. It does not rewrite child posts' own moderation state.

## Architecture and ownership

| Area | Primary modules | Responsibility |
| --- | --- | --- |
| Report intake | `reportRoutes.js`, `reportValidation.js`, `subjectResolver.js`, `caseService.js`, `evidenceService.js` | Validate source/reason/field combinations, resolve the server-authoritative target and scope, capture bounded immutable evidence, deduplicate retries, and enqueue case work. |
| Visibility and actions | `visibility.js`, `safetyTargetLock.js`, `actionService.js`, `policyEngine.js`, `reportAbuseService.js` | Apply effective read rules, serialize target changes, record idempotent actions, reject scope expansion, count independent valid reporters, and preserve human authority. |
| Remediation and appeals | `revisionRoutes.js`, `revisionService.js`, `revisionReview.js`, `revisionPublishing.js`, `appealService.js` | Accept owner revisions and one eligible appeal, review immutable candidates, publish to the same content ID, and restore only restrictions that are safe to restore. |
| Durable jobs | `jobQueue.js`, `jobWorker.js`, `reportUploadCleanup.js`, `maintenanceService.js` | Claim with leases, retry with bounded backoff, clean unattached uploads, process correction deadlines, close quiet low-risk cases, and apply retention. |
| AI shadow/enforcement | `promptBuilder.js`, `qwenCaseProvider.js`, `aiService.js`, `budgetService.js`, `enforcementGate.js` | Minimize evidence, validate the closed Qwen result schema, reserve and settle spend, persist proposals, and recheck case freshness and the gate immediately before any automatic action. |
| Administrator control plane | `src/admin/*`, `admin-web/*` | Isolated password plus signed-device authentication, root device approval/revocation, audited evidence reveal, human decisions, report invalidation, appeal handling, AI health, and human comparisons. |
| Client convergence | `sync.js`, `realtime.js` and iOS safety stores/views | Persist owner/reporter sync events, notify WebSocket clients after commit, and converge through cursor sync after reconnect or foregrounding. |

Aliyun moderation is the hard-safety signal. Qwen classifies a minimized case
packet and recommends an action within a closed schema. Neither provider may
expand the database-selected subject or impact scope. The policy engine owns the
allowlist; the gate owns whether an otherwise eligible proposal may execute.

### Durable data

- Core case data: `reports`, `safety_cases`, `safety_evidence`,
  `safety_case_events`, `safety_actions`, and `safety_jobs`.
- Upload/remediation data: `report_uploads`, `content_revisions`, and
  `safety_appeals`.
- Administrator data: `admin_users`, `admin_devices`,
  `admin_device_requests`, `admin_auth_challenges`, `admin_sessions`,
  `admin_recovery_codes`, `admin_bootstrap_codes`, and `admin_audit_events`.
- AI audit and spend data: `safety_ai_runs`, `safety_ai_usage`, and
  `safety_ai_evaluations`.

Job types currently include `case_received`, `analyze_case`,
`review_revision`, `cleanup_report_upload`,
`delete_retained_evidence_objects`, `maintenance_correction_deadlines`,
`maintenance_low_risk_cases`, `maintenance_evidence_retention`, and
`maintenance_audit_retention`. Hourly maintenance keys and PostgreSQL advisory
locks make multiple processes and restarts safe.

### Collection child-state invariant

`suspend_collection` writes only `group_collections.safety_status` and
`hide_collection_contact` writes only `group_collections.contact_visibility`.
Public post reads combine that parent context with each post's own
`posts.safety_status`. Publishing a corrected collection mirrors approved
shared fields but does not change child moderation. Therefore a clean child can
become visible when its parent is restored while an independently hidden child
remains hidden.

## Retention

- Unattached report uploads are tracked and deleted by retryable cleanup jobs;
  completed cleanup-job history is pruned after its configured retention.
- Closed direct-message evidence is redacted at 180 days unless the case is
  unresolved or has a pending appeal. Text, structured message bodies, object
  keys, and related raw AI responses are cleared; case/action/outcome metadata
  remains.
- Administrator audit rows older than two years are deleted for low-value auth
  failures or de-identified to coarse outcome metadata. Unresolved cases and
  pending appeals are excluded.
- Database rows are updated before object deletion. Failed object deletion stays
  observable and retryable; operators must not delete evidence objects first.

## Configuration and safe defaults

Keep production values in an operator-managed environment file owned by the
service account with mode `600`. Edit it through the established protected
workflow and verify ownership and mode without printing its contents. Never put
provider keys, passwords, recovery material, host addresses, session tokens, or
private keys in Git, tickets, screenshots, shell history, or this runbook.

The safe baseline is:

```dotenv
SAFETY_CASES_ENABLED=false
SAFETY_AI_MODE=off
SAFETY_AUTO_ACTIONS_ENABLED=false
SAFETY_AI_MONTHLY_BUDGET_CNY=0
SAFETY_QWEN_INPUT_CNY_PER_MILLION=0
SAFETY_QWEN_OUTPUT_CNY_PER_MILLION=0
SAFETY_REPORT_UPLOAD_OUTSTANDING_MAX=24
SAFETY_REPORT_UPLOAD_ACCOUNT_MAX_24H=60
SAFETY_REPORT_SUPPLEMENT_ACCOUNT_MAX_24H=40
SAFETY_REPORT_SUPPLEMENT_IP_MAX_24H=120
SAFETY_REPORT_SUPPLEMENT_BURST_MAX_MINUTE=10
ADMIN_WEB_ENABLED=false
```

| Variable | Purpose | Safe default |
| --- | --- | --- |
| `SAFETY_CASES_ENABLED` | Enables case intake, case/revision workers, and maintenance handlers. | `false` |
| `SAFETY_AI_MODE` | Selects `off`, proposal-only `shadow`, or gate-controlled `enforce`. | `off` |
| `SAFETY_AUTO_ACTIONS_ENABLED` | Allows the runtime to attempt gate-controlled actions. It does not bypass the gate. | `false` |
| `SAFETY_AI_MONTHLY_BUDGET_CNY` | Maximum monthly AI spend accepted by the reservation guard. | `0` |
| `SAFETY_QWEN_INPUT_CNY_PER_MILLION` | Input-token rate used for conservative reservations and settlement. | `0` |
| `SAFETY_QWEN_OUTPUT_CNY_PER_MILLION` | Output-token rate used for conservative reservations and settlement. | `0` |
| `SAFETY_REPORT_UPLOAD_OUTSTANDING_MAX` | Per-account unattached report-upload ceiling. | `24` |
| `SAFETY_REPORT_UPLOAD_ACCOUNT_MAX_24H` | Per-account report-upload issuance ceiling in 24 hours. | `60` |
| `SAFETY_REPORT_SUPPLEMENT_ACCOUNT_MAX_24H` | Per-account evidence-supplement ceiling in 24 hours. | `40` |
| `SAFETY_REPORT_SUPPLEMENT_IP_MAX_24H` | Per-IP evidence-supplement ceiling in 24 hours. | `120` |
| `SAFETY_REPORT_SUPPLEMENT_BURST_MAX_MINUTE` | Per-account evidence-supplement burst ceiling. | `10` |
| `ADMIN_WEB_ENABLED` | Exposes the isolated same-origin administrator console and API. | `false` |

Changing a budget or rate is a paid-provider decision. Changing a production
flag or restarting a service is a production write. Obtain the corresponding
authorization before either action.

## Rollout order

At every checkpoint, stop if the stated postconditions fail. Do not skip ahead
because a later feature is disabled.

1. **P0 realtime foundation:** deploy cursor sync, foreground recovery,
   WebSocket authentication, and Nginx upgrade handling; verify REST fallback
   before any safety feature depends on it.
2. **Migration 013:** take and validate a database backup, apply the core safety
   schema, and deploy the runtime with `SAFETY_CASES_ENABLED=false`.
3. **Core off verification:** verify health, feed, privacy, auth, sync, WebSocket,
   service state, migration record, and unchanged aggregate counts.
4. **Intake on, AI off:** set `SAFETY_CASES_ENABLED=true`, keep AI off and
   automatic actions false, restart once, submit one disposable report, and
   confirm `case_received` completes into human review with no provider call.
5. **iOS report client:** release the five report entry points, offline retry,
   My Reports, and sync handling after the compatible backend is live.
6. **Migration 014:** add report-upload registration/cleanup, verify old uploads
   are registered and cleanup is retryable, then enable the new client flow.
7. **Migration 015:** add revisions and appeals, deploy owner remediation APIs,
   verify same-ID correction and interaction preservation.
8. **Migration 016:** apply the appealed-case aggregation index change and prove
   a new report cannot be folded into the appealed case.
9. **Administrator auth:** apply `017_admin_auth.sql`, keep the web disabled,
   create the separate administrator through the protected CLI, preserve
   recovery material outside Git, and verify consumer/admin isolation.
10. **Administrator web/root:** enable the console, enroll the root device,
    approve and revoke a disposable second device, inspect the audit trail, and
    remove all disposable access.
11. **Safety AI schema:** apply `017_safety_ai.sql` with AI off, automatic actions
    false, and budget zero; verify the three AI tables and no provider activity.
12. **Shadow:** after separate budget/provider authorization, set shadow mode,
    keep automatic actions false, and collect only real current-version human
    comparisons. Synthetic diagnostics never count toward the gate.
13. **Gate:** verify 100 current fixtures, zero schema failures, at least 95%
    auto-hide precision, 30 current-version real comparisons, zero scope errors,
    zero automatic account actions, and exact model/prompt/policy versions.
14. **Enforce:** only after explicit production authorization, set enforce mode
    and automatic actions true. Start with a bounded observation window; the
    runtime gate must still pass immediately before every action.

## Rollback order

Rollback is containment first, schema destruction last:

1. Set `SAFETY_AUTO_ACTIONS_ENABLED=false`; restart once and verify no new
   automatic action can be applied.
2. Set `SAFETY_AI_MODE=off` and budget to zero; restart once and verify new cases
   route to human review with no provider call.
3. If intake itself is unhealthy, set `SAFETY_CASES_ENABLED=false` to return the
   report API to its compatibility path. Preserve cases, evidence, and jobs.
4. For administrator compromise, disable the web if necessary and revoke the
   affected device/sessions through the trusted root or recovery workflow.
5. Roll back individual automatic actions through the audited action rollback;
   verify no human or sibling-case restriction still requires the state.
6. Restore the last verified runtime and Nginx backups, preserving ownership and
   permissions. Validate Nginx before reload and restart the backend once.
7. Re-run health, feed, privacy, consumer auth, sync, WebSocket, administrator
   isolation, job, flag, log, and aggregate-count checks.

Operator command template after substituting already verified private backup
paths and a fresh UTC incident suffix:

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

Do not run a down migration as an ordinary rollback. The down SQL files are
local migration-test artifacts. Production rollback normally retains additive
tables and evidence so the incident remains auditable.

## Incident procedures

### Provider outage or repeated provider errors

- **Signal:** provider timeouts/429s, rising failed or invalid AI runs, failed
  `analyze_case` jobs, or AI Health reports an unavailable provider.
- **Contain:** disable automatic actions, set AI mode off, and set budget zero.
  Do not retry a paid diagnostic without fresh spend authority.
- **Verify:** new reports reach human review, no new usage reservation or action
  appears, the worker continues non-AI jobs, and logs contain no evidence or key.
- **Recover:** validate provider access with an approved synthetic diagnostic,
  fix the root cause, then return to shadow only. Re-enter enforce only after the
  gate and the full release checklist pass again.

### Queue growth or stale leases

- **Signal:** pending age grows, running jobs exceed their lease, retry counts
  rise, or maintenance health falls behind its hourly key.
- **Contain:** keep automatic actions off, preserve queue rows, confirm database
  health and worker count, and avoid manually deleting or completing jobs.
- **Verify:** inspect counts by type/status, oldest `run_at`, stale locks, generic
  error codes, and whether one worker can claim and complete a disposable job.
- **Recover:** repair database/worker capacity, restart one worker generation,
  allow fenced leases and bounded retries to drain, and verify idempotent
  postconditions before restoring shadow traffic.

### Budget exhaustion or rate drift

- **Signal:** `budget_blocked`, actual plus reserved spend reaches the cap, or
  configured rates do not match the approved provider rate card.
- **Contain:** set AI mode off, automatic actions false, and budget zero. Never
  raise a cap merely to clear jobs.
- **Verify:** reconcile settled/reserved/released usage, prove no provider was
  constructed after a blocked reservation, and confirm cases entered human
  review.
- **Recover:** obtain explicit budget and rate authorization, update the private
  environment without exposing values, restart once, and resume shadow first.

### Suspected false automatic hide

- **Signal:** owner appeal, administrator comparison failure, precision drop,
  unexpected scope, or an applied action inconsistent with hard signals.
- **Contain:** disable automatic actions and AI, put affected cases on manual
  hold, and identify the exact automatic action IDs. Do not bulk restore.
- **Verify:** compare case/event/run/action history, valid reporter support, and
  every other active restriction on the same target.
- **Recover:** roll back only unsupported automatic actions, preserve human
  actions, reproduce test-first, fix policy/gate logic, complete review and full
  verification, then collect a new shadow window.

### Lost root device

- **Signal:** the only trusted root device is unavailable or suspected lost.
- **Contain:** disable the administrator web if exposure is a concern. Use one
  offline recovery code only through the protected recovery UI; never paste or
  log it elsewhere.
- **Verify:** recovery revoked old sessions, the lost device is revoked, exactly
  the intended replacement root is approved, and audit events match the flow.
- **Recover:** save the remaining recovery material offline, perform a fresh
  signed login, test second-device approval/revocation, and re-enable the web
  only after isolation checks pass.

### Suspected administrator session theft

- **Signal:** unfamiliar device/session use, unexpected evidence reveal or
  decision audit events, or administrator activity outside the expected window.
- **Contain:** disable the web if needed, revoke the device and all related
  sessions from a trusted root or use recovery to revoke old sessions.
- **Verify:** protected APIs reject the old session, consumer APIs reject the
  administrator cookie, and the audit trail is preserved and reviewed.
- **Recover:** approve a clean device, perform a fresh signed login, review all
  affected cases/actions, and re-enable access only after no live unauthorized
  session remains.

### Evidence-access review

- **Signal:** an unexpected `safety.evidence_viewed` event, object proxy access,
  or evidence retrieval outside an assigned case review.
- **Contain:** preserve audit/service/object-access logs, revoke the suspected
  session/device, disable evidence access with the administrator web if needed,
  and do not alter the evidence rows.
- **Verify:** map event to administrator, device, session, case, reason, and time;
  prove private report objects were never exposed by the public asset route.
- **Recover:** complete the access review, restore only approved reviewer access,
  and document any owner/reporting obligations without copying evidence bodies.

### WebSocket regression

- **Signal:** authenticated upgrade fails, sync notifications stop, connections
  leak during shutdown, or clients converge only after manual refresh.
- **Contain:** keep REST cursor/foreground sync available and roll back the Nginx
  configuration to its last verified backup if the proxy change is causal.
- **Verify:** run the authenticated WebSocket smoke, confirm an invalid token is
  rejected, then prove foreground cursor sync catches the missed event without
  three-second idle polling.
- **Recover:** fix and validate proxy/runtime shutdown behavior locally, deploy
  the reviewed Nginx file, run `nginx -t`, reload once, and repeat desktop plus
  two-client convergence checks.

## Release evidence

Use [the safety release checklist](verification/safety-release-checklist.md) for
every production checkpoint. Store dated results under `docs/operations/verification/`
only after removing secrets, credentials, evidence bodies, private addresses,
and disposable user data.
