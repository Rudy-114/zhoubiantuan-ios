# Report Safety Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved report and safety-case system end to end, including the WebSocket P0, five iOS report targets, owner remediation, isolated admin authentication and web console, Qwen shadow analysis, policy-gated automation, production rollout, and rollback controls.

**Architecture:** Keep one Node/Express/PostgreSQL deployable while introducing focused `safety` and `admin` modules. Reports are immutable clues aggregated into safety cases; PostgreSQL jobs drive external analysis; deterministic policy code owns actions; iOS and the admin web consume separate APIs. Execute the eight phase plans in order because each phase publishes interfaces required by the next.

**Tech Stack:** Node.js 20 production runtime, Express 4, PostgreSQL 16, `pg`, `ws`, SwiftUI/iOS 17, Swift Package tests, WebCrypto P-256, static ES modules, Playwright CLI, Aliyun Content Safety, DashScope OpenAI-compatible Chat Completions, Qwen `qwen3.7-plus-2026-05-26`.

## Global Constraints

- Preserve the current public API and additive-migration compatibility while feature flags are off.
- Keep `CODEX_HANDOFF.md` uncommitted unless Rudy separately requests a handoff update.
- Never write API keys, passwords, recovery codes, private-message bodies, test tokens, or private SSH values to Git, command arguments, screenshots, fixtures, or ordinary logs.
- `SAFETY_AI_MONTHLY_BUDGET_CNY` defaults to `0`; no paid model call occurs without a separate explicit spend confirmation at Phase 7.
- Qwen is fixed to `qwen3.7-plus-2026-05-26`, non-thinking mode, JSON Mode, with no tools, network, or database access granted to the model.
- Worker concurrency is `2`; the existing PostgreSQL pool remains at its current default until measurements justify a change.
- Automatic actions are reversible content actions only. Account restriction, permanent removal, appeals, and reversal of a manual decision remain human-only.
- A post-content case never expands to a collection solely because the model recommends it.
- A collection restriction changes effective visibility without marking each child post as independently violating.
- Private-message evidence is the selected message plus at most three messages before and three after.
- Raw private-message evidence is cleared 180 days after case closure; de-identified action and audit metadata is retained for two years.
- Admin sessions use `HttpOnly; Secure; SameSite=Strict`, 30-minute idle expiry, eight-hour absolute expiry, CSRF protection, and an approved P-256 device key.
- All manual edits use `apply_patch`; each implementation task follows red, green, refactor and ends with a focused commit.
- Before every production migration, Nginx reload, service restart, admin bootstrap, or paid AI call, state the exact impact and rollback command in a commentary checkpoint.
- Do not enable `SAFETY_AI_MODE=enforce` until the server-side gate proves: 100 valid fixtures, at least 95% precision for auto-hide categories, 30 human-compared real cases, zero scope-expansion errors, and zero automated account actions.
- At execution start, invoke `superpowers:using-git-worktrees` and create an isolated `codex/` feature worktree from the actual current branch/checkpoint; never assume the default branch name.

---

## Planned File Structure

```text
backend/src/safety/
  constants.js                 closed target/reason/action enums
  reportValidation.js          report request bounds and field validation
  subjectResolver.js           server-owned source-to-subject mapping
  evidenceService.js           immutable target and message-context snapshots
  caseService.js               report idempotency and case aggregation
  reportRoutes.js              consumer safety endpoints and rate limits
  actionService.js             reversible/manual action application and rollback
  visibility.js                effective visibility predicates
  revisionValidation.js        post/collection candidate normalization
  revisionService.js           revision review and same-ID publishing
  revisionRoutes.js            owner correction and appeal endpoints
  appealService.js             one-appeal-per-decision rules
  jobQueue.js                  PostgreSQL enqueue/claim/retry primitives
  jobWorker.js                 two-concurrency handler loop
  maintenanceService.js        deadlines, retention, and de-identification
  promptBuilder.js             minimized untrusted Qwen packet
  budgetService.js             atomic monthly AI reservations
  policyEngine.js              deterministic allowlisted recommendations
  aiService.js                 hard-signal/Qwen orchestration
  enforcementGate.js           non-bypassable fixture/real-case gate
  providers/                   Qwen and fixture providers
  schemas/                     Ajv result schema
  fixtures/                    100 production-readable policy fixtures

backend/src/admin/
  crypto.js                    P-256 canonical payload and verification
  challengeService.js          one-use signed challenges
  sessionService.js            hashed sessions and expiry
  adminMiddleware.js           admin session and CSRF boundaries
  deviceService.js             root enrollment, approval, and recovery
  auditService.js              append-only admin audit
  authRoutes.js                isolated admin authentication API
  caseService.js               queue/detail/evidence/decision queries
  caseRoutes.js                safety admin API
  moderationRoutes.js          pre-publication review under admin auth
  aiHealthService.js           budget, queue, comparison, and gate metrics
  webRoutes.js                 static hosting and strict CSP

backend/admin-web/
  index.html                   semantic shell
  styles.css                   restrained responsive operations system
  deviceKeys.js                non-exportable IndexedDB P-256 key
  api.js                       same-origin CSRF client
  authViews.js                 login/enrollment/recovery
  deviceViews.js               approvals and revocation
  workspace.js                 navigation and workload state
  caseViews.js                 queue, inspector, evidence, decisions
  moderationViews.js           publication review
  auditViews.js                audit and user-risk views
  aiViews.js                   shadow quality and budget health

ZhouBianTuan/
  RealtimePolicy.swift         pure connection and fallback policy
  SafetyModels.swift           Codable safety contracts
  ReportViews.swift            shared five-target report form
  MyReportsView.swift          reporter status and evidence supplements
  ContentRemediationViews.swift owner correction and appeal workflow

ops/nginx/zbt-backend.conf      audited WebSocket proxy configuration
docs/operations/               deployment, rollback, recovery, and release checks
```

## Stable Cross-Phase Interfaces

The plans below use these names consistently:

```text
POST /api/reports
POST /api/reports/:reportId/evidence
GET  /api/me/reports
GET  /api/me/content-actions
POST /api/content-actions/:caseId/revisions
POST /api/content-actions/:caseId/appeal

POST /admin/api/auth/challenges
POST /admin/api/auth/device-requests
GET  /admin/api/auth/device-requests
GET  /admin/api/auth/devices
GET  /admin/api/auth/session
POST /admin/api/auth/login
POST /admin/api/auth/device-requests/:requestId/approve
POST /admin/api/auth/device-requests/:requestId/reject
POST /admin/api/auth/recover
POST /admin/api/auth/logout

GET  /admin/api/cases
GET  /admin/api/cases/:caseId
POST /admin/api/cases/:caseId/decision
POST /admin/api/cases/:caseId/request-correction
POST /admin/api/cases/:caseId/restore
POST /admin/api/cases/:caseId/restrict-user
GET  /admin/api/audit-events
GET  /admin/api/ai-health
```

```js
submitReport(client, { reporterId, clientRequestId, sourceType, sourceId, reasonCode, reportedField, detail, objectKeys })
captureSourceEvidence(client, { reporterId, sourceType, sourceId })
applySafetyAction(client, { caseId, actionType, targetType, targetId, actorType, actorId, reason, idempotencyKey })
rollbackSafetyAction(client, { actionId, actorType, actorId, reason })
enqueueSafetyJob(client, { type, caseId, uniqueKey, payload, runAt })
submitContentRevision(client, { caseId, ownerId, snapshot, objectKeys })
submitAppeal(client, { caseId, ownerId, detail, objectKeys })
```

```swift
SafetyReportDraft
SafetyReport
SafetyContentAction
SafetyTargetType
SafetyReasonCode
SafetyReportedField
RealtimeFallbackPolicy
RealtimeConnectionState
```

## Execution Order

### Task 1: Complete WebSocket P0

**Plan:** `docs/superpowers/plans/2026-07-10-01-realtime-p0.md`

- [x] Execute every checkbox in the P0 plan.
- [x] Verify the public WebSocket handshake, HTTPS health, and privacy-policy route after the Nginx reload.
- [x] Record the P0 commit and production verification before starting database work.

### Task 2: Build the Safety-Case Backend Core

**Plan:** `docs/superpowers/plans/2026-07-10-02-safety-core-backend.md`

- [x] Execute the additive migration, report intake, evidence, case aggregation, action, visibility, and job-queue tasks.
- [x] Deploy with `SAFETY_CASES_ENABLED=false` and `SAFETY_AI_MODE=off` before any client uses the new endpoints.

### Task 3: Add the Five iOS Reporting Workflows

**Plan:** `docs/superpowers/plans/2026-07-10-03-ios-reporting.md`

- [x] Add shared models, networking, report form, five entry points, optional block flow, and My Reports.
- [x] Pass `swift test`, Xcode Debug build, and simulator layout checks.

### Task 4: Add Owner Remediation and Appeals

**Plan:** `docs/superpowers/plans/2026-07-10-04-content-remediation.md`

- [x] Add immutable revisions, original-ID publishing, automatic restoration boundaries, content-action UI, and one human appeal.
- [x] Prove likes, comments, favorites, and child-post states survive correction.

### Task 5: Add Isolated Admin Authentication

**Plan:** `docs/superpowers/plans/2026-07-10-05-admin-auth.md`

- [x] Add separate admin tables, hidden password bootstrap, P-256 device challenges, sessions, CSRF, approvals, recovery, and audit.
- [x] Do not create the real administrator account until the Phase 6 browser UI is deployed.

### Task 6: Build and Deploy the Admin Web Console

**Plan:** `docs/superpowers/plans/2026-07-10-06-admin-web.md`

- [x] Add authenticated case APIs, queue/detail/action views, device management, audit, and Playwright coverage.
- [x] Initialize the real admin account and enroll this device as root without exposing credentials or recovery codes in chat.

### Task 7: Add Qwen Shadow Analysis

**Plan:** `docs/superpowers/plans/2026-07-10-07-ai-shadow-mode.md`

- [ ] Add schema validation, prompt minimization, budget reservation, deterministic policy tests, fixtures, AI health, and shadow comparisons.
- [ ] Keep the budget at zero until Rudy explicitly approves the single paid validation call.

### Task 8: Harden, Gate, and Finish Production Rollout

**Plan:** `docs/superpowers/plans/2026-07-10-08-enforcement-deployment.md`

- [ ] Add retention, cleanup, enforcement gate, end-to-end tests, runbook, production smoke, and rollback drills.
- [ ] Leave production in `shadow` until 30 real cases and every gate condition are satisfied; the completed feature includes the gate, not fabricated evidence.

## Specification Coverage

| Design sections | Owning plan tasks |
|---|---|
| 1-6 decisions, goals, terms, architecture | Program constraints/structure; Phase 2 Tasks 2-7 |
| 7 targets/reasons/scope | Phase 2 Task 3; Phase 3 Tasks 1-4 |
| 8 intake/dedup/abuse | Phase 2 Task 5; Phase 8 Task 3 |
| 9 message evidence/protection | Phase 2 Task 4; Phase 3 Tasks 2-4; Phase 8 Task 1 |
| 10 collection cascade/contact policy | Phase 2 Tasks 3 and 6; Phase 7 Task 6; Phase 8 Tasks 1 and 4 |
| 11 remediation/restoration/appeal | Phase 4 Tasks 1-7; Phase 6 Task 1 |
| 12 case/user-visible states | Phase 2 Tasks 2 and 5; Phase 3 Task 5 |
| 13 data model | Phase 2 Task 2; Phase 4 Task 1; Phase 5 Task 1; Phase 7 Task 1 |
| 14 AI/provider/injection/budget/shadow | Phase 7 Tasks 1-9 |
| 15 policy/automatic boundaries | Phase 2 Task 6; Phase 7 Task 6; Phase 8 Task 2 |
| 16 admin identity/device trust | Phase 5 Tasks 1-6; Phase 6 Tasks 3 and 6 |
| 17 admin web | Phase 6 Tasks 1-7; Phase 7 Task 8 |
| 18 iOS UX/notifications | Phase 3 Tasks 1-6; Phase 4 Tasks 5-6 |
| 19 API outline | Stable interfaces; Phases 2, 4, 5, and 6 route tasks |
| 20 WebSocket P0 | Phase 1 Tasks 1-4 |
| 21 errors/retries/concurrency | Phase 2 Tasks 5-7; Phase 5 Tasks 2-5; Phase 7 Tasks 4-7 |
| 22 privacy/retention/audit | Phase 2 Task 4; Phase 5 Tasks 2-5; Phase 8 Task 1 |
| 23 testing | Every phase; Phase 8 Tasks 4 and 7 |
| 24 release/rollback | Phase 1 Task 4; deployment tasks in Phases 2, 5, 6, 7, and 8 |
| 25 acceptance criteria | Phase 8 Tasks 4, 7, and 8 |
| 26 staged implementation | Program Tasks 1-8 |

## Program Verification

Run after all implementation tasks that can be completed without waiting for real-case evidence:

```bash
npm --prefix backend test
npm --prefix backend run test:db
swift test --package-path .
xcodebuild -project ZhouBianTuan.xcodeproj -scheme ZhouBianTuan -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO build
git diff --check
```

Expected results:

```text
All Node unit tests pass.
All PostgreSQL integration tests pass against the temporary local database.
All Playwright CLI admin flows pass at desktop and narrow widths.
All Swift package tests pass.
Xcode reports BUILD SUCCEEDED.
git diff --check prints no output.
```

Production smoke is intentionally separate because it uses private credentials and mutable infrastructure:

```bash
set -a
source .project-secrets/backend.env
set +a
curl -fsS https://api.zhoubiantuanmail.top/api/health
curl -fsSI https://api.zhoubiantuanmail.top/privacy-policy
WS_TEST_TOKEN="$WS_TEST_TOKEN" node backend/scripts/verify-websocket.mjs wss://api.zhoubiantuanmail.top/api/ws
```
