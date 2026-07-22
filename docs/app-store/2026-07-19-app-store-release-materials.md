# 周边团 App Store 首次发布材料

状态：可用于 App Store Connect 填写；带“Rudy 待确认”的项目不得猜测。

版本目标：`1.0`，最终送审构建建议使用完成本文件隐私清单修正后的 Build 12 或更高版本。

## 1. 产品页基础信息

| 字段 | 建议内容 |
| --- | --- |
| App 名称 | 周边团 |
| 副标题 | 谷圈拼团信息与同好社区 |
| 主要类别 | 社交 |
| 次要类别 | 生活（可选） |
| 价格 | 免费 |
| Support URL | `https://api.zhoubiantuanmail.top/support` |
| 隐私政策 URL | `https://api.zhoubiantuanmail.top/privacy-policy` |
| 隐私选择 URL | `https://api.zhoubiantuanmail.top/support#privacy`（可选） |
| Marketing URL | 首次发布可留空；不要用 API 根路径代替产品官网 |
| 版本发布方式 | 手动发布 |
| 版权 | `2026 [Rudy 待填写开发者法定姓名或实体名称]` |

### 宣传文本

> 发现、发布并管理周边拼团信息；通过举报、拉黑、整改与申诉机制，让同好交流更清楚、更安全。

44 个字符、UTF-8 132 字节，低于 170 字符上限。

### 关键词

```text
谷圈,周边,拼团,团购,拼谷,吧唧,徽章,立牌,收藏,同好,二次元
```

UTF-8 共 79 字节，低于 100 字节上限。不要加入竞品名称、艺人姓名或未授权商标。

## 2. App 描述

```text
周边团是面向谷圈和周边爱好者的拼团信息社区。你可以浏览关注的团购动态，发布拼团信息，整理合集，并通过评论和私信与同好沟通。

核心功能
• 按关注、跟团和拼谷浏览社区内容
• 发布团购或拼谷信息，填写价格、定金、截团时间和联系方式
• 创建拼团合集，统一管理团名、说明、联系方式和进度
• 按作品、角色、标签和内容搜索帖子与用户
• 收藏、点赞、评论、关注和私信沟通
• 查看浏览记录、草稿、我的举报和内容处理进度

社区安全
• 可在帖子、评论、用户主页、拼团合集和私信中举报问题
• 举报用户时可以同时拉黑，设置中可管理已拉黑用户
• 内容被处理后，发布者可以按提示整改并在符合条件时提交申诉
• 发布前内容审核、用户举报和人工复核共同维护社区秩序

账号与隐私
• 支持邮箱注册、密码登录和邮箱验证码登录
• 可在 App 内编辑资料、清除本地浏览记录或直接删除账号
• 不接入广告追踪 SDK，不将个人信息用于跨 App 或跨网站追踪

交易提示
周边团当前不提供站内支付、订单、退款、物流或担保交易服务。通过微信、QQ、群聊或外部链接沟通交易前，请自行核实身份、商品信息、付款与售后风险。
```

## 3. App Review Information

### 联系信息

- 姓名：Rudy 待填写真实联系人。
- 邮箱：填写能够稳定接收 Apple 邮件的审核联系人邮箱。
- 电话：填写能够在审核期间接听的真实号码。
- 不要把管理员后台凭据、恢复码或生产密钥填入这里。

### 登录信息

- 选择“需要登录”。
- Username：在 App Store Connect 的专用字段填写长期有效的审核测试邮箱。
- Password：在 App Store Connect 的专用字段填写审核测试密码。
- 审核账号必须能够使用密码直接登录，不能要求审核员接收邮箱验证码。
- 凭据不得写入 Git、本文件、截图或普通聊天。

### Review Notes（建议英文原文）

```text
ZhouBianTuan is a user-generated-content community for sharing and discussing physical hobby-merchandise group-buy information.

Important scope:
- The app does not sell digital content and does not provide in-app payment, orders, refunds, shipping, or escrow.
- Any transaction for physical goods is arranged outside the app between users through contact information they voluntarily provide.
- The supplied review account can sign in directly with the username and password above; no email verification code is required.

Suggested review path:
1. Sign in and browse the Follow, Group Buy, and Group Order feeds.
2. Open a post to view comments and the report action.
3. Reporting is also available from user profiles, collections, comments, and direct messages. A reporter may block the reported user.
4. Open Profile > My Reports to view report status.
5. Open Profile > Settings > Account & Security > Delete Account to initiate permanent account deletion.

Safety and moderation:
- User content is checked before publication and may be routed to human review.
- Users can report content, block abusive users, track reports, correct moderated content, and submit one eligible appeal.
- Support: https://api.zhoubiantuanmail.top/support
- Privacy policy: https://api.zhoubiantuanmail.top/privacy-policy

Camera and photo-library access are requested only when the reviewer explicitly chooses to take, upload, or save an image.
```

## 4. App Privacy 问卷映射

以下均按“与用户身份关联：是”“用于追踪：否”“用途：App 功能”填写。正式发布前须逐项与 App Store Connect 当前问题核对，不能只复制标签名称。

| App Store 数据类型 | 实际来源 |
| --- | --- |
| Name | 昵称及资料展示 |
| Email Address | 注册、登录、验证码与客服 |
| Other User Contact Info | 用户主动填写的微信、QQ、群号和外部链接 |
| Emails or Text Messages | App 内私信及其参与方信息 |
| Photos or Videos | 头像、主页背景、帖子、私信和举报证据图片 |
| Other User Content | 帖子、合集、评论、举报理由、描述与自由文本 |
| User ID | 内部账号标识及小红书号等账号级标识 |
| Coarse Location | 用户主动填写的地区资料；App 不请求系统定位权限 |
| Product Interaction | 点赞、收藏、关注、拉黑、举报和内容处理记录 |
| Other Diagnostic Data | 基础错误/运行日志及短期反滥用哈希记录 |
| Other Data Types | 用户主动填写且无独立标签的性别、生日等资料 |

补充回答：

- Tracking：否。
- Tracking Domains：无。
- Advertising：无第三方广告或广告追踪。
- Search History：搜索历史仅保存在设备本地，不上传。
- Browsing History：浏览记录仅保存在设备本地，不上传。
- Payment/Purchase History：不收集；当前无站内支付或订单。
- 第三方处理方：云服务器、PostgreSQL 数据库、阿里云 OSS、邮件发送服务、发布前内容审核服务、Qwen 安全分析（仅在已授权的安全模式和预算下）。

## 5. 年龄分级与内容能力

- User-Generated Content：是。
- Messaging and Chat：是。
- 用户拉黑：有。
- 内容举报：有。
- 发布前内容过滤/审核：有。
- 家长控制：无专门功能。
- 年龄验证：无专门功能。
- Gambling / Loot Boxes / Contests：无。
- App 不应标记为 Made for Kids。
- 色情、暴力、辱骂等内容按实际可见频率填写；审核系统会拦截或转人工，但不能因此虚报为绝对不会出现。
- 让 App Store Connect 根据问卷计算分级；如果结果与私信、UGC 和外部交易风险不匹配，再由 Rudy 决定是否向上覆盖，不能人为降级。

## 6. 内容权利、加密与地区

### 内容权利

App 展示用户上传的图片、文字、角色或作品标签，因此应如实回答包含第三方内容。用户协议要求发布者只上传有权使用的内容，平台提供侵权/盗图举报和人工处理；不要声称平台拥有全部用户内容版权。

### 出口合规

`Info.plist` 已声明 `ITSAppUsesNonExemptEncryption=false`。App 使用系统 HTTPS/TLS，不包含自研或非豁免加密算法。最终仍以 App Store Connect 的当期问题为准。

### 分发地区

- 分发方式：Public Distribution。
- 是否包含中国大陆：是（Rudy 已于 2026-07-22 确认）。
- 中国大陆仍处于待备案状态：必须先取得有效 App ICP 备案号，并确认备案主体、App 名称和简体中文元数据一致，之后才能启用该地区。
- 备案操作顺序与项目字段见 `docs/app-store/2026-07-22-mainland-china-launch-guide.md`；不得填写虚假或借用的备案信息。
- DSA trader status、开发者身份、税务与商务协议必须按开发者账号真实情况填写。

## 7. 截图清单

建议准备 5 张竖屏截图，使用 iPhone 17 Pro Max / 16 Pro Max 可接受的 6.9 英寸规格（例如 1320×2868），全部使用合成账号、合成帖子和合成联系方式，不出现真实用户隐私。

1. 首页信息流：展示关注、跟团、拼谷三个业务入口。
2. 拼团详情：展示价格、截团时间、角色余量和团长说明。
3. 发布流程：展示业务字段和清晰的发布状态。
4. 合集与个人页：展示拼团合集、收藏和个人管理入口。
5. 安全闭环：展示举报表单、可选拉黑或“我的举报”处理进度。

截图必须来自真实 App UI，不伪造尚未实现的功能，不显示调试地址、测试标记、系统弹窗、个人邮箱、微信号或聊天隐私。

2026-07-22 已通过 iPhone 17 Pro Max 模拟器生成并逐张视觉检查最终截图。App Store 使用无透明通道的 `output/app-store/screenshots-upload/`；模拟器原始 PNG 保留在 `output/app-store/screenshots/`。截图 fixture 仅在 Debug 环境变量 `ZBT_SCREENSHOT_MODE` 存在时启用，Release 不包含该运行路径，生成素材不加入正式 App target。

## 8. 最终送审清单

- [ ] Support URL 与隐私政策 URL 公网返回 200，并在手机 Safari 中可读。
- [ ] Build 12 或更高版本包含修正后的 `PrivacyInfo.xcprivacy`。
- [ ] TestFlight 真机回归通过，构建号、设备和 iOS 版本已记录。
- [x] 5 张正式截图完成并检查无隐私、无假功能、无调试标记。
- [ ] 描述、副标题、关键词、类别、版权和发布方式已填写。
- [ ] App Privacy 与隐私清单、隐私政策、真实后端处理保持一致。
- [ ] 年龄分级如实声明 UGC 与 Messaging/Chat。
- [ ] 审核测试账号长期有效且不依赖邮箱验证码。
- [ ] Review Notes 已填写，审核员可找到举报、拉黑和删除账号。
- [ ] 分发地区、中国大陆 ICP、DSA、税务和协议状态已确认。
- [ ] 提交前生产 health/feed/privacy/support/admin isolation smoke 全部通过。
- [ ] 最终点击“提交审核”前取得 Rudy 当次明确确认。
