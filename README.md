# 周边团 iOS 高保真原型

这是一个原生 SwiftUI iOS 原型，定位为“小红书式娱乐周边团购社区”。原型只展示团购信息、站内互动和外部联系方式，不包含站内支付、订单、退款、物流、售后或担保交易。

## 运行方式

1. 用 Xcode 打开 `ZhouBianTuan.xcodeproj`。
2. 选择 `ZhouBianTuan` scheme 和任意 iPhone 模拟器。
3. 运行 App。

也可以用命令行验证：

```bash
xcodebuild -project ZhouBianTuan.xcodeproj -scheme ZhouBianTuan -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO build
```

## 已实现

- 深色首页双列瀑布流，含关注 / 发现 / 市集切换。
- 团购详情页，含图片轮播、团购信息、联系方式、风险提示、评论区和底部固定互动栏。
- 发布团购帖页面，含图片选择、必填字段和禁用发布校验。
- 搜索筛选、市集、消息/私信、我的、收藏、截团提醒。
- 管理后台，含举报列表、风险内容、隐藏、下架、警告等模拟处理。
- 本地 `MockAppStore` 模拟点赞、收藏、关注、评论、举报、复制联系方式、私信、提醒和管理员处理状态。
- 8 张原创娱乐周边团购样例图，已放入 `Assets.xcassets`。

## 后端静态资源 CDN

后端默认会把 OSS 图片映射成 `/api/assets/<object-key>`，由 API 服务代理读取 OSS。生产环境建议配置 CDN，让 App 直接从 CDN 拉图片，避免 API 服务器承担图片带宽。

需要在后端环境变量中配置：

```bash
PUBLIC_ASSET_BASE_URL=https://你的CDN域名
```

也兼容旧名：

```bash
CDN_ASSET_BASE_URL=https://你的CDN域名
```

配置后，帖子图、头像、主页背景、私信图片会返回 `https://你的CDN域名/post/...`、`https://你的CDN域名/avatar/...` 这类直链；未配置时仍回退到 `/api/assets/...`，方便本地开发和灰度。

CDN 源站建议指向 OSS Bucket 的公网读域名，缓存规则至少覆盖：

- `post/*`
- `avatar/*`
- `background/*`
- `message/*`

验收方式：调用 `/api/posts` 或 `/api/bootstrap` 后，确认返回的 `remoteImageURLs`、`avatarURL`、`backgroundURL`、私信 `imageURL` 域名是 CDN 域名，而不是 API 域名。
