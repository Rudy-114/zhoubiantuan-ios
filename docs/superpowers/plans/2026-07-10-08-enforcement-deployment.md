# Enforcement and Production Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish retention, deadlines, abuse handling, enforcement gates, end-to-end verification, operational documentation, rollback drills, and the safe production rollout of the complete report system.

**Architecture:** Add scheduled safety maintenance jobs and a server-side gate checked immediately before every automatic action. Build one local end-to-end harness that spans consumer APIs, jobs, admin auth/actions, correction, appeal, and sync using mock providers. Production remains shadow-first; reaching the 30-real-case threshold is operational evidence gathered over time, not something tests fabricate.

**Tech Stack:** Existing Node/PostgreSQL worker, Node HTTP integration tests, Swift/Xcode verification, Playwright CLI, Nginx/systemd/RDS production environment.

## Global Constraints

- Production `enforce` cannot be activated by environment configuration alone; the runtime gate must also pass.
- Fixture or synthetic evaluations never count toward the 30 real cases.
- Automatic account action count must remain zero in code, fixtures, database audit, and production health.
- Missing provider, budget, key, schema validity, gate evidence, or case freshness fails to human review.
- Deadline jobs and retention jobs are idempotent and safe to retry.
- Raw direct-message evidence is cleared 180 days after case closure.
- Raw Qwen responses tied to cleared evidence are cleared at the same time.
- De-identified decision/action/audit metadata is retained for two years; cleanup never erases an unresolved case or active appeal.
- Reporter identity remains hidden from the reported user and anonymous by default to admin.
- Production rollback uses feature flags and action rollback first; emergency rollback does not drop safety tables or evidence.
- No source push, production migration, service restart, or environment change occurs without staged-file/secret checks and a stated rollback.

---

### Task 1: Add Deadline and Retention Maintenance Jobs

**Files:**
- Create: `backend/src/safety/maintenanceService.js`
- Create: `backend/test/safety/maintenanceService.integration.test.js`
- Modify: `backend/src/safety/jobWorker.js`
- Modify: `backend/src/server.js`

**Interfaces:**
- Produces: `processCorrectionDeadlines`, `closeLowRiskCases`, `clearExpiredEvidence`, `deidentifyExpiredAudit`, and periodic job enqueue.

- [ ] **Step 1: Write failing time-controlled tests**

Use injected `now` and cover:

```text
invalid-contact correction due with no submitted revision -> suspend collection once
due case with pending revision -> no suspension
low-risk monitoring case after seven days, no new reports/hard signal/manual hold -> resolved_no_action
message evidence at 179 days -> retained
message evidence at 180 days -> text, structured message bodies, object keys, and AI raw response cleared
open/appealed case -> never cleared by age
two-year audit -> identifiers removed or row deleted according to event class
repeat maintenance -> no duplicate action/event
```

- [ ] **Step 2: Implement correction and low-risk rules**

Lock candidate cases with `FOR UPDATE SKIP LOCKED`. For overdue invalid contact, apply `suspend_collection` with idempotency key `deadline:suspend_collection:<caseId>`. For low-risk closure, require zero reports created in the last seven days beyond the original clue, no hard signal, no manual hold, and no active action.

- [ ] **Step 3: Clear raw evidence safely**

For closed direct-message cases older than 180 days:

```sql
UPDATE safety_evidence
SET text_snapshot = '',
    structured_snapshot = jsonb_build_object('redacted', true, 'reason', 'retention_expired'),
    object_keys = ARRAY[]::text[],
    redacted_at = now()
WHERE id = $1 AND redacted_at IS NULL;
```

Collect object keys before update, commit, then best-effort delete from OSS. Clear related `safety_ai_runs.raw_response`. Keep case, event, action, category, dates, and de-identified outcome metadata.

- [ ] **Step 4: De-identify two-year metadata**

For audit events older than two years, remove actor/session/device/IP identifiers and retain only event type, subject type, coarse month, and outcome when needed for aggregate accountability; delete low-value auth failure rows entirely. Unresolved cases and pending appeals are excluded from this cleanup.

- [ ] **Step 5: Schedule maintenance through PostgreSQL jobs**

At startup and every hour, enqueue unique hour-keyed jobs rather than running cleanup directly from timers. Register handlers with concurrency 1 per maintenance type so service restarts and multiple processes remain safe.

- [ ] **Step 6: Run and commit**

```bash
npm --prefix backend run test:db
npm --prefix backend test
git add backend/src/safety/maintenanceService.js backend/test/safety/maintenanceService.integration.test.js backend/src/safety/jobWorker.js backend/src/server.js
git commit -m "Add safety retention and deadline jobs"
```

### Task 2: Implement the Non-Bypassable Enforcement Gate

**Files:**
- Create: `backend/src/safety/enforcementGate.js`
- Create: `backend/test/safety/enforcementGate.integration.test.js`
- Modify: `backend/src/safety/aiService.js`
- Modify: `backend/src/admin/aiHealthService.js`

**Interfaces:**
- Produces: `evaluateEnforcementGate(client)` and `assertAutomaticActionsAllowed(client)`.

- [ ] **Step 1: Write every gate failure test**

Assert false for: fixture count 99, fixture schema failure, auto-hide precision 0.949, real evaluations 29, one scope error, one automated account action, model/prompt/policy version mismatch, and stale fixture version. Assert true only when all exact conditions pass.

- [ ] **Step 2: Implement the gate result**

```js
export async function evaluateEnforcementGate(client) {
  const metrics = await loadGateMetrics(client);
  const checks = {
    fixtureCount: metrics.fixtureCount === 100,
    fixtureSchemaValid: metrics.fixtureInvalidCount === 0,
    autoHidePrecision: metrics.autoHidePrecision >= 0.95,
    realComparisons: metrics.realEvaluationCount >= 30,
    noScopeErrors: metrics.scopeExpansionErrors === 0,
    noAutomaticAccountActions: metrics.automaticAccountActions === 0,
    versionsMatch: metrics.versionsMatch
  };
  return { passed: Object.values(checks).every(Boolean), checks, metrics };
}
```

Fixture metrics are computed at runtime from `backend/src/safety/fixtures/policyCases.js`; real evaluation metrics join only `safety_ai_runs.is_synthetic=false` and the current model, prompt, and policy versions. A version change therefore restarts the 30-case comparison window without deleting old audit history.

- [ ] **Step 3: Check immediately before action application**

Even when `SAFETY_AI_MODE=enforce`, `aiService` must re-read the current case, verify run/case version, call the gate, and only then call `applySafetyAction`. A failed gate stores proposals and sets reason `enforcement_gate_closed`; it does not mark the provider run failed.

- [ ] **Step 4: Expose gate checks without a bypass button**

AI Health displays each check and evidence count. There is no web toggle that overrides failures. Mode changes remain an operator environment/restart action, and runtime gate still controls execution.

- [ ] **Step 5: Run and commit**

```bash
npm --prefix backend test
npm --prefix backend run test:db
git add backend/src/safety/enforcementGate.js backend/test/safety/enforcementGate.integration.test.js backend/src/safety/aiService.js backend/src/admin/aiHealthService.js
git commit -m "Gate automatic safety enforcement"
```

### Task 3: Harden Report Abuse and Independent Reporter Counting

**Files:**
- Create: `backend/src/safety/reportAbuseService.js`
- Create: `backend/test/safety/reportAbuseService.integration.test.js`
- Modify: `backend/src/admin/caseRoutes.js`
- Modify: `backend/admin-web/caseViews.js`
- Modify: `backend/src/safety/policyEngine.js`

**Interfaces:**
- Produces: `markReportInvalid`, `independentReporterCount`, and admin “举报滥用” action.

- [ ] **Step 1: Write failing count tests**

Verify one account retry/evidence supplements count once, two valid distinct accounts count twice, closed/invalid abuse reports do not count, restricted reporters do not trigger the automatic threshold, and all clues remain visible to admin with their counting status.

- [ ] **Step 2: Implement invalidation without deleting evidence**

Admin can mark a report `invalid` with reason `malicious`, `coordinated`, `mistaken_target`, or `other`. Append event/audit, preserve evidence under retention, recalculate case independent count, and re-evaluate only reversible automatic actions. Never punish a target based on invalidated clues.

- [ ] **Step 3: Use the count in invalid-contact policy**

Compute distinct active reporter IDs within rolling seven days where report status is pending/closed-valid and abuse flag is absent. The threshold triggers only `hide_collection_contact`; account punishment is still impossible.

- [ ] **Step 4: Add compact admin controls and commit**

Show whether each clue counts toward the threshold. Marking abuse requires a reason and single-item confirmation.

```bash
npm --prefix backend run test:db
npm --prefix backend test
git add backend/src/safety/reportAbuseService.js backend/test/safety/reportAbuseService.integration.test.js backend/src/admin/caseRoutes.js backend/admin-web/caseViews.js backend/src/safety/policyEngine.js
git commit -m "Harden independent report counting"
```

### Task 4: Build One Full End-to-End Test Harness

**Files:**
- Create: `backend/test/e2e/safetyLifecycle.integration.test.js`
- Create: `backend/test/e2e/adminDeviceLifecycle.integration.test.js`
- Create: `backend/test/e2e/helpers.js`
- Modify: `backend/scripts/run-db-tests.sh`

**Interfaces:**
- Tests real Express HTTP, PostgreSQL, jobs, mocked Aliyun/Qwen, admin signatures, and sync events.

- [ ] **Step 1: Build deterministic actors**

Create owner, reporter A, reporter B, unrelated user, admin root, admin second device, collection, two child posts, comments, message thread, and seven-message context. Generate all tokens/keys in memory; never fixture real credentials.

- [ ] **Step 2: Test post-only action**

Report a post image/content issue, run shadow analysis and human temporary hide, assert sibling post stays visible, owner sees correction, reporter sees handled, correct revision restores same ID and interactions.

- [ ] **Step 3: Test collection contact cascade**

First invalid-contact report requests correction without hide. Second independent report within seven days hides collection contact, not posts. Advance 24 hours without correction to suspend collection, assert child statuses unchanged, publish corrected collection, and assert independently clean child restores while an independently hidden child does not.

- [ ] **Step 4: Test private message safety**

Report incoming message with block on, assert personal block and immutable seven-message evidence, apply temporary message hide distinct from revoke, close case, advance 180 days, run retention, and assert raw context cleared.

- [ ] **Step 5: Test admin device and appeal boundaries**

Prove password-only second device pending, root approval required, human restriction cannot auto-restore, one appeal accepted within seven days, second appeal rejected, AI cannot decide, and recovery revokes both old sessions.

- [ ] **Step 6: Run E2E in the DB script and commit**

Update the script to run safety/admin/e2e integration directories serially.

```bash
npm --prefix backend run test:db
git add backend/test/e2e/safetyLifecycle.integration.test.js backend/test/e2e/adminDeviceLifecycle.integration.test.js backend/test/e2e/helpers.js backend/scripts/run-db-tests.sh
git commit -m "Test complete safety case lifecycle"
```

### Task 5: Add the Operations and Rollback Runbook

**Files:**
- Create: `docs/operations/safety-system.md`
- Create: `docs/operations/verification/safety-release-checklist.md`
- Modify: `README.md`

**Interfaces:**
- Documents exact local verification, production flags, admin recovery, migration order, rollout, rollback, and incident response without secret values.

- [ ] **Step 1: Document architecture and ownership**

List API/service modules, job types, tables, provider roles, human-only actions, data retention, and why child post state is not mutated by a collection case.

- [ ] **Step 2: Document environment variable names and safe defaults**

Include names, purpose, and safe defaults only:

```dotenv
SAFETY_CASES_ENABLED=false
SAFETY_AI_MODE=off
SAFETY_AUTO_ACTIONS_ENABLED=false
SAFETY_AI_MONTHLY_BUDGET_CNY=0
SAFETY_QWEN_INPUT_CNY_PER_MILLION=0
SAFETY_QWEN_OUTPUT_CNY_PER_MILLION=0
ADMIN_WEB_ENABLED=false
```

Refer operators to mode-600 environment files; never include keys, passwords, recovery codes, host IPs, or tokens.

- [ ] **Step 3: Document exact rollout and rollback**

Rollout order: P0, 013, core off, intake on/AI off, iOS, 014, 015, admin web/root, 016, shadow, gate, enforce. Rollback order: stop automatic actions, AI off, intake compatibility, revoke admin sessions if needed, rollback individual actions, restore Nginx backup. Database down migrations are test artifacts, not first-line production rollback.

- [ ] **Step 4: Document incident procedures**

Include provider outage, queue growth, budget exhaustion, false automatic hide, lost root device, suspected admin session theft, evidence access review, and WebSocket regression. Every procedure names the observable signal, immediate containment, verification, and recovery.

- [ ] **Step 5: Add a release checklist and commit**

Checklist includes tests, Xcode, browser desktop/narrow, secret scan, staged files, migrations, backup, flags, health/privacy/feed/sync/ws, admin login/device, one disposable report, correction, audit, provider mode, and rollback command.

```bash
git add docs/operations/safety-system.md docs/operations/verification/safety-release-checklist.md README.md
git commit -m "Document safety system operations"
```

### Task 6: Run Independent Code Review and Fix Findings

**Files:**
- All files changed by Phases 1 through 8.

**Interfaces:**
- REQUIRED SUB-SKILL: `superpowers:requesting-code-review`.

- [ ] **Step 1: Request review against the design and plan**

Review from the pre-feature checkpoint through current HEAD for: spec coverage, auth bypass, privacy leaks, SQL concurrency, action idempotency, scope expansion, migration safety, client retry behavior, admin accessibility, provider spend, and rollback.

- [ ] **Step 2: Address every critical/high finding test-first**

Use `superpowers:receiving-code-review` for feedback. Reproduce each accepted defect with a failing test, implement the smallest fix, rerun focused/full tests, and make one focused commit per independent issue.

- [ ] **Step 3: Record accepted residual risks**

Only document risks that cannot be removed without changing the approved scope, such as real-case shadow evidence requiring elapsed production usage. Do not relabel unfinished implementation as residual risk.

### Task 7: Perform Complete Local Verification

**Files:**
- No source changes unless verification reveals a defect.

**Interfaces:**
- REQUIRED SUB-SKILL before claims: `superpowers:verification-before-completion`.

- [ ] **Step 1: Run all automated checks from a clean process state**

```bash
npm --prefix backend test
npm --prefix backend run test:db
swift test --package-path .
xcodebuild -project ZhouBianTuan.xcodeproj -scheme ZhouBianTuan -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO build
git diff --check
```

- [ ] **Step 2: Run admin browser QA through Playwright CLI**

Repeat login, queue, evidence reveal, decision, correction comparison, appeal, audit, AI health, device approval/revocation, logout, desktop 1440x900, and narrow 390x844. Save screenshots only under ignored `output/playwright/`, inspect them, then close the browser and server.

- [ ] **Step 3: Run two-simulator iOS QA**

Verify five report entries, collection scope confirmation, offline retry, default block, My Reports, Content Remediation, same-ID restoration, appeal, realtime update, foreground sync, and no three-second idle polling.

- [ ] **Step 4: Run secret and privacy scans**

```bash
git grep -nE 'DASHSCOPE_API_KEY=.+|ALIYUN_ACCESS_KEY_SECRET=.+|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|zbt_admin_session=|WS_TEST_TOKEN=.+' -- ':!docs/superpowers/plans/**'
git status --short --branch
git diff --cached --name-only
```

Expected: no secret-value matches; staged files contain only intentional source/docs; `CODEX_HANDOFF.md` remains outside commits unless separately requested.

### Task 8: Complete Production Shadow Rollout and Rollback Drill

**Files:**
- Production `/opt/zbt-backend`, `/etc/nginx/sites-enabled/zbt-backend`, and private environment files.

**Interfaces:**
- Uses the release checklist and established private SSH environment variables.

- [ ] **Step 1: Announce and confirm mutable production steps**

List exact migrations not yet applied, service restart count, flags, backup/snapshot state, disposable test data, and rollback commands. Paid validation remains separately confirmed from Phase 7.

- [ ] **Step 2: Deploy in approved order**

Verify staged source has no secrets, sync without `.env`/tests/artifacts unless required, install locked dependencies, migrate, restart, and check service active/restart count/log errors.

- [ ] **Step 3: Run public and authenticated smoke**

Verify health, privacy, feed, login, bootstrap, sync, public WebSocket, admin login/root signature, one disposable report, case appearance, human no-action decision, owner/reporter status, and audit. Remove disposable rows through supported cleanup/admin paths.

- [ ] **Step 4: Verify production safety mode**

Required initial state:

```text
SAFETY_CASES_ENABLED=true
SAFETY_AI_MODE=shadow
SAFETY_AUTO_ACTIONS_ENABLED=false
enforcement gate: closed until 30 real comparisons
automatic account actions: 0
```

- [ ] **Step 5: Drill reversible rollback without an incident**

On a disposable case, apply and roll back a temporary action, verify state/events/audit. Toggle automatic actions off if not already, verify report intake continues. Do not drop tables or erase evidence.

- [ ] **Step 6: Monitor first real cases**

For the first 30 real cases, the sole admin makes the final decision and records AI comparison. AI Health tracks precision and scope errors. If any scope-expansion error occurs, the gate stays closed and the policy/prompt must be revised with new fixtures before restarting the count.

- [ ] **Step 7: Enable enforcement only after a later explicit checkpoint**

When and only when all server checks pass, present metrics and proposed reversible action categories to Rudy, receive explicit approval, set `SAFETY_AI_MODE=enforce` and `SAFETY_AUTO_ACTIONS_ENABLED=true`, restart, and verify one low-risk reversible path. The implementation is complete before this operational evidence matures; production remains safely useful in shadow meanwhile.

### Task 9: Finish the Development Branch

**Files:**
- Git history and branch only.

**Interfaces:**
- REQUIRED SUB-SKILL: `superpowers:finishing-a-development-branch`.

- [ ] **Step 1: Confirm every implementation commit and worktree state**

Review `git log --oneline`, `git status`, untracked files, staged files, and branch divergence. Preserve unrelated user modifications.

- [ ] **Step 2: Present integration choices**

Use the finishing skill to offer merge, pull request, keep branch, or cleanup options based on the actual branch/worktree. Do not push or merge without Rudy's choice.
