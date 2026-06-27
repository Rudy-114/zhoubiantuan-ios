# 周边团上架审查结果（独立第二轮 / 只读复核）

审查日期：2026-06-17
审查基线：`4d1b328`（与 2026-06-15 那轮完全相同，工作树干净，期间无任何代码改动）
审查方式：Claude Code 独立只读复核 —— 未修改任何源码 / 迁移 / 配置，未提交、未推送、未运行迁移、未上传，未把任何密钥值写入本报告
对照文档：本报告独立验证 `CLAUDE-CODE-AUDIT-RESULT-2026-06-15.md` 的结论，并补充其遗漏项；标注 `【已核实】`/`【新增】`/`【更正】`

---

## 结论

### 判定：No-Go（维持不建议送审）

代码自 2026-06-15 那轮审查后**没有任何改动**（`main` 仍在 `4d1b328`，工作树干净）。因此 06-15 报告的全部 P0 阻塞项**原样存在**，没有一条被修复。在此基础上，本轮独立复核**新发现 1 个 P1 安全问题和数个 P2**，并对 06-15 报告的若干判断做了更正与补强。

### 当前完成度（工程判断）

- 核心产品 MVP：约 80-85%（与历史判断一致）
- App Store 送审准备：约 55-60%
- 后端工程质量：实际**高于**交接稿给人的印象（鉴权 / 越权 / 幂等 / 审核 fail-closed 都做得扎实，见“八、值得肯定的部分”）
- 自动化测试覆盖：约 15%（14 个后端测试**全部是单元级**，HTTP 路由 / 鉴权 / 越权 / 事务 / iOS 全部为零）

### 最重要的三个风险

1. **P0-1 无 App 内账号删除** —— 违反 App Review 5.1.1(v)，社交类必拒。且删除前必须先定下“软删 vs 硬删”和 OSS 孤儿图清理策略（见 P0-5）。
2. **P0-2 无用户拉黑 / 屏蔽** —— `LSApplicationCategoryType = social-networking`（[Info.plist:28](ZhouBianTuan/Info.plist:28)）已自我声明为社交 App，Apple 对 UGC 屏蔽是硬性要求（1.2）。
3. **P0-3 JWT / 验证码密钥弱默认值仍未修复** + **【新增】P1 图片代理回显任意 Content-Type 造成存储型 XSS/钓鱼**。两者都属于“代码里就能确认”的真实安全缺陷。

---

## P0 Findings（全部为 06-15 已列、本轮逐条核实仍然成立）

### P0-1 App 内账号删除完全缺失 【已核实】

- **影响：** App Review 直接拒绝（Guideline 5.1.1(v)）。
- **证据：**
  - [SettingsViews.swift:83](ZhouBianTuan/SettingsViews.swift:83) `SettingsValueRow(title: "删除账号", value: "待接入")`
  - `backend/src/routes.js` 全文无任何 `DELETE /me` / 删除当前账号路由（已通篇读完 1535 行确认）。
  - iOS 全仓搜索仅有 `deleteMessage`（删私信），无 `deleteAccount`。
- **删除前必须先决策（这是真正的卡点，见 P0-5）：** 当前鉴权用的是**软删模型**（`auth.js:23` 过滤 `deleted_at IS NULL AND status='active'`）。
  - 若走**软删**：旧 Token 会立即失效（✓，`userForToken` 已过滤），但该用户的 `active` 帖子仍会出现在 `/feed`（feed 按 `status='active'` 过滤帖子、仅按 `deleted_at` 过滤作者 → 产生“作者为空的孤儿帖”）。必须同时把其帖子/评论置为非 active，或在 feed 里按作者状态过滤。
  - 若走**硬删**（`DELETE FROM users`）：DB 侧几乎全部级联清理（见 P0-5），但 **OSS 图片永远成为孤儿**，无任何级联。
- **建议测试：** 删除后旧 Token 401；本人帖子/评论/私信在他人视图中的状态；重复删除幂等；事务失败回滚不留半删除态。

### P0-2 用户拉黑 / 屏蔽完全缺失 【已核实】

- **影响：** UGC / 社交 App 必备（Guideline 1.2）；本 App 已自报为 social-networking。
- **证据：** 无 `user_blocks` 表（已核对 `sql/001`–`010` 全部建表语句）；无 block/unblock/list 路由；iOS 无任何拉黑入口或拉黑列表页。
- **关联缺陷：** 现有“未关注前最多两条私信”反骚扰开关**仅客户端生效**（见 P2-4），服务端不强制 —— 在没有拉黑的情况下，反骚扰能力实际上接近于零。
- **修复方向：** `user_blocks(blocker_id, blocked_id)` + PK + `CHECK(blocker_id<>blocked_id)`；服务端在 feed/搜索/评论/私信创建处过滤；私信路由（`routes.js:698`）必须在建会话/发消息前检查双向 block。

### P0-3 JWT / 邮箱验证码密钥弱默认值仍未修复 【已核实】

- **影响：** 若生产进程 `NODE_ENV` 不等于 `production`，会**静默回退**到公开已知的弱密钥，任何人可伪造任意用户 JWT。
- **证据：**
  - [config.js:39](backend/src/config.js:39) `jwtSecret: requiredInProduction("JWT_SECRET", "dev-only-change-before-beta")`
  - [config.js:72](backend/src/config.js:72) `codeSecret: requiredInProduction("EMAIL_CODE_SECRET", "dev-only-email-code-secret")`
  - [config.js:20-27](backend/src/config.js:20) `requiredInProduction` 仅在 `nodeEnv === "production"` 时抛错，否则返回弱默认值。
- **修复方向：** 改为 `required("JWT_SECRET")` / `required("EMAIL_CODE_SECRET")`，删除默认值，启动即校验长度≥32；并登录生产服务器确认 `NODE_ENV=production` 且两个密钥已设为强随机值。
- **关联：** `signToken`（[auth.js:14](backend/src/auth.js:14)）有效期 `30d` 且无吊销/版本机制（见 P2-5）。

### P0-4 无公开可用客服 / 联系方式 【已核实】

- **影响：** 隐私文案承诺了客服，但 App 内无真实入口（Apple 要求可用支持联系方式）。
- **证据：**
  - [SettingsViews.swift](ZhouBianTuan/SettingsViews.swift) 全文无“帮助与反馈 / 联系我们 / 客服”入口（设置页只有：账号与安全、通用、通知、切换账号【占位】、退出登录）。
  - [HomeViews.swift:485-487](ZhouBianTuan/HomeViews.swift:485) 隐私文案提到“客服支持”“通过平台提供的反馈渠道请求更正/删除”，但该渠道不存在。
- **修复方向：** 设置页加“帮助与反馈”，展示真实支持邮箱 / HTTPS 支持页；与隐私政策、ASC 支持 URL 三处一致。

### P0-5 账号删除的外键 / 对象存储前置审计 【已核实 + 本轮补全到全部 10 个迁移】

完整的“引用 users 的外键 + 级联”清单（已核对 `sql/001`–`010`）：

| 表 | 外键 → users | 级联 |
|---|---|---|
| `group_collections.owner_id` | → users | CASCADE |
| `posts.author_id` | → users | CASCADE |
| `comments.author_id` | → users | CASCADE |
| `post_likes.user_id` / `post_favorites.user_id` | → users | CASCADE |
| `follows.follower_id` / `following_id` | → users | CASCADE（含 `CHECK(<>)`）|
| `reports.reporter_id` | → users | CASCADE |
| `auth_identities.user_id` | → users | CASCADE |
| `moderation_reviews.owner_id` | → users | CASCADE |
| `moderation_reviews.handled_by` | → users | **SET NULL**（保留管理员处理痕迹，合理）|
| `message_threads.buyer_user_id` / `publisher_user_id` | → users | CASCADE |
| `direct_messages.sender_id` | → users | CASCADE |
| `direct_messages.shared_profile_user_id` | → users | **SET NULL** |
| `message_thread_reads.user_id` | → users | CASCADE |
| `sync_events.user_id` | → users | CASCADE |
| `email_verification_codes` / `rate_limit_events` | 无 users 外键（按 email/hash 键，合理）| — |

- **结论：** 硬删在 DB 层是干净的，**唯一未覆盖的是 OSS 对象**（`avatar/`、`background/`、`post/`、`message/` 下的图片不会随用户删除而清理 → 永久孤儿 + 隐私残留）。删除事务需先收集该用户全部 object key，异步/补偿式删除 OSS。
- **回滚覆盖不足（顺带）：** `backend/sql/down/` 只有 `008` 一个回滚脚本，001–007、009、010 无 down 迁移 —— 生产出问题时无法脚本化回滚。

---

## P1 Findings

### P1-A 【新增 / 本轮独立发现】图片代理回显任意 Content-Type → 存储型 XSS / 钓鱼

- **严重级别：** P1（域名信誉 + 内容安全）
- **影响：** 任意登录用户可让 `api.zhoubiantuanmail.top` 这个受信任域名**托管并以任意 MIME 返回**他上传的内容（如 `text/html`、`image/svg+xml` 内嵌脚本），形成在你域名下的存储型 XSS / 钓鱼页面。
- **链路证据：**
  1. 预签名接受**客户端传入的 contentType**并写进 OSS 对象：[oss.js:40-48](backend/src/oss.js:40)（`createUploadTarget` 用 `"Content-Type": contentType` 生成 PUT 签名），路由 [routes.js:983-991](backend/src/routes.js:983) 直接透传 `req.body.contentType`，无白名单。
  2. 资源代理**回显上游 Content-Type 且无 `nosniff`**：[routes.js:68](backend/src/routes.js:68) `res.setHeader("Content-Type", upstream.headers.get("content-type") || "image/jpeg")`。
  3. `/assets/*`（[routes.js:56-74](backend/src/routes.js:56)）**无需登录**即可访问，只校验前缀 `^(post|avatar|background|message)/` 和 `..`。
- **附带问题（同一处）：** `message/` 是私信图片，却同样经由**无鉴权**的 `/assets/*` 对外服务，且代理每次都重新签名 → 私信图片实际“**凭 object key 永久公开**”，只靠 UUID 不可猜来保护（security-by-obscurity）。
- **修复方向：** 预签名处把 `contentType` 限制为 `image/jpeg|png|webp`；代理处**强制**安全 Content-Type 并加 `X-Content-Type-Options: nosniff`、`Content-Disposition: inline`；私信图片考虑独立的鉴权读取路径（校验请求者是会话参与方）。

### P1-B 占位 / 假功能 / Beta 文案（行号逐条核对，与 06-15 一致）【已核实】

| 位置 | 内容 | 类型 |
|---|---|---|
| [SettingsViews.swift:34](ZhouBianTuan/SettingsViews.swift:34) | “已打开切换账号占位” | 假功能 |
| [SettingsViews.swift:81](ZhouBianTuan/SettingsViews.swift:81) | “微信：待配置” | 未完成 |
| [SettingsViews.swift:83](ZhouBianTuan/SettingsViews.swift:83) | “删除账号：待接入” | 未完成（=P0-1）|
| [CommonComponents.swift:622](ZhouBianTuan/CommonComponents.swift:622) | “已模拟发送提醒” | 假功能（见 P1-C）|
| [PostDetailViews.swift:324-394](ZhouBianTuan/PostDetailViews.swift:324)、[616-677](ZhouBianTuan/PostDetailViews.swift:616) | 邀请好友/微信/朋友圈/QQ/QQ空间/微博/问答/分享图等 | 假功能（共约 19 处 toast 占位）|
| [ProfileViews.swift:2018](ZhouBianTuan/ProfileViews.swift:2018)、[2051](ZhouBianTuan/ProfileViews.swift:2051) | 标签分享 / 筛选占位 | 假功能 |
| [AuthViews.swift:57](ZhouBianTuan/AuthViews.swift:57) | “Beta 版本仅开放…” | Beta 文案 |
| [LegalViews.swift:21](ZhouBianTuan/LegalViews.swift:21)、[28](ZhouBianTuan/LegalViews.swift:28) | “Beta 版本说明 / 本页面用于内测阶段…” | Beta 文案 |
| [HomeViews.swift:508](ZhouBianTuan/HomeViews.swift:508) | “当前 Beta 版本不接入广告追踪 SDK” | Beta 文案 |
| [BackendClient.swift:658](ZhouBianTuan/BackendClient.swift:658) | “来自 iOS 内测版举报” | Beta 文案 |

- **修复方向：** 能接系统分享的改真实 `ShareLink`；首版不做的入口直接隐藏/删除；所有 Beta/内测文案改正式版。**不要用 Toast 伪装“已完成”。**

### P1-C 截团提醒是纯假功能（无任何通知能力）【已核实 / 比 06-15 更明确】

- **证据：** 全仓**没有** `import UserNotifications`、`UNUserNotificationCenter`、`requestAuthorization`（仅 `PHPhotoLibrary` 相册授权）。[CommonComponents.swift:622](ZhouBianTuan/CommonComponents.swift:622) 的“已模拟发送提醒”不调度任何东西，纯文案。
- **修复方向：** 接入 `UserNotifications` 本地通知（收藏/设提醒时建截止前通知，取消/删帖/改截止时更新或取消，处理拒绝授权态）；首版若不做，**删除“会提醒”的承诺**，不保留假成功。

### P1-D `/feed` 与 `/posts/:id` 未鉴权暴露用户资料 【已核实 + 更正】

- **【更正 06-15 措辞】邮箱不会泄露：** `/feed`（[routes.js:319-368](backend/src/routes.js:319)）调用 `userToClient(row, row)`，第三参 `viewerUserId` 为空 → `isSelf=false` → `email: ""`、`phoneNumber: ""`（[mappers.js:3-24](backend/src/mappers.js:3)）。这点请放心，不必再“修邮箱泄露”。
- **仍存在的问题：** `/feed`、`/posts/:id`（[routes.js:370-384](backend/src/routes.js:370)）**均无 `requireAuth`**，未登录即可遍历全部活跃帖子并拿到所有作者的 **昵称、简介、地区、性别、生日、头像、粉丝/关注数**。其中“生日/性别/地区”属于可对外暴露的画像数据，且 `/posts/:id` **无任何限流**（`/feed` 走 `assetLimiter` 之外也无专门限流）。
- **修复方向：** 给这两个路由加 `requireAuth`（首版社区通常要求登录浏览，与本 App“登录强制”定位一致）；若坚持未登录可看，至少加反爬限流，并考虑 `userToClient` 对未登录访问者再收敛 birthday/gender。

### P1-E 自动化测试覆盖严重不足 【已核实，本轮亲自跑过】

- 本轮独立运行 `npm test` → **14/14 通过**，但**全部是单元级**：validators(5) + moderation(7) + oss/cdn(2)。
- **完全没有**：HTTP 路由集成测试、鉴权/登录测试、越权(IDOR)测试、事务/级联测试、并发测试；iOS 侧**无任何** Unit/UI Test target。
- 风险：账号删除、拉黑、私信参与方校验、`assertOwnedObjectKeys`、审核决策这些“出错就出事”的逻辑全靠手测。
- **修复方向：** 优先补后端路由级集成测试（auth、CRUD 越权、删除/拉黑事务）；iOS 至少补 `BackendClient` 解析、`MockAppStore` 合并逻辑、乐观更新的单元测试。

### P1-F App 命名不一致（送审元数据风险）【新增】

- [ZhouBianTuanApp.swift:229](ZhouBianTuan/ZhouBianTuanApp.swift:229) 启动/品牌视图 `Text(isDarkMode ? "周边团" : "欧美团")` —— 浅色显示**“欧美团”**、深色显示**“周边团”**；而 `CFBundleDisplayName` 是**“周边团”**（[Info.plist:8](ZhouBianTuan/Info.plist:8)）。
- 风险：App 内品牌名随深浅色变化、且与商店/桌面名不一致，审核可能质疑名称一致性；需明确最终送审名称并统一。

---

## P2 Findings

- **P2-1 【新增】注册路径邮箱枚举 + 登录时序侧信道。** `send-code`(purpose=register) 和 `/auth/(email/)register` 会回 “该邮箱已注册/本邮箱已经注册过”（[routes.js:82-83](backend/src/routes.js:82),[110](backend/src/routes.js:110),[157](backend/src/routes.js:157)），可探测邮箱是否注册；登录侧 `verifyEmailPasswordLogin`（[routes.js:1001-1007](backend/src/routes.js:1001)）在用户不存在时**短路跳过 bcrypt**，存在响应时间差，可据此枚举。登录文案本身已做中性化（✓）。建议注册也用中性提示或统一耗时。
- **P2-2 【新增】直传 OSS 无大小/类型强校验。** 预签名 PUT（[oss.js:40](backend/src/oss.js:40)）不限制大小，客户端可上传超大对象造成存储滥用；类型校验仅靠后续审核下载，未在入口约束。
- **P2-3 资源/限流相关。** `assetLimiter`（[routes.js:44-49](backend/src/routes.js:44)）用内存 store，多实例不共享；`/posts/:id` 无限流；`reports` 无 `UNIQUE(reporter_id,target_type,target_id)`，可重复举报刷表（[routes.js:919-924](backend/src/routes.js:919)）。
- **P2-4 “未关注最多两条私信”仅客户端。** `limitsUnrepliedMessages` 只在 [MockAppStore.swift:1582](ZhouBianTuan/MockAppStore.swift:1582) 判断，后端私信路由无对应限制 → 直连 API 可绕过。属反骚扰能力名不副实（与 P0-2 合并考虑）。
- **P2-5 JWT 无吊销 / 改密不失效。** 30 天有效期、payload 仅 `{sub,email}`，无 `jti`/版本/`pwd_changed_at` 校验（[auth.js:14-25](backend/src/auth.js:14)）→ 改密码后旧 Token 仍可用满 30 天。建议加 token 版本号或密码变更时间校验（账号删除已可使 Token 失效，因 `userForToken` 过滤 `deleted_at/status`）。
- **P2-6 WebSocket 多实例。** `connectionsByUserID` 为单进程内存表（[realtime.js:9](backend/src/realtime.js:9)）；多实例下跨实例事件不可达，靠客户端 `/sync` 轮询兜底（可接受，但需在扩容前用 Redis/PG pub-sub）。鉴权本身扎实（升级握手要求有效 Token）。
- **P2-7 隐私清单完整性。** [PrivacyInfo.xcprivacy](ZhouBianTuan/PrivacyInfo.xcprivacy) 已声明 Email/Name/EmailsOrTextMessages/Photos/OtherUserContent。需确认是否还需 **User ID**（服务端有 `u-` 自定义 ID）、**Coarse Location**（资料里的“地区”）、**Crash Data**；`NSPrivacyAccessedAPITypes` 仅声明 UserDefaults(CA92.1)，若用到文件时间戳/系统启动时间需补；`NSPrivacyTrackingDomains` 为空（无追踪，符合现状）。需与 ASC 隐私问卷逐项对齐。
- **P2-8 本地未加密存储。** 私信图片 `imageData`、`searchHistory`、`browsingHistoryIDs` 走 UserDefaults/文件明文（Token 已正确放 Keychain，且 `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`，✓）。
- **P2-9 工程结构 / 运维。** `MockAppStore.swift` 1913 行单文件；`pg.Pool` 用默认 max=10（[db.js](backend/src/db.js)）未按并发调参；日志为 stdout JSON（已确认不打印请求体/验证码/Token，✓）。

---

## 未能确认的事项（仓库内无法验证，需线上/控制台确认）

1. 生产 `NODE_ENV` / `JWT_SECRET` / `EMAIL_CODE_SECRET` / `MODERATION_PROVIDER` 的**实际值**（决定 P0-3 是否真正被规避）。
2. ICP 备案号是否有效、与 ASC 元数据/备案主体是否一致。
3. SMTP 是否真实可投递（`email.js` 未配置会抛 503）。
4. OSS Bucket ACL 是否私有（代码用签名 URL，方向正确）；CDN 缓存/回源规则。
5. ASC 资料：截图、描述、关键词、年龄分级、App Privacy 问卷、支持 URL、隐私政策 URL、审核测试账号。
6. 数据库备份 / 恢复 / 监控 / 告警是否存在。
7. 双账号真机回归是否做过。

---

## 上架前最小任务顺序（沿用并微调 06-15 的优先级）

1. **P0-3 密钥（≤0.5 天）：** `required()` 化两个密钥 + 启动校验；登录生产确认 env。顺手给 `/assets` 加 `nosniff` 并收敛上传/代理 Content-Type（P1-A，安全成本低收益高）。
2. **P0-1 账号删除（2-3 天）：** 先定软删/硬删与 OSS 清理策略（见 P0-5）→ 后端 `DELETE /me` 事务 → iOS 二次确认流程 → 验证旧 Token 401、客户端清 Keychain（`logOut()` 已是好范本）→ 补后端测试。
3. **P0-2 用户拉黑（2 天）：** migration + block/unblock/list API + feed/搜索/评论/私信服务端过滤 + iOS 入口；顺便把“两条私信”限制下沉到服务端（P2-4）。
4. **P0-4 客服入口（0.5 天）：** 设置页加“帮助与反馈”，落实真实支持邮箱（需 Rudy 确认）。
5. **P1-B/C 清占位 + Beta 文案（1 天）：** 真分享接 `ShareLink`，不做的删；提醒接本地通知或删承诺；统一去 Beta/内测；统一 App 名称（P1-F）。
6. **隐私政策正式化（需 Rudy 协调）：** 公开 HTTPS 隐私政策，与 `PrivacyInfo.xcprivacy`、ASC 问卷三方对齐（P2-7）。
7. **补测试 + 双账号真机回归（P1-E）。**
8. **Build 10+、ASC 资料、首次送审。**

---

## 建议测试矩阵（重点补“目前为零”的部分）

| 类别 | 优先级 | 覆盖 |
|---|---|---|
| 后端 账号删除 | P0 | `DELETE /me` 事务、旧 Token 401、级联/孤儿、OSS 清理、幂等 |
| 后端 用户拉黑 | P0 | block/unblock/list、feed/评论/私信过滤、不能拉黑自己、幂等 |
| 后端 鉴权/越权 | P0 | 删他人帖/评/合集/私信、改他人资料、`assertOwnedObjectKeys` 绕过 |
| 后端 上传安全 | P1 | 拒绝非图 contentType、`/assets` 强制 image+nosniff、私信图鉴权 |
| 后端 认证 | P1 | 注册-验证码-登录-JWT 过期-429-验证码 5 次锁定 |
| iOS 关键流 | P0/P1 | 登录→Token 存取、删除账号→清 Keychain→回登录、拉黑→不可见、权限拒绝降级、弱网/401/429/500、WS 断线恢复 |

---

## 需要 Rudy 确认 / 提供的信息

1. **支持邮箱**（设置“联系我们” + ASC 支持 URL）。
2. **公开 HTTPS 隐私政策 URL**。
3. **是否上架中国大陆 + ICP 备案号**。
4. **送审 App 名称**：统一为“周边团”还是“欧美团”？（当前启动页按深浅色显示不同名，且与 bundle 名不一致 —— P1-F）。
5. **审核测试账号**（1-2 个可登录、能过内容审核）。
6. **生产环境变量确认**（`NODE_ENV`/`JWT_SECRET`/`EMAIL_CODE_SECRET`/`MODERATION_PROVIDER`/SMTP）。
7. 账号删除的产品决策：**软删去标识化** 还是 **硬删 + OSS 清理**？保留期限多久？

---

## 八、值得肯定的部分（避免误伤，别去“修”这些）

本轮通读后端 1535 行路由 + 鉴权/审核/实时/映射，确认以下都**做得正确、扎实**，请勿在赶进度时误改：

- **写操作普遍校验归属：** 删帖 `author_id=$2`、删合集 `owner_id=$2`、删评论“作者或帖主”、发帖引用合集校验 owner、`PATCH /me` 仅作用本人、`assertOwnedObjectKeys` 限定 `kind/userId/` 前缀防盗用他人已传图。未发现明显 IDOR。
- **私信参与方校验完整：** 不能发给自己、收信人须存在、会话双方校验、`FOR UPDATE` 防并发、撤回限 2 分钟且限本人。
- **邮箱验证码流程安全：** 6 位码以 `sha256(email:purpose:code:secret)` **哈希存储**、单次消费(`consumed_at`)、过期校验、**5 次错误锁定**、发送有重发节流 + 频率限流（[routes.js:1037-1101](backend/src/routes.js:1037)）。
- **点赞/收藏/关注幂等：** `ON CONFLICT DO NOTHING` / `DELETE … rowCount` + 事务，并发不会计数漂移；禁止自关注。
- **审核 fail-closed 正确：** 默认 `failMode="review"`，provider 异常进人工审核而非自动放行（[moderation/index.js:84-99](backend/src/moderation/index.js:84)）。
- **WebSocket 鉴权正确：** 升级握手要求有效 Token，按 userID 精确下发，仅发 cursor 通知不泄露 payload。
- **iOS 安全卫生良好：** Token 存 Keychain（device-only）、`logOut()` 彻底清态、无 ATS 例外（强制 HTTPS）、`.project-secrets/` 与 `backend/.env` 已 gitignore、密钥未进 Git、无遍地强解包（仅 1 处受控 `as! T`）。
- **`/feed` 不泄露邮箱/手机号**（mappers `isSelf` 门控）。

> 一句话：**后端工程底子比交接稿显得的要好，剩下的几乎都是“合规闭环 + 清假功能 + 上架资料”的功，不是推倒重来的活。**
