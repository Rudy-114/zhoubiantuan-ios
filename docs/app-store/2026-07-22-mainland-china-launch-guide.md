# 周边团：中国大陆 App Store 上线操作指南

日期：2026-07-22

目标：以 `周边团 1.0 (12+)`、Bundle ID `com.panpanpan.zhoubiantuan` 覆盖中国大陆 App Store。本文不保存身份证件、账号密码、证书私钥、验证码或其他敏感信息。

## 当前结论

- 截图、Support URL、隐私政策和发布文案已经具备。
- 本机钥匙串目前只有 Apple Development 证书，但这不等于无法上传。Xcode 13 以后，从 Organizer 执行 Archive/Distribute 时可使用 Apple 的云托管分发证书完成分发签名。
- 中国大陆上线的关键前置项是 **App ICP 备案**。Rudy 已确认希望包含中国大陆，因此不能在没有真实备案号时直接勾选中国大陆，也不能借用或虚构备案号。
- 当前项目是 UGC 社区，不是游戏、新闻、宗教、图书或杂志 App；以当前“不提供站内支付、订单、退款、物流或担保交易”的产品范围看，应先按非经营性互联网信息服务备案路线准备。最终服务分类和是否涉及其他许可，以阿里云初审及备案主体所在地通信管理局意见为准。

## 1. Apple Distribution：怎么做

### 推荐方式：让 Xcode Organizer 使用云托管分发证书

1. 打开 Xcode，进入 `Xcode > Settings > Accounts`。
2. 确认已登录加入 Apple Developer Program 的 Apple ID，并能看到 Team `L9XK3RU32U`。
3. 打开工程，选择 `ZhouBianTuan` target：
   - `Signing & Capabilities`
   - 勾选 `Automatically manage signing`
   - Team 选择上述团队
   - Bundle Identifier 保持 `com.panpanpan.zhoubiantuan`
4. 设备目标选 `Any iOS Device (arm64)`，执行 `Product > Archive`。
5. Archive 完成后进入 Organizer，选择最新 Archive：
   - `Distribute App`
   - `App Store Connect`
   - `Upload`
   - 保持自动管理签名
6. Xcode 如果提示登录、双重认证、协议更新或云托管证书权限，由账号持有人完成。
7. 上传成功后等待 App Store Connect 处理构建；构建出现后再关联到 1.0 版本。

Apple 官方说明：Xcode 13 或更高版本通过 Organizer 分发时，如果本机没有本地分发证书，可以使用云托管证书进行分发签名。参考：[Cloud-managed certificates](https://developer.apple.com/help/account/certificates/cloud-managed-certificates/)、[Upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds)。

### 什么时候需要手动创建 Apple Distribution 证书

只有在 Organizer 无法取得云托管签名、账号权限不足，或为了 App ICP 备案需要查看生产签名证书特征时，再由 Account Holder/Admin 在 Apple Developer 的 `Certificates, Identifiers & Profiles` 中处理 Apple Distribution 证书。

不要撤销仍在使用的开发/分发证书，也不要把 `.p12`、私钥或证书密码提交到 Git。Apple Distribution 属于团队证书；Apple 官方说明只有 Account Holder 或 Admin 可创建。参考：[Certificates overview](https://developer.apple.com/help/account/create-certificates/certificates-overview)。

## 2. App Store Connect 审核材料：Rudy 需要填什么

进入 `App Store Connect > Apps > 周边团 > iOS App 1.0`。

### 必须由 Rudy 提供的真实信息

| 字段 | 填写原则 |
| --- | --- |
| Review Contact 姓名 | 审核期可以联系到的真实联系人 |
| Review Contact 邮箱 | 能稳定收取 Apple 邮件的真实邮箱 |
| Review Contact 电话 | 带国家/地区代码、审核期可接听的真实号码 |
| Copyright | `2026` 加开发者法定姓名或实体名称；不要填昵称 |
| 审核账号 | 单独创建的长期有效账号，允许密码直接登录，不依赖邮箱验证码 |
| 审核密码 | 只填在 App Store Connect 密码字段，不写入仓库、文档或普通聊天 |

Apple 要求登录型 App 提供不会过期的演示账号，并允许在 Review Notes 里写测试路径。参考：[Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)、[App Review](https://developer.apple.com/app-store/review/)。

### 已准备好、可直接复制的材料

- App 描述、宣传文本、关键词、隐私问卷、年龄分级建议和英文 Review Notes：见 `docs/app-store/2026-07-19-app-store-release-materials.md`。
- Support URL：`https://api.zhoubiantuanmail.top/support`
- Privacy Policy URL：`https://api.zhoubiantuanmail.top/privacy-policy`
- 5 张 App Store 上传截图：`output/app-store/screenshots-upload/`
- 无损保留的模拟器原始截图：`output/app-store/screenshots/`

截图使用 iPhone 17 Pro Max 生成，分辨率为 1320×2868；上传目录使用无透明通道的高质量 JPEG，符合 Apple 6.9 英寸竖屏规格。Apple 接受 1–10 张截图；最高分辨率截图可自动缩放到较小机型。参考：[Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)、[Upload app previews and screenshots](https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots)。

### 提交按钮的边界

元数据和构建都齐全后，先选择正确 Build，再点 `Add for Review`。这一步只是加入草稿；真正送审还要在草稿页点 `Submit for Review`。最终提交前仍应再次检查审核账号、ICP、隐私问卷和生产服务。参考：[Submit an app](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app)。

## 3. 中国大陆 App ICP 备案：按什么顺序做

### 第一步：确认备案主体和接入资源

1. 决定以个人还是单位作为备案主体；信息必须真实，并遵守主体所在地通信管理局规则。
2. 确认 `zhoubiantuanmail.top` 已完成域名实名认证，域名持有人信息与备案主体一致。
3. 在阿里云控制台确认生产后端实际使用的是 **中国内地节点**，并且该 ECS/轻量应用服务器满足备案要求。
4. 如果服务器和备案账号不是同一阿里云账号，先由服务器账号生成并授权备案服务码；如果是同一账号，通常可直接选择实例。

工信部规定，App 主办者通过网络接入服务提供者或分发平台在线提交备案，不需要到通信管理局窗口办理；材料齐全准确时，省级通信管理局在二十个工作日内备案。参考：[工信部 APP 备案通知解读](https://www.miit.gov.cn/jgsj/xgj/hlwgl/art/2023/art_564bf0759d7e41d5b4aa8ce4996b9e84.html)、[互联网信息服务备案审批服务指南](https://hunca.miit.gov.cn/bsfw/bszn/art/2024/art_7ef0d8bd3b0d433ba4b9b277f883f74d.html)。

阿里云要求通过其系统备案时关联阿里云中国内地服务器；香港或海外节点不能作为阿里云备案资源。参考：[阿里云 ICP 备案流程](https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/icp-filing-application-overview)。

### 第二步：准备周边团的 App 信息

| 备案字段 | 本项目应填/准备 |
| --- | --- |
| App 名称 | `周边团` |
| App 图标 | `ZhouBianTuan/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` |
| 运行平台 | iOS |
| Bundle ID | `com.panpanpan.zhoubiantuan` |
| 主要语言 | 简体中文 |
| 是否对外提供 SDK | 否 |
| 使用的第三方客户端 SDK | 当前 iOS target 未接入第三方 SDK；按提交时真实代码复核 |
| App 全部后台服务域名 | `api.zhoubiantuanmail.top`、`img.zhoubiantuanmail.top` |
| 内容分类 | 按阿里云页面选择最贴近“社交/社区/UGC/生活服务”的真实分类，不要为了通过而选无关分类 |
| 负责人资料 | 真实证件、手机号、应急电话、邮箱；单位主体按当地规则准备授权材料 |

阿里云要求填写 App 名称、图标、内容分类、语言、SDK 情况、全部后台服务域名和运行平台特征。参考：[填写 App 信息](https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/fill-in-app-information)。

### 第三步：准备 iOS 生产签名特征

备案系统会要求 iOS 的：

- Bundle ID：`com.panpanpan.zhoubiantuan`
- 生产签名证书公钥
- 生产签名证书 SHA-1 指纹（iOS 填 SHA-1，不是 Android 使用的 MD5）

在 Apple Developer 账号的 Certificates 页面中打开实际用于 App Store 分发的证书，查看/下载证书并取得公钥和 SHA-1。不要使用当前 Apple Development 证书冒充生产证书。阿里云的 iOS 指引见：[填写 App 特征信息](https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/fill-in-app-feature-information)。

如果 Apple 云托管分发证书轮换，生产签名特征发生变化，应及时在备案系统做变更；系统允许多套特征时可按真实分发证书维护新旧信息。

### 第四步：在阿里云发起 App 备案

1. 登录购买生产服务器或获得备案服务码授权的阿里云账号。
2. 进入 `ICP备案 > 开始备案`。
3. 服务类型选择 `App`，按系统识别结果办理首次备案、已有主体新增 App 或新增接入。
4. 填写真实主体、负责人、周边团 App 信息、iOS 特征和两个后台域名。
5. 使用最新版阿里云 App 拍摄证件原件、完成人脸核验；不要上传翻拍的历史证件照片。
6. 通过阿里云初审后，在收到工信部短信时及时完成短信核验。
7. 等待主体所在地管局审核；阿里云给出的常见总周期约为 3–22 个工作日，实际以当地管局为准。

如果主体已有网站 ICP 备案，工信部说明不需要重复填写主体身份信息，只需补充 App 信息；如果域名在其他服务商备案、生产服务接入阿里云，还要先做阿里云新增接入。参考：[App 备案快速入门](https://help.aliyun.com/zh/icp-filing/basic-icp-service/getting-started/quick-sta-rt-for-icp-filing-for-personal-app)、[App 备案 FAQ](https://help.aliyun.com/zh/icp-filing/basic-icp-service/support/basics-about-icp-filling-for-apps)。

### 第五步：备案通过后的代码与 App Store Connect 动作

1. 在 App 内显著位置展示真实 App 备案编号。建议放在 `设置 > 关于周边团`，并同步放到 Support 页面页脚；编号拿到前不能写占位假号。
2. 在 App Store Connect 的 `App Information > Availability in China mainland` 填写真实 ICP Filing Number。
3. 简体中文元数据中的 App 名称必须与工信部备案的 `周边团` 一致；ICP备案号和元数据不匹配会导致中国大陆状态为 Missing/Invalid。
4. 勾选中国大陆分发，并再次检查是否出现其他许可提示。
5. App 开通后，继续按适用规则办理公安联网备案；这不是用假 ICP 号替代的步骤。

Apple 对中国大陆的要求见：[App information — Availability in China mainland](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/)。工信部同时要求备案编号在 App 显著位置标注，见：[工信部 APP 备案通知解读](https://www.miit.gov.cn/jgsj/xgj/hlwgl/art/2023/art_564bf0759d7e41d5b4aa8ce4996b9e84.html)。

## 4. Rudy 现在按这个顺序操作

1. 在阿里云确认生产服务器地域、可备案实例/服务码、域名实名认证主体。
2. 在 Apple Developer 确认实际生产 Apple Distribution/云托管分发证书，并取得公钥与 SHA-1。
3. 发起 App ICP 备案；这是中国大陆上线的最长前置项，应最先启动。
4. 同时在 App Store Connect 填产品页材料、截图、审核联系人和版权主体，并创建长期有效的审核账号。
5. ICP 号下发后，把真实编号发给开发侧，补进 App 和 Support 页面，再生成新 Build。
6. 上传最终 Build、在 App Store Connect 填 ICP 号并选择中国大陆。
7. 完成最终生产验证后，再由 Rudy 明确确认 `Submit for Review`。

## 仍需 Rudy 提供、但不要提交到 Git 的信息

- 备案主体：个人或单位，以及主体所在省市。
- 阿里云生产服务器的实际地域和可备案实例状态。
- 域名实名认证是否与备案主体一致。
- Apple Developer / App Store Connect 的 Account Holder 权限是否在 Rudy 手上。
- 审核联系人姓名、电话、邮箱。
- 版权主体的法定姓名或实体名称。
- 审核账号及密码（只在 App Store Connect 安全字段中填写）。
- App ICP 备案通过后的真实备案编号。
