# 最新部署与 TestFlight 状态（2026-09-13）

以下历史交接记录描述旧阶段；当前状态以本段和部署记录为准。用户已明确授权部署，正式服务器已完成更新。

- 当前维护工作树：`/Users/rudy2009/Documents/欧美团app/.worktrees/deploy-diagnostics-20260912`，分支 `codex/deploy-diagnostics-20260912`。
- 已部署源码：`913f05a0cf01bd31739690728e656df777af3710`，Node 24.21.0，全部 31 个迁移已应用。
- 原诊断工作树和 report-safety-system 工作树里的用户改动保持原样。
- 详细变更、备份、验证及限制：`docs/operations/verification/2026-09-12-diagnostic-deployment.md`。
- 后端、独立管理员网页、图片网关与旧 CDN 权限切换均已验证；安全 AI 预算仍为 0，自动处置关闭。
- iOS `1.0 (13)`（源码 `ecdb409`，含橙色主题 `185bcc1`）已通过签名真机 Archive，并于 2026-09-13 10:45 经 Xcode Organizer 上传成功。详见 `docs/operations/verification/2026-09-13-testflight-build-13.md`。
- 手机端下一步是在 TestFlight 确认 Apple 构建处理与现有测试组可安装状态；尚未提交正式 App Store 审核。继续维护前核对本工作树最新 Git 状态，不得把旧工作树直接覆盖服务器。
- 不要将旧服务直接接回新同步表；备份恢复前先停止全部写入。

---

# Codex Conversation Handoff

Status: `d31e34d` 最终独立代码质量复核与修复已完成；仍停留在总阶段 4，子任务 5 尚未开始
Generated: 2026-07-13 16:00 CST
Project root: `/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system`

## Resume Prompt

请先阅读 `/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system/CODEX_HANDOFF.md`，再用当前文件系统、Git 状态和计划文件复核。`d31e34d` 相对 `1fc72b4` 的最终 Standards / Spec 独立复核、TDD 修复和完整后端验证已在 `d8e2a30` 完成。只有收到 Rudy 明确的继续指令后，才从总阶段 4 子任务 5（iOS 内容操作模型、客户端与 Store）开始；不得提前进入总阶段 5。

## Objective And User Intent

项目是 iOS App「周边团」。当前目标是完整建设举报与安全审核系统：帖子、合集、评论、用户、私信均可举报；合集共享信息问题可以影响合集内帖子，单帖内容问题不连坐；被限制的团长可修改原内容并申请恢复，必须保留原 ID、互动和审核历史。后续管理员使用独立账号，并采用本设备批准新设备的访问方式；审核要高度自动化，但 AI 只提供分析和建议，人工最终控制高风险决定。

## Stage Status

总计划共有 8 个阶段，当前处于 **总阶段 4 / 8：内容修正与申诉**。

1. WebSocket P0 修复：完成。
2. 举报与安全案件后端核心：完成。
3. iOS 五类举报入口：完成。
4. 内容修正与申诉：进行中。
5. 独立管理员认证：未开始。
6. 管理员网页控制台：未开始。
7. 通义千问影子分析：未开始。
8. 加固、闸门与最终生产发布：未开始。

当前总阶段 4 共有 7 个子任务，已完成前 4 个：

1. 修正版本与申诉数据库结构：完成。
2. 不可变候选版本提交：完成。
3. 审核并原位发布修正内容：完成。
4. 团长内容操作、修正提交与申诉 API：完成；最终 Standards / Spec 独立复核无遗留 P1/P2。
5. iOS 内容操作模型、客户端与 Store：未开始。
6. iOS 内容修正与申诉界面：未开始。
7. 保留原 ID 的端到端验证：未开始。

计划复选框以以下文件为准：

- `docs/superpowers/plans/2026-07-10-report-safety-program.md`
- `docs/superpowers/plans/2026-07-10-04-content-remediation.md`

## Git State And Completed Commits

- Branch: `codex/report-safety-system`
- Latest implementation/review-fix commit: `d8e2a3046b332db64020768a7b5925d738094ebc`
- 本交接文件和计划勾选位于包含本文件的检查点提交中。

当前总阶段 4 已完成提交：

- `e42356fbb04e900b4ff6ddcd72c3380045846974` `Add content revision and appeal schema`
- `c0ecf5fce637f6a59a31607682bff032a91bbe94` `Add immutable content revision intake`
- `1fc72b4abdf1430a950c9181bcefb17fc802cc43` `Publish approved revisions in place`
- `d31e34dc56da5a4f21806d1fcb641c15daa21a4c` `Add owner correction and appeal APIs`
- `d8e2a3046b332db64020768a7b5925d738094ebc` `Fix owner remediation review findings`

此前举报系统关键提交：

- `54113f585b1f5e2cf9ccc795fae3a9bed9635e37` `Add PostgreSQL safety job worker`
- `f75b1fae4680bb34357858796f0ce08b58f4bdfe` `Record safety core deployment verification`
- `8a640c28005208ca1623180abdc0ba5ef30c61d7` `Add iOS safety report contracts`
- `ace382aba28304515cf1cd3768cd3ec8374e2c60` `Connect iOS safety report APIs`
- `ab6cba428d218b2b2a47ab79bf523868ad8270cb` `Build shared iOS report form`
- `e87abb2832271f16e46306f099f5cf5d8ee047f7` `Add five iOS report entry points`
- `2e02d1d4595e3b6830ed2608eb76618075a762e6` `Add My Reports status view`
- `c045faf5c0d34547274f0307c33471cbe44152a1` `Fix migrated safety fixture seed`

## Current Subtask Result

子任务 4 新增并接入：

- `GET /api/me/content-actions`
- `POST /api/content-actions/:caseId/revisions`
- `POST /api/content-actions/:caseId/appeal`

主要实现文件：

- `backend/src/safety/revisionRoutes.js`
- `backend/src/safety/contentActionMapper.js`
- `backend/src/safety/appealService.js`
- `backend/src/safety/reportRoutes.js`
- `backend/test/safety/revisionRoutes.integration.test.js`

已覆盖团长数据隔离、私有审核字段隐藏、当前状态约束、不可变修正版本、证据归属、七天申诉窗口、每次最终人工决定仅一次申诉、并发重复申诉以及提交后通知失败不回滚已提交事务。

最终独立复核另外发现并修复：

- 申诉案与同目标/类别的新开放案触发旧唯一索引冲突；新增 `016_appealed_case_aggregation.sql`，申诉案不再吸收后续新举报。
- 同一举报人的旧 pending 举报会阻塞申诉期间的新举报；进入申诉后旧 pending 举报会关闭，新举报进入独立案件。
- 整改提交原本没有滥用上限；新增 IP 日限、账号日限和账号分钟突发限制，稳定错误码为 `content_revision_rate_limited`。
- `GET /api/me/content-actions` 原本只返回前 100 项；现返回可选 `nextCursor`，用不可变创建时间和 ID 做微秒精度稳定分页。
- 016 down 若存在旧应用无法安全表示的多案件状态会拒绝回滚，并在事务内保留迁移、索引和案件；无冲突时才恢复旧约束。

## Verification

### Full PostgreSQL Database Suite

使用正确的 PostgreSQL 16 工具目录执行：

```sh
cd /Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system/backend
PG_BINDIR=/usr/local/opt/postgresql@16/bin ZBT_TEST_PG_PORT=55432 npm run test:db
```

最终结果：`173/173` 通过，退出码 `0`，耗时约 `119.1s`。该结果是在安全 down 闸门最后修改后重新完整执行所得。

### Backend Focused And Unit Suites

- 团长修正/申诉路由与迁移聚焦集成测试：`24/24` 通过（路由 `21`、迁移 `3`）。
- 后端非数据库单元测试：`64/64` 通过。
- 最新数据库完整测试：`173/173` 通过。
- `git diff --check` 与修改过的 Node 源文件语法检查通过。

### Clean iOS XCTest

在 iPhone 17 Pro 模拟器 `272C2D53-9725-410F-A712-EADB3677EDA2` 上先执行 shutdown、erase、boot，并使用全新 DerivedData：

```sh
xcodebuild test \
  -project ZhouBianTuan.xcodeproj \
  -scheme ZhouBianTuan \
  -configuration Debug \
  -destination 'platform=iOS Simulator,id=272C2D53-9725-410F-A712-EADB3677EDA2' \
  -derivedDataPath /tmp/zbt-xctest-derived \
  -resultBundlePath /tmp/zbt-xctest-result.xcresult \
  CODE_SIGNING_ALLOWED=NO
```

结果：`** TEST SUCCEEDED **`；XCTest 总计 `84`，通过 `84`，失败 `0`，跳过 `0`。结果包位于 `/tmp/zbt-xctest-result.xcresult`。

唯一已知警告是 `ZhouBianTuan/PostDetailViews.swift:1098` 使用已弃用的 `NavigationLink` 初始化器，不影响本次测试结果。

### Environment Cleanup

- 每次验证使用的临时 PostgreSQL 16 集群均由测试 trap 停止并删除。
- 已复核 PostgreSQL 进程及端口 `55432`，没有本轮临时测试集群仍在运行。
- XCTest 完成后已关闭测试模拟器。
- 当前没有为本阶段启动的临时开发服务器。
- 本检查点没有部署总阶段 4 的修正/申诉实现到生产环境。

## Key Decisions And Constraints

- 修正内容原位更新，保留帖子/合集原 ID、作者、互动、举报和审核历史。
- 合集共享字段错误可以影响合集与子帖；单帖内容问题不自动连坐合集。
- 申诉绑定最近一次仍生效的人工最终动作；每个最终动作最多一次申诉，动作生效时间起七天内（含边界）可提交。
- 申诉后设置 `manual_hold=true`，AI 不自动裁决申诉，也不直接恢复内容。
- 团长接口不得暴露举报人、管理员内部备注、AI 原始分析或其他用户隐私。
- 修正版本发布和自动恢复必须遵守人工动作、其他开放案件与 `manual_hold` 边界。
- 管理员认证、管理网页和 Qwen 分析分别属于后续总阶段，不在本检查点启动。
- 不把 API Key、密码、Token、SSH 私钥或管理员凭据写入代码、提交或交接文件。

## Review State And Risks

- 子任务 3 已通过规格与代码质量复核。
- 子任务 4 已完成最终独立 Standards / Spec 复核。初轮与修复复核发现的问题均按最小 TDD 循环解决；最后两路复核均回复 `no findings`。
- 申诉窗口仍按最近人工最终动作的 `applied_at` 计算。动作与团长同步事件在同一事务产生，当前数据模型没有独立 `notified_at`；阶段 4 计划也明确使用 decision age。
- 申诉提交目前只创建团长的同步事件，符合阶段 4 子任务 4 的 owner sync 约定；是否同时变更举报人的公开案件状态应在后续产品规格明确后另行处理。
- 016 down 是安全闸门：若生产数据已存在旧约束无法表达的多案件组合，应用/迁移不能回滚到不兼容版本，必须先采用兼容代码或显式数据迁移，不能删除或改写案件来强行回滚。
- iOS 尚无内容操作客户端、修正表单和申诉界面，因此用户端流程尚未完整。
- 保留原 ID 和互动的完整 iOS 到后端端到端流程尚未验证。
- 总阶段 4 代码尚未部署到生产环境。

## Unfinished Work

- 总阶段 4 子任务 5：iOS 内容操作模型、客户端与 Store。
- 总阶段 4 子任务 6：iOS 内容修正、重新发布与申诉 UI。
- 总阶段 4 子任务 7：原 ID、互动保留、恢复边界的端到端验证及阶段复核。
- 总阶段 5：独立管理员账号与本设备批准新设备。
- 总阶段 6：管理员网页控制台。
- 总阶段 7：通义千问影子分析与自动化策略。
- 总阶段 8：加固、功能闸门、生产发布与回滚验证。

## Exact Next Action

收到 Rudy 明确的继续指令后：

1. 复核工作区、Git 与两个计划文件，确认本 handoff 未过期。
2. 在总阶段 4 内开始子任务 5，先为 `SafetyContentAction`、修正草稿与申诉 payload 写失败的 Codable 测试。
3. iOS 客户端读取 `GET /api/me/content-actions` 时必须持续跟随可选 `nextCursor`，直到游标不存在，不能只取第一页。
4. 完成子任务 5 的测试与检查点提交后再进入总阶段 4 子任务 6；总阶段 4 完成前不得进入总阶段 5。

## Important Paths

- Worktree: `/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system`
- Handoff: `/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system/CODEX_HANDOFF.md`
- Master plan: `/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system/docs/superpowers/plans/2026-07-10-report-safety-program.md`
- Current phase plan: `/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system/docs/superpowers/plans/2026-07-10-04-content-remediation.md`
- Backend: `/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system/backend`
- iOS project: `/Users/rudy2009/Documents/欧美团app/.worktrees/report-safety-system/ZhouBianTuan.xcodeproj`
