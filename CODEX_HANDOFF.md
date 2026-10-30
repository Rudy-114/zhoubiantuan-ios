# Codex Conversation Handoff

Status: Ready for a new thread
Generated: 2026-07-18 21:55 CST
Project root: `/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system`

## Resume Prompt

请完整阅读本文件，然后以当前文件系统、Git、App Store Connect 和生产只读状态为准复核后继续。先核对分支 `codex/report-safety-system`、HEAD `eec4b68`、仅 `CODEX_HANDOFF.md` 未暂存，以及 TestFlight 1.0 (11) 的真实状态。若 App Store Connect 登录已过期，请让 Rudy 登录后再检查；不要猜测 Build 11 已完成。Build 可测试后，协助 Rudy 在 iPhone TestFlight 安装并完成实机验收；根据结果决定修复并发 Build 12，或开始 App Store 正式上线资料准备。不要 reset/checkout/clean、合并、push、启用 enforce、重建已取消的 shadow canary、处理或输出秘密，也不要未经明确确认提交 App Store 审核。

## Objective And User Intent

完成周边团举报安全系统的八阶段实现与安全生产部署，让 App 在生产保持可用但默认安全；随后生成包含本轮大改的 TestFlight 构建供 Rudy 在手机上实际测试，测试结束后准备正式提交 App Store。

Rudy 已接受最新版 Apple Developer Program License Agreement。当前产品优先级是确认 TestFlight Build 11、完成手机实测，再进入 App Store 上线准备；30 个真实安全案件的 shadow 对比只能在 App 有真实流量后逐步积累，不得伪造。

## Current State

### Git And Worktree

- Worktree: `/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system`
- Branch: `codex/report-safety-system`
- HEAD: `eec4b68fbe55848db2cf13939793e51b1ca25c05` — `Isolate iOS tests from host keychain`
- `main`: `0e9b02cc2d6ab893236b5174594d3fb1752e0e67`
- Branch is 92 commits ahead and 0 behind `main`; merge base is `0e9b02c`.
- Rudy chose to retain this feature branch/worktree. No merge, push, pull request, or cleanup was performed.
- Current Git state: only `CODEX_HANDOFF.md` is modified and unstaged; no staged or untracked files.
- `git diff --check` passed immediately before this handoff.

### Safety Program

- Stages 1–6 are complete and deployed: WebSocket P0, safety-case backend, five iOS report flows, owner remediation/appeal, isolated admin authentication, and admin Web console.
- Stage 7 implementation Tasks 1–8 are complete. Task 9 Steps 1–5 and 7 are complete; Step 6, real shadow comparisons, remains pending. The master Stage 7 checkbox therefore remains intentionally unchecked.
- Stage 8 Tasks 1–7 are complete, independently reviewed, and locally verified. Task 8 production rollout Steps 1–5 are complete, including rollback drill. Task 8 Step 6 (first 30 real cases) and Step 7 (later enforce activation) remain pending. Task 9 branch-retention steps are complete. The master Stage 8 checkbox remains intentionally unchecked because operational evidence has not matured.
- There is no documented Stage 9 in the report-safety program. The next separate product stream is TestFlight acceptance and App Store release preparation.

### Production Safety State

- Last deployed reviewed backend release: `04af0c913cb37fb18bf68758cac06626bd150d39`.
- Migration `018_safety_ai_retry_runs.sql` is applied; migrations are additive.
- Last verified flags after the canary cancellation: safety cases enabled, `shadow`, automatic actions disabled, monthly AI service budget `0`, admin web enabled, enforcement gate closed.
- Last verified service after cancel cleanup: `zbt-backend.service` active, public health/feed/privacy/admin returned HTTP 200, unauthenticated admin API returned 401, and no real reports/runs/actions remained. The recorded post-cancel PID was 342409; treat the PID as historical and re-read it before relying on it.
- Cumulative settled synthetic Qwen validation spend is CNY 0.006918. Prompt-v2 closed-schema validation passed. No synthetic or budget-blocked result counts toward the 30 real comparisons.
- Rudy previously authorized Qwen calls up to a cumulative CNY 1 ceiling, but the recurring real-shadow canary was later explicitly canceled. Do not recreate the canary or raise the production budget without a new, current instruction. Keep budget at zero by default.
- The Codex `shadow-canary` heartbeat was deleted and the server `zbt-real-shadow-canary-stop.timer` was stopped/canceled. Current local inspection found no Codex automation definitions. Do not recreate either.
- Stage 8's normal product maintenance jobs for deadlines/retention are separate from the canceled canary: they enqueue idempotent PostgreSQL jobs at startup/hourly and are part of the deployed backend.

### TestFlight Build 11

- App version/build: `1.0 (11)`.
- Bundle identifier: `com.panpanpan.zhoubiantuan`.
- Minimum iOS: 17.0; production API endpoint is embedded in the Release build.
- Build-number commit: `7fae5ec` — `Prepare TestFlight build 11`.
- Test-isolation commit: `eec4b68` — prevents iOS tests from reading the host login keychain.
- Archive: `/Users/rudy2009/Documents/欧美团app/build/TestFlight/ZhouBianTuan-1.0-11.xcarchive`
- Upload options: `/Users/rudy2009/Documents/欧美团app/build/TestFlight/ExportOptionsUpload.plist`
- `xcodebuild -exportArchive ... -allowProvisioningUpdates` reported `Upload succeeded` and `** EXPORT SUCCEEDED **` on 2026-07-16 after the Apple agreement was accepted.
- App Store Connect initially showed Build 11 as `正在处理` with upload time 2026-07-16 22:51 CST.
- On 2026-07-18, the open page still displayed `正在处理`, but refreshing redirected to Apple sign-in because the session had expired. Therefore the current server-side Build 11 state is **not verified**; the pre-refresh display may have been stale. The Chrome tab is now at the sign-in page.

## Completed Work

### Report And Safety System

- Implemented immutable reports/evidence, case aggregation, correction, appeal, action rollback, retention, abuse hardening, independent reporter counting, isolated admin auth, signed device approval, CSRF, audit, AI health, human AI comparisons, budget reservation, strict Qwen schema, deterministic policy, retry/recovery fencing, and a non-bypassable enforcement gate.
- Added complete local end-to-end harnesses for consumer, worker, admin device, decision, correction, appeal, realtime, and cleanup flows.
- Added operations runbook and release checklist.
- Deployed Stage 8 release `04af0c9`, applied migration 018, ran public/authenticated/WebSocket/admin smoke, performed human no-action plus temporary hide/restore rollback drill, and exact-count cleanup.
- Kept production in shadow with actions disabled and budget zero.

### iOS/TestFlight

- Incremented the app to Build 11 without changing marketing version 1.0.
- Isolated reporting quality tests from host keychain state.
- Produced and validated the distribution archive, including privacy manifest and dSYM.
- Uploaded Build 11 successfully to App Store Connect.
- Direct Xcode installation to the connected physical phone is blocked because the phone's iOS 26.5.2 device support is newer than local Xcode 26.3; TestFlight distribution is unaffected.

## Files Changed

All source, test, migration, operations, plan, and production-verification changes are committed through `eec4b68`.

Latest commits:

- `eec4b68 Isolate iOS tests from host keychain`
- `7fae5ec Prepare TestFlight build 11`
- `dbf8e3d Record retained Stage 8 branch`
- `bd0029f Record Stage 8 branch audit`
- `6a38ea9 Record Stage 8 production rollout`
- `04af0c9 Record Stage 8 Task 7 verification`
- `30b9775 Fix admin verification edge cases`
- `fdf8beb Record Stage 8 Task 6 review`

Current uncommitted file:

- `/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system/CODEX_HANDOFF.md` — this handoff only; intentionally unstaged and uncommitted.

External build artifact, not in Git:

- `/Users/rudy2009/Documents/欧美团app/build/TestFlight/ZhouBianTuan-1.0-11.xcarchive`

## Verification

Latest recorded full Stage 8 local verification:

- `npm --prefix backend test` — 164/164 passed.
- PostgreSQL 16 regression — 251/251 passed; disposable cluster/process/port cleaned.
- `swift test` — 27/27 passed.
- Xcode iPhone 17 Pro Debug simulator build — `BUILD SUCCEEDED`.
- Real browser admin QA at desktop and 390x844 — passed across login, queue, evidence, decisions, correction, appeal, AI comparison/health, audit, device approval/revocation, errors, keyboard, reduced motion, and overflow.
- Two-simulator iOS remediation/appeal QA — passed.
- Final independent Standards and Spec reviews — no P1/P2 findings.
- Secret/privacy scan — no real secrets or private keys found.

Latest Build 11 verification after the final iOS test-isolation commit:

- Swift Package tests — 27/27 passed.
- Xcode simulator tests — 95/95 passed.
- Release archive/export validation — passed; production bundle metadata, privacy manifest, dSYM, and absence of debug markers checked.
- App Store upload — succeeded.

Not rerun for this handoff because source files did not change:

- Node/PostgreSQL/Swift/Xcode/browser suites. This handoff only changes Markdown.

Fresh handoff checks on 2026-07-18:

- `git status --short --branch` — only `CODEX_HANDOFF.md` modified.
- `git diff --check` — passed.
- No local worktree backend, PostgreSQL, Xcode build/test, Playwright, lifecycle, or canary process found.
- No relevant listeners found on 60671, 5432, 3000, 3001, 4173, or 8080.
- App Store Connect refresh required a new login; current Build 11 state was not verified.

## Running Services And Environment

- No local service or test process for this worktree is running.
- No temporary PostgreSQL cluster or lifecycle listener is running.
- No active Codex recurring automation was found.
- Production backend was last verified active after canary cancellation; re-check before any production claim or mutation.
- Production database backup from the Stage 8 rollout is in the ignored private path `.project-secrets/backups/zbt-before-stage8-20260716-200847.dump`, mode 600, with `pg_restore --list` previously passed. Never add it to Git.
- Production rollback points recorded in the rollout document:
  - `/opt/zbt-backend.stage8-task8-backup-20260716-200847`
  - `/opt/zbt-backend.stage8-task8-replaced-20260716-200847`
  - `/etc/nginx/zbt-backend.stage8-task8-backup-20260716-200847`
- Existing production connection material lives under ignored `.project-secrets/`; never print, copy into documentation, stage, or commit it.

## Key Decisions And Constraints

- Preserve all user changes. Do not use `git reset`, `checkout`, or `clean`.
- Keep `codex/report-safety-system` and this worktree; do not merge or push without a new explicit instruction.
- Do not display or record passwords, recovery codes, API keys, cookies, private keys, production secrets, private-message bodies, or raw model responses.
- Production stays `shadow`, automatic actions false, budget zero, and enforce closed until 30 real current-version human comparisons and every server gate condition pass.
- Enabling enforce/automatic actions, a new production deployment/restart/migration, a new recurring canary, and App Store review submission are distinct high-impact actions requiring current explicit authorization.
- Do not repeat the already completed prompt-v2 synthetic validation tuple merely to spend or re-prove it.
- Do not count synthetic, failed, invalid, or budget-blocked runs as real comparisons.
- TestFlight acceptance comes before App Store submission. Do not submit the app for review until Rudy finishes phone testing and explicitly approves submission.

## Unfinished Work

1. Re-authenticate App Store Connect and determine the true Build 11 state. The last fresh authenticated server result is unavailable; do not treat the stale `正在处理` row as current truth.
2. If Build 11 is processed, verify it is available to the intended internal tester/group, then have Rudy install it from TestFlight on the iPhone.
3. Run a focused phone acceptance pass: authentication, feed/realtime, all five report entry points, optional block, My Reports, owner correction/republication, appeal, notifications, and regression smoke. Record device/iOS/build and outcomes without personal data.
4. If defects are found, fix test-first, run focused/full verification, increment to Build 12, archive, and request upload authorization if needed. Apple will not accept another upload with build number 11.
5. After phone acceptance, prepare the App Store release package: screenshots, description, keywords, support/marketing URLs, privacy answers, age rating, review contact/login instructions, release mode, build selection, and final checklist. Do not click final review submission without explicit approval.
6. Once real users/cases exist, collect the first 30 human AI comparisons under shadow. Keep automatic actions off; any scope-expansion error resets/revises the gate evidence.
7. Only after all gate metrics pass, present the metrics and reversible action categories for a separate enforce authorization.

## Risks And Known Issues

- Build 11 appeared to remain in processing for roughly two days, but the July 18 refresh exposed an expired session, so the visible state may have been stale. If it is genuinely still processing after sign-in, inspect the App Store Connect upload log/status and Apple notices before deciding whether to upload a new build number.
- The physical phone cannot currently be installed from local Xcode due to device-support mismatch; use TestFlight or update the local Xcode/device-support toolchain separately.
- The App is not publicly launched, so there is no legitimate source for 30 real-case comparisons yet. Stage 7 Step 6 and Stage 8 Task 8 Step 6 must remain pending.
- Enforcement is intentionally closed and untested on real user traffic.
- Production PIDs and external authentication sessions are ephemeral; re-read them rather than trusting this document.
- `CODEX_HANDOFF.md` is intentionally dirty. Do not accidentally include it in a source commit unless Rudy explicitly requests that.

## Next Actions

1. Run `git status --short --branch`, confirm HEAD `eec4b68`, and read the two phase plans plus the Stage 8 rollout record.
2. Ask Rudy to log into App Store Connect if the session is still expired, then perform a read-only status check for TestFlight 1.0 (11).
3. If Build 11 is ready, confirm internal availability and guide Rudy through TestFlight installation and the phone acceptance checklist.
4. Route from the phone result: defects -> Build 12; acceptance -> App Store release preparation.
5. Leave production safety flags and canceled canary unchanged unless Rudy separately authorizes a new production action.

## Important Commands And Paths

```bash
cd '/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system'
git status --short --branch
git log --oneline -n 20
git diff --check
rg -n '^## |^### |^- \[[ xX]\]' \
  docs/superpowers/plans/2026-07-10-07-ai-shadow-mode.md \
  docs/superpowers/plans/2026-07-10-08-enforcement-deployment.md \
  docs/superpowers/plans/2026-07-10-report-safety-program.md
```

- Master plan: `/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system/docs/superpowers/plans/2026-07-10-report-safety-program.md`
- Stage 7 plan: `/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system/docs/superpowers/plans/2026-07-10-07-ai-shadow-mode.md`
- Stage 8 plan: `/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system/docs/superpowers/plans/2026-07-10-08-enforcement-deployment.md`
- Stage 8 local verification: `/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system/docs/operations/verification/2026-07-16-stage8-local-verification.md`
- Stage 8 production rollout: `/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system/docs/operations/verification/2026-07-16-stage8-production-rollout.md`
- Safety operations runbook: `/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system/docs/operations/safety-system.md`
- Release checklist: `/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system/docs/operations/verification/safety-release-checklist.md`
- iOS project: `/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system/ZhouBianTuan.xcodeproj`
- Backend: `/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system/backend`
- Build 11 archive: `/Users/rudy2009/Documents/欧美团app/build/TestFlight/ZhouBianTuan-1.0-11.xcarchive`
