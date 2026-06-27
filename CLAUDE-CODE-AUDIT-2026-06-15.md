# Claude Code 独立审查任务书：周边团 iOS 上架准备

生成日期：2026-06-15  
项目目录：`/Users/rudy2009/Documents/欧美团app`

## 给 Claude Code 的直接指令

```text
你现在要对 /Users/rudy2009/Documents/欧美团app 做一次独立、严格、以 App Store 首次上架为目标的代码审查。

第一阶段只读审查，不要修改代码，不要提交，不要推送，不要部署生产环境。

开始前必须阅读：
1. /Users/rudy2009/Documents/欧美团app/AGENTS.md
2. /Users/rudy2009/Documents/欧美团app/HANDOFF-2026-06-15.md
3. /Users/rudy2009/Documents/欧美团app/CLAUDE-CODE-AUDIT-2026-06-15.md

不要把 handoff 中列出的已知问题当作完整答案。请从代码、数据库、配置和测试中独立找证据，特别关注会导致 App Review 拒绝、账号数据损坏、隐私泄露、越权、生产事故或用户无法完成核心流程的问题。

审查完成后，先输出 findings，按 P0 / P1 / P2 排序。每条必须包含：
- 问题标题
- 严重级别
- 用户或业务影响
- 可复现路径或触发条件
- 精确文件路径与行号
- 推荐修复方向
- 建议补充的测试

然后再输出：
- 当前完成度判断
- 是否建议现在提交 App Review：Go / No-Go
- 上架前最小任务清单及顺序
- 仍需 Rudy 提供或确认的信息

如果某一项无法从仓库确认，请明确写“未能确认”，不要猜测已经完成。
```

## 一、项目事实基线

- 产品：周边团 / ZhouBianTuan
- 类型：SwiftUI iOS 社区与团购信息 App，包含用户生成内容和站内私信
- iOS 最低版本：17.0
- 当前版本：`1.0 (9)`
- TestFlight：构建 9 已上传过
- 生产 API：`https://api.zhoubiantuanmail.top/api`
- 图片 CDN：`https://img.zhoubiantuanmail.top`
- 后端：Node.js、Express、PostgreSQL、WebSocket
- 存储：阿里云 OSS
- 内容审核：后端审核模块，可配置阿里云服务
- 当前分支：`main`
- 审查基线提交：`4d1b328`
- 2026-06-15 生成两份新文档前，工作树干净，`main` 与 `origin/main` 同步
- 开始审查时预期会看到 `HANDOFF-2026-06-15.md` 和 `CLAUDE-CODE-AUDIT-2026-06-15.md` 两个未跟踪文件；如果还有其他改动，必须先识别并保护

2026-06-15 已验证：

- Xcode 26.3 / Build 17C529
- generic iOS Simulator Debug 构建成功
- 后端 `npm test` 共 14 项，全部通过

注意：构建通过和少量单元测试通过，不代表核心业务、权限、数据删除和真机流程已经可靠。

## 二、当前已知风险线索

下面只是线索，Claude 必须自行验证，并继续寻找未列出的风险。

### 已知 P0 线索

1. 设置页的“删除账号”仍是“待接入”，后端没有明显的删除当前账号 API。
2. 没有发现用户拉黑的数据库、API 和客户端闭环。
3. 隐私文案提到客服和反馈渠道，但没有发现真实客服入口或公开联系方式。
4. App 是 UGC / 社交产品，账号删除和用户拉黑属于明确的 App Review 要求。

### 已知 P1 线索

1. 截团提醒仍出现“已模拟发送提醒”，没有发现 `UserNotifications` 接入。
2. 多处按钮只显示“占位”Toast，包括第三方分享、问答、分享图、筛选和切换账号。
3. 登录和法律页面仍有 Beta / 内测措辞。
4. 隐私政策还不是正式公开版本，需要与 App Store Connect 和实际数据处理保持一致。
5. 当前没有发现 iOS Unit Test 或 UI Test target。

### 已知发布线索

1. 正式上传需要将 build 从 9 增加到 10 或更高。
2. 需要 App Store 截图、描述、关键词、年龄分级、App Privacy、审核账号、支持 URL 和隐私政策 URL。
3. 若在中国大陆上架，需要确认有效 ICP 备案号及备案主体 / 元数据一致性。

## 三、必须覆盖的审查范围

### A. App Review 与产品完整性

- UGC 内容过滤是否覆盖帖子、评论、昵称、私信和图片
- 举报是否真实提交、可处理、可追踪，是否存在绕过路径
- 是否可以拉黑骚扰用户，且由服务端执行
- 是否有公开可用的联系方式
- 账号删除是否完整、清晰、可在 App 内发起
- 是否存在空按钮、假成功、占位页面或误导性承诺
- 登录是否强制且合理，审核账号能否正常使用
- 实体商品相关外部联系方式和交易描述是否容易被误判为数字内容交易

### B. 身份认证与授权

- 邮箱验证码生成、保存、过期、重放、频率限制和枚举攻击
- 密码强度、哈希参数、登录限流和错误信息
- JWT 签发、过期、刷新或撤销策略
- 账号删除、退出登录、改密码后旧 Token 是否仍有效
- 管理员身份判断是否可以被客户端字段或请求参数伪造
- 每个写操作是否检查资源所有权
- 帖子、评论、集合、消息、审核接口是否存在 IDOR / 越权
- WebSocket 鉴权、订阅范围和断线恢复是否安全

### C. 数据库与删除语义

- 所有外键、级联删除、唯一约束和索引是否合理
- 用户删除时对帖子、评论、消息、举报、关注、收藏、审核记录的处理
- 删除过程是否使用事务，失败后是否可能留下半删除状态
- OSS 图片是否会成为永久孤儿文件
- migration 是否可重复执行、是否有回滚或生产兼容风险
- 并发点赞、收藏、关注、发消息是否可能产生重复或计数漂移

### D. 隐私与安全

- `PrivacyInfo.xcprivacy` 是否与代码实际收集的数据一致
- App Store Privacy 需要申报的数据类型和用途
- 邮件、OSS、内容审核、日志中是否传输或保存个人信息
- 日志是否可能记录验证码、Token、邮箱、私信或对象存储签名 URL
- `.env`、密钥、证书、测试账号是否可能进入 Git
- 上传文件类型、大小、对象 Key、签名 URL 和访问权限是否安全
- CDN / OSS 是否允许枚举或越权读取本应私有的数据
- ATS、HTTPS、证书和生产 API 错误处理
- 数据保留、用户请求更正 / 删除、未成年人条款是否与实现一致

### E. iOS 稳定性与体验

- SwiftUI 状态更新是否保证在 MainActor
- async task 是否可能重复提交、竞态、内存泄漏或页面销毁后更新
- Token 是否安全存于 Keychain，退出 / 删除账号时是否清除
- 图片加载、缓存、压缩、解码和失败重试
- 相机、相册、保存图片和通知权限的拒绝路径
- 离线、弱网、401、429、500、超时和部分上传失败
- WebSocket 与轮询 / sync 是否可能重复消息或覆盖新数据
- 空列表、长文本、大图、动态字体、深色模式和 VoiceOver
- iOS 17 兼容性，以及 deprecated API 是否影响后续维护
- 崩溃点、强制解包、数组越界和不安全类型转换

### F. 后端可靠性与运维

- 未捕获异常、Promise rejection 和事务回滚
- rate limiter 是否适合多实例部署，是否可能被代理 IP 绕过
- 数据库连接池、超时、慢查询和索引
- 健康检查是否真正反映数据库 / OSS 等依赖状态
- 邮件失败、审核服务失败、OSS 失败时的降级和用户反馈
- WebSocket 多实例扩展问题
- 数据库备份、恢复、日志、监控和告警是否完全缺失
- 生产配置默认值是否可能误用 Mock 审核或错误的 fail-open / fail-closed 策略

### G. 测试与发布

- 当前 14 项后端测试覆盖了什么，关键缺口是什么
- 是否缺少路由级集成测试、数据库测试、授权测试和并发测试
- 是否缺少 Swift 单元测试、UI 测试和真机回归清单
- Release 配置、Bundle ID、版本号、签名和 entitlements
- Info.plist 权限文案是否准确
- App Icon、启动体验、截图和元数据是否达到正式发布状态
- 审核测试账号和 App Review Notes 应包含什么

## 四、优先检查的文件

### iOS

- `ZhouBianTuan/ZhouBianTuanApp.swift`
- `ZhouBianTuan/MockAppStore.swift`
- `ZhouBianTuan/BackendClient.swift`
- `ZhouBianTuan/AuthViews.swift`
- `ZhouBianTuan/SettingsViews.swift`
- `ZhouBianTuan/MessageViews.swift`
- `ZhouBianTuan/PostDetailViews.swift`
- `ZhouBianTuan/ProfileViews.swift`
- `ZhouBianTuan/CreatePostViews.swift`
- `ZhouBianTuan/LegalViews.swift`
- `ZhouBianTuan/PrivacyInfo.xcprivacy`
- `ZhouBianTuan/Info.plist`
- `ZhouBianTuan.xcodeproj/project.pbxproj`

### 后端

- `backend/src/routes.js`
- `backend/src/auth.js`
- `backend/src/config.js`
- `backend/src/db.js`
- `backend/src/oss.js`
- `backend/src/messages.js`
- `backend/src/realtime.js`
- `backend/src/sync.js`
- `backend/src/rateLimit.js`
- `backend/src/email.js`
- `backend/src/moderation/`
- `backend/sql/`
- `backend/test/`
- `backend/package.json`

## 五、建议执行的只读 / 验证命令

先检查状态：

```sh
cd "/Users/rudy2009/Documents/欧美团app"
git status --short --branch
git log -5 --oneline --decorate
git diff --check
```

查找未完成 UI：

```sh
rg -n '待接入|占位|模拟发送提醒|内测|Beta|TODO|FIXME|fatalError|force unwrap' \
  ZhouBianTuan backend
```

查找上架关键能力：

```sh
rg -n 'delete.*account|account.*delete|blockUser|blocked|拉黑|屏蔽|support|客服|反馈' \
  ZhouBianTuan backend
```

验证后端：

```sh
cd "/Users/rudy2009/Documents/欧美团app/backend"
npm test
```

验证 iOS：

```sh
cd "/Users/rudy2009/Documents/欧美团app"
xcodebuild -project ZhouBianTuan.xcodeproj \
  -scheme ZhouBianTuan \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  build CODE_SIGNING_ALLOWED=NO
```

第一阶段不要执行：

- 数据库 migration 到生产环境
- 生产账号删除或数据清理
- OSS 批量删除
- Git commit / push
- TestFlight 上传
- 任何包含真实密钥的打印命令

## 六、审查报告格式

请把最终报告写到：

`/Users/rudy2009/Documents/欧美团app/CLAUDE-CODE-AUDIT-RESULT-2026-06-15.md`

报告结构：

```text
# 周边团上架审查结果

## 结论
- Go / No-Go
- 当前完成度
- 最重要的三个风险

## P0 Findings
每条包含影响、证据、文件与行号、修复建议、测试建议

## P1 Findings

## P2 Findings

## 未能确认的事项

## 上架前最小任务顺序

## 建议测试矩阵

## 需要 Rudy 确认的信息
```

严重级别定义：

- P0：可能导致审核拒绝、账号或隐私事故、越权、数据破坏、生产不可用
- P1：核心流程错误、明显假功能、较高概率崩溃或严重体验问题
- P2：维护性、性能、可访问性、测试覆盖或一般体验改进

## 七、当前预期的实施顺序

独立审查可以改变具体技术方案，但除非发现更严重的 P0，建议后续实施顺序保持为：

1. App 内账号删除
2. 用户拉黑 / 屏蔽
3. 真实客服与公开联系方式
4. 真实本地截团通知，或删除提醒承诺
5. 清除占位入口和 Beta 文案
6. 正式隐私政策与 App Store Privacy 对齐
7. 自动化测试和双账号真机回归
8. Build 10+、App Store Connect 资料和首次送审

iOS 首次上架后，再开发团长网页版后台和超级管理员后台。macOS 端目前不在优先路线中。

## 八、Apple 官方核对资料

检查日期：2026-06-15

- App Review Guidelines：  
  https://developer.apple.com/app-store/review/guidelines/
- App 内账号删除：  
  https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Xcode / SDK 上传要求和年龄分级更新：  
  https://developer.apple.com/news/upcoming-requirements/
- App 信息及中国大陆 ICP 要求：  
  https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/
- App 状态及 ICP 缺失 / 无效状态：  
  https://developer.apple.com/help/app-store-connect/reference/app-information/app-and-submission-statuses/
