# 周边团 (ZhouBianTuan) - Claude Code 项目配置

## 项目概述

欧美/二次元周边团购 iOS App。用户创建拼团合集、发布拼团帖子、私信沟通、点赞收藏关注。

## 技术栈

- **iOS:** SwiftUI, Xcode 工程 `ZhouBianTuan.xcodeproj`
- **Bundle ID:** `com.panpanpan.zhoubiantuan`
- **后端:** Node.js / Express / PostgreSQL / 阿里云 OSS / 阿里云内容安全
- **线上 API:** `https://api.zhoubiantuanmail.top/api`
- **Debug:** `http://127.0.0.1:18080/api`
- **分支:** `main`

## 关键路径

### iOS 源码
```
ZhouBianTuan/ZhouBianTuanApp.swift     - App 入口 + RootView + 启动链路
ZhouBianTuan/MockAppStore.swift        - 全局状态管理 + 后端交互
ZhouBianTuan/BackendClient.swift       - API 客户端 + 数据模型映射
ZhouBianTuan/Models.swift              - 本地数据模型
ZhouBianTuan/HomeViews.swift           - 首页
ZhouBianTuan/CommonComponents.swift    - 通用 UI 组件 + 图片加载
ZhouBianTuan/CreatePostViews.swift     - 发帖
ZhouBianTuan/PostDetailViews.swift     - 帖子详情
ZhouBianTuan/ProfileViews.swift        - 个人主页
ZhouBianTuan/MessageViews.swift        - 私信
ZhouBianTuan/SearchViews.swift         - 搜索
ZhouBianTuan/MarketViews.swift         - 关注/市场
ZhouBianTuan/SettingsViews.swift       - 设置
ZhouBianTuan/Theme.swift               - 主题色
```

### 后端源码
```
backend/src/server.js      - HTTP 服务入口
backend/src/app.js         - Express 应用配置
backend/src/routes.js      - 所有 API 路由
backend/src/auth.js        - JWT + bcrypt 认证
backend/src/config.js      - 环境变量配置
backend/src/db.js          - PostgreSQL 连接池
backend/src/oss.js         - 阿里云 OSS 上传/签名
backend/src/mappers.js     - DB 行 → API 响应映射
backend/src/validators.js  - 输入校验
backend/src/rateLimit.js   - 内存限流器
backend/src/bootstrap.js   - 登录时全量数据加载
backend/src/sync.js        - 增量同步事件
backend/src/realtime.js    - WebSocket 实时推送
backend/src/messages.js    - 私信加载
backend/src/email.js       - SMTP 邮件发送
backend/src/moderation/    - 审核系统（阿里云/Mock）
```

### 数据库迁移
```
backend/sql/001_init.sql
backend/sql/002_auth_identities.sql
backend/sql/003_moderation.sql
backend/sql/004_direct_messages.sql
backend/sql/005_sync_events.sql
backend/sql/006_contact_message_updates.sql
backend/sql/007_performance_indexes.sql
backend/sql/008_post_preview_images.sql
```

### 密钥文件（只读，禁止复制内容到聊天）
```
.project-secrets/backend.env        - 生产环境变量
.project-secrets/cloud-notes.md     - 云资源备注
```

## 安全红线（必须遵守）

1. **绝对不要修改代码、数据库迁移、配置文件，除非用户明确要求。**
2. **不要运行 `git add`、`git commit`、`git push`、`git reset`，除非用户明确要求。**
3. **不要运行 `npm install`、`pod install`、`npm run migrate` 等会修改依赖或数据库的命令。**
4. **不要部署 ECS、不要修改阿里云控制台、不要上传 TestFlight/build。**
5. **不要把密钥值复制到聊天、报告或新文件中。**
6. **当前有未提交改动，不要清理、回滚或提交它们。**

## 允许的只读操作

- 读取文件、搜索代码、查看 git diff/status/log
- 运行只读验证命令：`npm --prefix backend test`、`node --check`、`xcodebuild ... build`
- 如发现必须改代码才能验证，停止并只写审查建议

## 当前状态

- 分支 `main`，本地领先远端
- 有未提交改动（CDN 支持、compression、首页骨架屏、预览图等）
- 用户正在处理 ICP 备案，CDN 尚未正式接入
- 用户明确说过：先不上传 build 8

## 已知安全审查结论 (2026-06-03)

详见 `Claude 代码审查/安全审查报告-2026-06-03.md`

最紧迫问题：
- P0-1: `/feed` 公开泄露用户邮箱
- P0-2: JWT 默认弱密钥 `"dev-only-change-before-beta"`
- P1-1: Bootstrap 全量加载所有数据（性能瓶颈）
- P1-3: Sync 事件向全体用户广播

## 常用只读命令

```bash
cd /Users/rudy2009/Documents/欧美团app
git status --short --branch
git diff --stat
npm --prefix backend test
node --check backend/src/app.js
xcodebuild -project ZhouBianTuan.xcodeproj -scheme ZhouBianTuan -destination 'platform=iOS Simulator,name=iPhone 16 Pro Max,OS=18.5' CODE_SIGNING_ALLOWED=NO build
```
