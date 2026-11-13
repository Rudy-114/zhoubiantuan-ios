# 周边团 (ZhouBianTuan) - Claude Code 项目配置

## 项目概述

欧美/二次元周边团购 iOS App。用户创建拼团合集、发布拼团帖子、私信沟通、点赞收藏关注。

## 技术栈

- **iOS:** SwiftUI, Xcode 工程 `ZhouBianTuan.xcodeproj`
- **Bundle ID:** `com.panpanpan.zhoubiantuan`
- **后端:** Node.js / Express / PostgreSQL / 阿里云 OSS / 阿里云内容安全
- **线上 API:** `https://api.zhoubiantuanmail.top/api`
- **Debug:** `http://127.0.0.1:18080/api`
- **分支:** `main`（2026-11-13 已快进到发布版本）。修复方案在 `claude/fix-plan-20261112`，与生产线的合并在 `claude/merge-prod-20261112`；修复前的回滚点是 `backup/pre-fix-plan-20261112`

## 关键路径

### iOS 源码
```
ZhouBianTuan/ZhouBianTuanApp.swift     - App 入口 + RootView + 启动链路
ZhouBianTuan/MockAppStore.swift        - 全局状态管理 + 后端交互（ID 索引查找）
ZhouBianTuan/ContentPaging.swift       - 分页状态、/feed 与内容页加载
ZhouBianTuan/BackendClient.swift       - API 客户端 + 数据模型映射
ZhouBianTuan/Models.swift              - 本地数据模型（含 AppearanceMode、Toast）
ZhouBianTuan/ImagePipeline.swift       - 图片内存缓存、降采样、后台解码
ZhouBianTuan/OfflineFeedCache.swift    - 离线信息流快照
ZhouBianTuan/MessageCache.swift / MessageMerging.swift - 私信缓存与合并
ZhouBianTuan/PostDraftStore.swift      - 发帖草稿
ZhouBianTuan/FeedEvents.swift          - 曝光/互动事件上报
ZhouBianTuan/KeychainStore.swift       - 令牌存储
ZhouBianTuan/HomeViews.swift           - 首页（跟团/拼谷分页）
ZhouBianTuan/CommonComponents.swift    - 通用 UI 组件、Toast、触感
ZhouBianTuan/CreatePostViews.swift     - 发帖
ZhouBianTuan/PostDetailViews.swift     - 帖子详情
ZhouBianTuan/ProfileViews.swift        - 个人主页
ZhouBianTuan/MessageViews.swift        - 私信
ZhouBianTuan/SearchViews.swift         - 搜索
ZhouBianTuan/MarketViews.swift         - 关注/市场
ZhouBianTuan/SettingsViews.swift       - 设置（外观、改密、删号）
ZhouBianTuan/AuthViews.swift           - 登录注册、找回密码
ZhouBianTuan/AdminViews.swift / AdminModerationView.swift / Moderation*.swift - 举报与审核
ZhouBianTuan/Theme.swift               - 主题色、AppFont 字体、Radius 圆角、动效
ZhouBianTuanTests/                     - 单元测试
```

### 后端源码
```
backend/src/server.js       - HTTP 服务入口
backend/src/app.js          - Express 应用配置
backend/src/routes.js       - API 路由（限流在 createRouter 内配置）
backend/src/auth.js         - JWT（含令牌版本）+ bcrypt
backend/src/config.js       - 环境变量配置（默认读取 .project-secrets/backend.env）
backend/src/db.js           - PostgreSQL 连接池
backend/src/oss.js / uploads.js / assets.js - OSS、上传凭据、图片权限网关
backend/src/feed.js / feedRanking.js        - 个性化信息流与快照
backend/src/contentPages.js / pagination.js - 内容分页
backend/src/contentEditing.js / contentValidation.js / validators.js - 编辑与校验
backend/src/visibility.js   - 可见性规则
backend/src/mappers.js      - DB 行 → API 响应（游客/他人字段最小化）
backend/src/reports.js      - 举报与处理
backend/src/rateLimit.js    - 限流（内存 / PostgreSQL）
backend/src/bootstrap.js / sync.js / realtime.js / messages.js - 启动数据、增量同步、WebSocket、私信
backend/src/email.js        - SMTP 邮件
backend/src/moderation/     - 审核系统（阿里云/Mock）
```

### 数据库迁移
```
backend/sql/001_init.sql … backend/sql/028_account_security.sql   （共 36 个，按文件名排序执行；生产已执行到 028_account_security）
backend/sql/down/                                                  - 部分迁移的回滚脚本（含 024–028）
```

### 密钥文件（只读，禁止复制内容到聊天）
```
.project-secrets/backend.env        - 生产环境变量
.project-secrets/cloud-notes.md     - 云资源备注
```

## 安全红线（必须遵守）

1. **绝对不要修改代码、数据库迁移、配置文件，除非用户明确要求。**
2. **不要运行 `git add`、`git commit`、`git reset`，除非用户明确要求。禁止 `git push --force`。**
3. **不要运行 `npm install`、`pod install` 等会修改依赖的命令。**
4. **不要把密钥值复制到聊天、报告或新文件中。**
5. **当前有未提交改动，不要清理、回滚或提交它们。**

## 已授权的云端操作（2026-11-12 用户授权，无需逐条确认）

- 部署 ECS：`ssh` / `scp` / `rsync` 上传后端、重启服务。
- 生产库迁移：`npm --prefix backend run migrate`。必须先于依赖它的新后端上线，执行前先确认对应 `backend/sql/down/` 回滚脚本存在。
- 上传 TestFlight：`xcodebuild archive` / `-exportArchive` 上传。
- `git push`（不含强推）、`aliyun` CLI 修改 CDN/OSS 等配置。
- 仍需先问用户：删除云资源或数据（DROP、清空表、删 Bucket/实例）、强推、改动线上密钥。
- 每次发布前跑完第 8 节的验证命令并全部通过；发布后在报告里写明部署了哪个提交、执行了哪些迁移、上传了哪个 build 号。

## 允许的只读操作

- 读取文件、搜索代码、查看 git diff/status/log
- 运行只读验证命令：`npm --prefix backend test`、`node --check`、`xcodebuild ... build`

## 当前状态

- **2026-11-13 已上线**：后端 `eab3cfd`（修复方案 A–E 加生产线 `5bf2c59` 的合并）运行在 ECS `/opt/zbt-releases/20261113-merge`，使用 Node 24.21.0。生产库已迁移到 028。旧版本目录 `20260912-diagnostics` 保留。记录和回滚步骤见 `docs/DEPLOYMENT_2026-11-13.md`。
- **待确认**：iOS build 13 已在 Xcode Organizer 上传，状态显示 "Uploaded to Apple"。但 Organizer 里还有一个 2026-09-13 的 1.0 (13)，需要到 App Store Connect → TestFlight 确认 build 13 的上传日期是不是 11-13。如果不是，就把 build 号改成 14，重新归档后由用户在 Organizer 上传。
- TestFlight 只能由用户本人在 Xcode Organizer 上传：命令行 `xcodebuild -exportArchive` 没有 App Store Connect 账号。
- 生产库导出：自动模式不允许 Claude 读取数据库密码。由用户自己执行 `! bash .project-secrets/deployments/20261113/dump-prod.sh`（可用 `DUMP_NAME=xxx` 改文件名，`OUTDIR` 写死在 20261113，复用时先改）（走单独的 15532 隧道），导出文件放在 `.project-secrets/deployments/<日期>/`。
- 本机访问公网 HTTPS（API、GitHub、Apple）时，因为本机代理偶尔会出现 TLS 失败，重试即可，不要改网络配置。
- 用户正在处理 ICP 备案，CDN 尚未正式接入。

## 诊断与审查资料

旧的 2026-06-03 安全审查结论（邮箱泄露、JWT 弱密钥等）已修复，不再作为现状参考。请看：
- `docs/PROJECT_DIAGNOSTIC_2026-09-12.md`
- `docs/PROJECT_DIAGNOSTIC_XHS_2026-10-06.md`
- `docs/FIX_PLAN_2026-11-12.md`

## 常用只读命令

```bash
cd /Users/rudy2009/Documents/欧美团app
git status --short --branch
git diff --stat
npm --prefix backend test
node --check backend/src/app.js
xcodebuild -project ZhouBianTuan.xcodeproj -scheme ZhouBianTuan -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
# 集成测试只对本机临时 PostgreSQL：TEST_DATABASE_URL=postgresql://<本机临时库> npm --prefix backend run test:integration
```
