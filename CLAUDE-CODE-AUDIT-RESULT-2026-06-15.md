# 周边团上架审查结果

审查日期：2026-06-15  
审查基线：`4d1b328`  
审查者：Claude Code 独立只读审查

---

## 结论

### 判定：No-Go

当前版本**不建议提交 App Store Review**。有三个 P0 阻塞项必须在送审前解决。

### 当前完成度

- 核心产品 MVP：约 80-85%（与交接稿一致）
- App Store 送审准备：约 55-60%（**低于交接稿估计的 65-70%** ——因为发现了新的 P0 安全问题）
- 测试覆盖：约 15-20%

### 最重要的三个风险

1. **P0-1: 无 App 内账号删除功能** — 违反 App Review Guideline 5.1.1(v)，是明确拒绝理由
2. **P0-2: 无用户拉黑/屏蔽机制** — 社交/UGC App 的明确要求（Guideline 1.2），骚扰用户风险
3. **P0-3: 生产环境 JWT 密钥已确认弱默认值** — 上次审查发现的问题**仍未修复**，存在账号劫持风险

---

## P0 发现

### P0-1: App 内账号删除完全缺失

**严重级别:** P0  
**影响:** App Review 直接拒绝。违反 App Store Guideline 5.1.1(v)。  
**可复现路径:** 打开 App → 设置 → 账号与安全 → "删除账号" 显示 "待接入"  
**证据:**

- `/ZhouBianTuan/SettingsViews.swift:83`: `SettingsValueRow(title: "删除账号", value: "待接入")`
- 后端 `routes.js` 全文无 `DELETE.*user|deleteAccount` 相关路由
- 数据库：`users.deleted_at` 字段存在于 migration 002，但无 API 触发

**推荐修复:**

1. 新增 migration 确保所有引用 users 的表正确级联（见下方 P0-4 数据库审计）
2. 后端新增 `DELETE /me` 端点，事务内执行：标记 `deleted_at` + 清除 Token + 处理关联数据
3. 如保留数据以满足法律要求，在隐私政策中说明去标识化处理与保留期限
4. iOS 设置页实现确认流程：后果说明 → 二次确认 → API 调用 → 清除 Keychain/UserDefaults → 回到登录页

**建议测试:**

- 删除后旧 Token 失效（401）
- 删除后本人帖子、评论、消息的展示状态
- 删除后其他用户看到的内容状态
- 重复删除幂等
- 事务回滚（模拟数据库故障）

---

### P0-2: 用户拉黑/屏蔽完全缺失

**严重级别:** P0  
**影响:** App Review 可能拒绝。社交/UGC App 必须允许用户屏蔽骚扰行为（Guideline 1.2）。  
**可复现路径:** 打开任意用户主页 → 无拉黑选项；私信页 → 无拉黑选项；设置 → 无管理拉黑列表  
**证据:**

- 全文搜索 `blockUser|blocked_user|拉黑|屏蔽`，仅有后端 `moderation/result.js` 中的内容审核 blocked 逻辑，与用户间拉黑无关
- 数据库无 `user_blocks` 表
- 客户端无拉黑 UI 入口，无拉黑列表管理页

**推荐修复:**

1. 新增 migration 创建 `user_blocks` 表：`(blocker_id, blocked_id, created_at)`，PRIMARY KEY + CHECK (blocker_id <> blocked_id)
2. 后端新增 `POST /users/:id/block`、`DELETE /users/:id/block`、`GET /me/blocked-users`
3. 服务端强制过滤：
   - 被拉黑用户的帖子不出现在拉黑者的首页/搜索结果
   - 被拉黑用户的评论不出现在拉黑者的视图中
   - 拉黑者/被拉黑者之间不能创建新私信会话
   - 双方不能互相关注
4. iOS 在用户主页、私信页、评论旁添加拉黑入口
5. 设置中展示已拉黑用户列表，支持解除

**建议测试:**

- 拉黑后双方不能互相发私信
- 拉黑后帖子/评论对拉黑者不可见
- 不能拉黑自己
- 重复拉黑幂等
- 拉黑/解除的 WebSocket 同步

---

### P0-3: JWT 密钥硬编码默认值仍未修复

**严重级别:** P0  
**影响:** 如果生产环境未正确设置 `JWT_SECRET` 环境变量，服务会回退到 `"dev-only-change-before-beta"`。任何获得此已知密钥的人都可以伪造任意用户的 JWT。  
**证据:**

- `/backend/src/config.js:39`: `jwtSecret: requiredInProduction("JWT_SECRET", "dev-only-change-before-beta")`
- `/backend/src/config.js:72`: `codeSecret: requiredInProduction("EMAIL_CODE_SECRET", "dev-only-email-code-secret")`
- `requiredInProduction` 函数（`config.js:20-27`）只在 `NODE_ENV === "production"` 时才抛出错误。如果进程以其他值启动（如未设置 NODE_ENV 默认 "development"），会静默使用弱默认值

**推荐修复:**

1. 将 `jwtSecret` 改为 `required("JWT_SECRET")` — 不管环境，部署时必须有强密钥
2. 将 `email.codeSecret` 改为 `required("EMAIL_CODE_SECRET")` — 同理
3. 在 `server.js` 启动时增加密钥强度校验（至少 32 字符随机字符串）
4. 检查生产服务器上 `NODE_ENV=production` 与实际密钥值

**建议测试:**

- 启动时缺少 `JWT_SECRET` 应立即崩溃，不允许回退
- 使用 `"dev-only-change-before-beta"` 签名的 Token 在生产环境被拒绝

---

### P0-4: 无公开客服/联系方式

**严重级别:** P0  
**影响:** App Review Guideline 要求 App 提供可用的支持联系方式。隐私政策承诺了客服支持但 App 内没有真实入口。  
**证据:**

- `/ZhouBianTuan/SettingsViews.swift` — 全文无"帮助与反馈"、"联系我们"、"客服"等入口
- `/ZhouBianTuan/HomeViews.swift:485` — 隐私文案提到"客服支持和基础运营维护"但无实现
- `/ZhouBianTuan/HomeViews.swift:487` — 写道"通过平台提供的反馈渠道请求更正、删除账号相关信息"，但此渠道不存在

**推荐修复:**

1. 设置页增加"帮助与反馈"入口
2. 展示真实可用的支持邮箱（需要 Rudy 确认）
3. 确保隐私政策 URL、App Store Connect 支持 URL 和 App 内联系方式一致
4. 不要使用占位或 Toast 伪装

---

### P0-5: 账号删除的数据库外键审计 - 缺少级联处理

**严重级别:** P0（账号删除的前置依赖）  
**影响:** 不解决此问题直接实现账号删除可能导致：数据库外键冲突、半删除状态、孤儿数据  
**证据 — 当前 schema 中外键级联行为:**

| 表 | 外键 | 级联 |
|---|---|---|
| `posts` | `author_id → users(id)` | `ON DELETE CASCADE` |
| `comments` | `author_id → users(id)` | `ON DELETE CASCADE` |
| `post_likes` | `user_id → users(id)` | `ON DELETE CASCADE` |
| `post_favorites` | `user_id → users(id)` | `ON DELETE CASCADE` |
| `follows` | `follower_id / following_id → users(id)` | `ON DELETE CASCADE` |
| `reports` | `reporter_id → users(id)` | `ON DELETE CASCADE` |
| `message_threads` | `buyer_user_id / publisher_user_id → users(id)` | `ON DELETE CASCADE` |
| `direct_messages` | `sender_id → users(id)` | `ON DELETE CASCADE` |
| `message_thread_reads` | `user_id → users(id)` | `ON DELETE CASCADE` |
| `sync_events` | `user_id → users(id)` | `ON DELETE CASCADE` |
| `moderation_reviews` | `owner_id → users(id)` | `ON DELETE CASCADE` |
| `moderation_reviews` | `handled_by → users(id)` | `ON DELETE SET NULL` |
| `collections` | `owner_id → users(id)` | `ON DELETE CASCADE` |
| `email_verification_codes` | — | **无外键** |

**推荐修复:**

1. 为 `email_verification_codes.email` 至少保证代码引用的数据一致性（不需要外键到 users，因为验证码可能在注册前就产生）
2. 考虑 OSS 图片清理：用户删除后，`avatar/`, `background/`, `post/` 下的 OSS 对象将成为孤儿文件。建议先将用户的所有 OSS 对象 Key 收集，延时异步删除
3. 在用户删除事务中明确记录关联数据处理决策（保留/删除/匿名化）

---

## P1 发现

### P1-1: 多处占位/假功能和 Beta 文案

**严重级别:** P1  
**影响:** App Review 可能因误导用户被拒绝。  
**证据（已确认的完整清单）:**

| 位置 | 内容 | 类型 |
|---|---|---|
| `SettingsViews.swift:34` | "已打开切换账号占位" | 假功能 |
| `SettingsViews.swift:83` | "删除账号: 待接入" | 未完成 |
| `SettingsViews.swift:81` | "微信: 待配置" | 未完成 |
| `CommonComponents.swift:622` | "已模拟发送提醒" | 假功能 |
| `PostDetailViews.swift:324` | "已打开邀请好友占位" (x2) | 假功能 |
| `PostDetailViews.swift:355-394` | 微信/朋友圈/QQ/微博/分享图占位 (共 14 处) | 假功能 |
| `ProfileViews.swift:2018` | "已打开标签分享占位" | 假功能 |
| `ProfileViews.swift:2051` | "筛选功能占位" | 假功能 |
| `AuthViews.swift:57` | "Beta 版本仅开放邮箱注册..." | Beta 文案 |
| `LegalViews.swift:21` | "Beta 版本说明" | Beta 文案 |
| `LegalViews.swift:28` | "本页面用于内测阶段..." | Beta 文案 |
| `HomeViews.swift:508` | "当前 Beta 版本不接入广告追踪 SDK" | Beta 文案 |
| `BackendClient.swift:658` | "来自 iOS 内测版举报" | Beta 文案 |

**推荐修复:**

1. 能接系统分享面板的，接真实 `ShareLink`
2. 首版不实现的入口直接隐藏
3. 将"Beta 版本说明"替换为正式版本说明
4. 将"内测版"文案更新为正式版
5. 截团提醒：接入 `UserNotifications` 本地通知，或删除提醒承诺

---

### P1-2: 未认证 `/feed` 接口暴露用户资料

**严重级别:** P1  
**影响:** 任何人（不登录）可调用 `/feed` 获取所有公开帖子和关联用户资料。虽然 `userToClient` 已正确处理非本人不返回 email，但仍暴露了所有用户的昵称、简介、头像、粉丝/关注数等。  
**证据:**

- `/backend/src/routes.js:319-368` — `/feed` 路由无 `requireAuth` 中间件
- 可以遍历所有活跃帖子并提取作者列表

**推荐修复:**

1. 将 `/feed` 也加上 `requireAuth`，或限制为仅登录用户可访问
2. 如果首页需要未登录也能看，增加更强的反爬限流（当前无）
3. 考虑在用户设置中增加"是否公开个人主页"选项

---

### P1-3: Bootstrap 全量加载性能瓶颈

**严重级别:** P1  
**影响:** 用户每次登录/boot 时，后端执行 10 个并行查询，加载最多：200 posts + 200 collections + 500 comments + 100 threads + 500 messages + 所有用户 + 所有关系数据。随着用户增长，响应时间和数据库负载将线性增长。  
**证据:**

- `/backend/src/bootstrap.js:5-88`

**推荐修复:**

1. 将 bootstrap 改为仅返回当前用户数据 + sync cursor，然后客户端通过 `/sync` 分页拉取
2. 至少将 comments/reports/messages 从 bootstrap 中移除，改为按需加载
3. 消息列表改为分页（当前 LIMIT 100 threads, 500 messages）

---

### P1-4: iOS 搜索功能中 email 可用于发现用户

**严重级别:** P1  
**影响:** 用户 email 被视为隐私数据。但在搜索团长时，email 被包含在可搜索文本中，可能导致通过 email 前缀推测/发现用户。  
**证据:**

- `/ZhouBianTuan/MockAppStore.swift:814`: `user.email` 被加入 `searchableText` 用于 `groupLeaderUsers(matching:)` 搜索

**推荐修复:**

- 从 `groupLeaderUsers` 的 `searchableText` 中移除 `user.email`
- 搜索功能只应搜索公开信息（昵称、简介、地区、帖子内容等）

---

### P1-5: 无 iOS 单元测试或 UI 测试

**严重级别:** P1  
**影响:** 核心业务逻辑无自动化验证。重构或修复时缺乏安全网。  
**证据:**

- Xcode 工程无 Unit Test 或 UI Test target
- 仅在交接稿中提到"建议补充"
- 当前 14 项后端测试仅覆盖 validators, moderation, OSS/CDN

**推荐修复:**

- 至少为以下模块添加 Swift 单元测试：
  - `BackendClient` 请求构建与响应解析
  - `MockAppStore` 状态合并逻辑（mergeUsers/Posts/Threads）
  - `ContentStatus` 状态转换
  - 点赞/收藏/关注的乐观更新逻辑
- 补充后端路由集成测试

---

### P1-6: Sync 事件向全体种子用户广播

**严重级别:** P1  
**影响:** 当前 `syncAudienceForPublicContent`（`routes.js:1113-1115`）仅返回 seedUserIds（作者、互关等）。但 `setPostReaction` 中`audience` 被设为 `uniqueIds([userId, post.rows[0].author_id])`，这意味着每次点赞/收藏只通知作者和操作者。这本身是合理的。但 **评论创建** 会通知 `[评论者, 帖主, 被回复者]`。

**实际评估：这个设计目前是合理的**，不是上次审查报告（P1-3）说的"向全体用户广播"。上次的审查结论已过期——代码已经改为了精确受众。

但存在另一个问题：**sync_events 表随每个写操作插入记录**。每个点赞/收藏/评论/关注操作都会插入 2-3 条 sync_events。在高活跃度下会快速增长。

---

### P1-7: 生产级错误处理缺失 - 审核失败的 fail-closed 策略确认

**严重级别:** P1  
**影响:** 当阿里云审核服务不可用时，`safeReview` 中的 catch 会走 `moderationErrorResult` → `review` 状态 → 内容进入人工审核而不是直接发布。这是 fail-closed 的正确行为，已通过 `/backend/src/moderation/index.js:84-99` 确认。

但如果 `failMode` 被设为 "block"，则内容会被直接拒绝（"审核服务暂时不可用，内容未发布"）。当前配置中 `failMode` 默认为 `"review"`，这是正确的。

---

### P1-8: 管理员身份依赖 email 匹配

**严重级别:** P1  
**影响:** `isModerationAdmin`（`moderation/index.js:80-82`）通过检查 user.email 是否在 `ADMIN_EMAILS` 环境变量中来判断管理员身份。目前用户不能修改邮箱（`PATCH /me` 不允许），但如果未来支持邮箱变更或第三方登录，需要考虑。

**当前状态:** 安全，因为 `PATCH /me` 不包含 email。但长期建议改为在 users 表上增加 `is_admin` 或 `role` 字段。

---

## P2 发现

### P2-1: sync_events 表缺乏更细粒度的受众过滤

**严重级别:** P2  
**影响:** sync_events 表存储每个用户 × 每个事件的记录。虽然 7 天自动清理（`sync.js:243-247`），但高活跃用户每天可能产生数千条记录。  
**推荐修复:**
- 考虑使用 PostgreSQL LISTEN/NOTIFY 代替轮询 sync
- 或者在 WebSocket 中直接推送事件 payload 而不是只发 cursor 通知

---

### P2-2: 消息私信图片本地持久化未加密

**严重级别:** P2  
**影响:** `DirectMessage.imageData` 和线程数据通过 `JSONEncoder` 序列化到文件系统（`messageThreadsStorageURL`），未加密。如果设备被物理访问，私信图片可能泄露。  
**建议:**
- 至少在将 `imageData` 写入磁盘前使用 `Data` 加密存储
- 或者不持久化 `imageData`，只保留 `remoteImageURL` 并在需要时从 OSS 重新下载

---

### P2-3: 搜索历史和浏览记录未加密存储在 UserDefaults

**严重级别:** P2  
**影响:** `searchHistory` 和 `browsingHistoryIDs` 存储在 `UserDefaults` 中，未加密。  
**建议:**
- 考虑使用 Keychain 存储敏感用户行为数据
- 或在设置中提供清理这些数据的选项

---

### P2-4: MockAppStore 过大（1914 行）

**严重级别:** P2  
**影响:** 单一文件包含认证、数据管理、持久化、WebSocket、消息、API 调用、社交互动等所有逻辑。维护困难。  
**建议:**
- 拆分为：`AuthManager`, `DataManager`, `MessageManager`, `SyncManager`, `RealtimeManager`
- 使用 Swift 的 `@Observable` (iOS 17+) 或保持 `@Published` 的组合模式

---

### P2-5: `/posts/:id` 无速率限制

**严重级别:** P2  
**影响:** 帖子详情接口无限流，可能被滥用。  
**证据:**
- `/backend/src/routes.js:370-384` — `GET /posts/:id` 没有 rate limiter

---

### P2-6: 报告重复提交无去重

**严重级别:** P2  
**影响:** 同一用户可以重复举报同一目标，导致 `reports` 表膨胀和审核负担增加。  
**证据:**
- `/backend/src/routes.js:913-929` — `POST /reports` 中 `INSERT` 无唯一约束

**推荐修复:**
- 在 `reports(reporter_id, target_type, target_id)` 上加 UNIQUE 约束

---

### P2-7: 内存限流器不支持多进程

**严重级别:** P2  
**影响:** 生产环境使用 PostgreSQL 限流（`rateLimit.js:28`: `store === "postgres"` 仅在 NODE_ENV 为 "production" 时启用）。但如果未来部署多个 Node.js 实例，`assetLimiter` 使用的是默认 store（memory），无法跨进程共享状态。  
**证据:**
- `assetLimiter`（`routes.js:44-49`）未传 `store` 参数，默认为 "memory"

**推荐修复:**
- 将 `assetLimiter` 也配置为使用 PostgreSQL store

---

### P2-8: PrivacyInfo.xcprivacy 可能不完整

**严重级别:** P2  
**影响:** 隐私清单声明了 Email、Name、EmailsOrTextMessages、PhotosorVideos、OtherUserContent。但以下数据类型**可能需要但未声明**：
- **User ID** (NSPrivacyCollectedDataTypeUserID) - 服务器使用自定义 u- prefix ID
- **Precise Location** (NSPrivacyCollectedDataTypePreciseLocation) - 用户资料中有 region（地区）
- **Crash Data** - 如果有任何崩溃日志/错误上传

同时应注意：
- `NSPrivacyAccessedAPITypes` 仅声明了 `UserDefaults`（CA92.1）。如果使用了 `NSFileCreationDate`、`NSFileModificationDate`、`systemUptime`、`activeInputModes` 等，需要补充声明
- 未声明 `NSPrivacyTrackingDomains` — 如果 API 域名 (`api.zhoubiantuanmail.top`) 和 CDN 域名 (`img.zhoubiantuanmail.top`) 需要跟踪数据传输，应该在此声明

---

### P2-9: 后端日志输出到 stdout - 生产环境建议结构化日志

**严重级别:** P2  
**影响:** 当前 `logger.js` 使用 `console.log/error` 输出 JSON。这在 systemd/journald 环境中可以工作，但需要确保日志不包含敏感数据（当前代码确认没问题，因为 logger 只记录结构性字段，不记录请求体）。

---

### P2-10: 数据库连接池配置为默认值

**严重级别:** P2  
**影响:** `pg.Pool` 使用默认配置（max 10 连接）。对于生产环境，可能需要根据实际并发调整 `max` 和 `idleTimeoutMillis`。  
**证据:**
- `/backend/src/db.js:6-16` — Pool 构造仅传连接参数，未设连接池大小

---

## 未能确认的事项

以下项目由于无法访问生产服务器、App Store Connect 或用户提供的第三方服务而无法从代码审查中确认：

1. **ICP 备案状态** — 无法确认备案号是否有效，无法确认 App Store Connect 元数据与工信部备案信息一致
2. **生产环境 JWT_SECRET 实际值** — `requiredInProduction` 依赖于 `NODE_ENV=production`，需要登录 ECS 服务器确认环境变量已正确设置
3. **生产环境 MODERATION_PROVIDER 实际值** — 需要确认生产环境是否使用 "aliyun" 而不是 "mock"
4. **邮件服务 SMTP 配置** — 需要确认 SMTP 凭据有效且邮件送达正常
5. **OSS Bucket 访问权限** — 需要确认 Bucket ACL 未配置为公开读（当前使用签名 URL，正确）
6. **CDN 缓存规则** — 需要确认 CDN 已配置正确的缓存规则和源站
7. **App Store Connect 元数据** — 截图、描述、关键词、年龄分级、App Privacy 问卷
8. **审核测试账号** — 需要提供可用且通过内容审核的测试账号
9. **隐私政策公开 URL** — 目前无公开可访问的 HTTPS 隐私政策 URL
10. **App 截图和预览视频** — 是否有足够且准确的截图
11. **真机回归测试** — 是否有双账号真机测试记录
12. **数据库备份** — 是否有定期备份和恢复验证流程

---

## 上架前最小任务顺序

按照审查任务书确定的优先级顺序：

### 第 1 步：P0 安全修复（不应超过 1 个工作日）

1. **JWT 密钥**：将 `jwtSecret` 和 `email.codeSecret` 改为使用 `required()`，移除所有默认值
2. 在生产服务器上确认 `JWT_SECRET`/`EMAIL_CODE_SECRET` 已设置为强随机值
3. 验证生产环境 `NODE_ENV=production` 已设置

### 第 2 步：账号删除（预计 2-3 工作日）

1. 审计数据库外键（已在上方 P0-5 完成）
2. 设计 OSS 图片清理策略
3. 后端实现 `DELETE /me` + 事务处理
4. iOS 实现删除 UI 和流程
5. 验证旧 Token 失效 + 客户端状态清理
6. 补充后端测试

### 第 3 步：用户拉黑（预计 2 工作日）

1. 新增 migration 创建 `user_blocks` 表
2. 后端新增 block/unblock/list API
3. 服务端在 feed/搜索/评论/私信中过滤被拉黑用户的内容
4. iOS 在用户主页、私信页、设置页增加 UI

### 第 4 步：公开客服联系方式（预计 0.5 工作日）

1. 确认支持邮箱（需 Rudy 确认）
2. 设置页增加"帮助与反馈"
3. 更新 `HomeViews.swift` 隐私文案

### 第 5 步：清理占位和 Beta 文案（预计 1 工作日）

1. 删除/隐藏所有不实现的分享入口（微信/QQ/微博等）
2. 将截团提醒改为真实 `UserNotifications` 本地通知或删除
3. 替换所有 Beta/内测文案
4. 更新 `BackendClient.swift:658` 举报详情

### 第 6 步：正式隐私政策（需 Rudy 协调）

1. 完成正式 HTTPS 隐私政策 URL
2. 确保 `PrivacyInfo.xcprivacy` 与实际数据收集一致
3. App Store Connect 隐私问卷与隐私政策一致

### 第 7 步：补测试

1. 后端路由集成测试（auth、CRUD、权限）
2. Swift 业务逻辑单元测试
3. 双账号真机回归（关注、拉黑、私信、举报、删除账号）

### 第 8 步：App Store Connect 与送审

1. Build 10+ 归档和 TestFlight 上传
2. App Store 资料：截图、描述、关键词、分类、年龄分级
3. 审核账号和 App Review Notes
4. 确认 ICP 备案

---

## 建议测试矩阵

### 后端测试

| 测试类别 | 优先级 | 覆盖内容 |
|---|---|---|
| 认证流程 | P0 | 注册-验证码-POST-登录-JWT过期-401 |
| 账号删除 | P0 | DELETE /me 事务完整性、Token 失效、级联处理 |
| 用户拉黑 | P0 | 拉黑/解除/列表、内容过滤、私信阻断 |
| CRUD 权限 | P1 | 帖子和评论的越权修改/删除 |
| IDOR | P1 | 修改他人资料、删除他人帖子 |
| 并发 | P1 | 点赞/收藏竞态、重复插入 |
| 限流 | P2 | 验证码发送频率、登录重试 |
| WebSocket | P2 | 鉴权、断线重连、消息完整性 |

### iOS 测试

| 测试类别 | 优先级 | 覆盖内容 |
|---|---|---|
| 登录流程 | P0 | 注册→验证码→登录→Token 存储→自动刷新 |
| 账号删除 | P0 | 确认→API调用→Keychain清除→回到登录页 |
| 拉黑流程 | P0 | 拉黑→对方帖子不可见→解除拉黑→恢复可见 |
| 权限拒绝 | P1 | 相机、相册拒绝后的功能降级 |
| 弱网/断网 | P1 | 401/429/500 错误处理、WebSocket 恢复 |
| 空数据 | P2 | 空列表、空搜索结果 |
| 大图/长文 | P2 | 图片压缩、长文本显示 |
| 深色模式/VoiceOver | P2 | 主题切换、可访问性 |

---

## 需要 Rudy 确认的信息

1. **正式支持邮箱** — 用于设置"联系我们"和 App Store Connect 支持 URL
2. **隐私政策 URL** — 公开可访问的 HTTPS 地址
3. **ICP 备案号** — 用于 App Store Connect 中国大陆上架
4. **App 正式名称** — 当前 `CFBundleDisplayName` 为"周边团"，启动画面显示"欧美团"/"周边团"（根据深色模式）。需要确认送审名称
5. **审核测试账号** — 提供 1-2 个可登录的测试账号（含密码）
6. **生产环境变量确认** — 登录 ECS 确认 `JWT_SECRET`、`EMAIL_CODE_SECRET`、`NODE_ENV`、`MODERATION_PROVIDER` 均正确设置
7. **SMTP 邮件服务** — 确认发件邮箱和 SMTP 配置在生产环境正常工作
8. **是否上架中国大陆 App Store** — 决定 ICP 备案和审核地区策略
