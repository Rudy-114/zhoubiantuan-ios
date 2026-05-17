# Codex 迁移交接说明

## 项目概况

- 项目名称：周边团 / ZhouBianTuan
- 项目路径：`/Users/panpanpan/Documents/欧美团app`
- 类型：原生 SwiftUI iOS 高保真原型
- 定位：小红书式娱乐周边团购社区，只展示团购信息、站内互动和外部联系方式
- 当前阶段：可编译高保真原型
- Xcode 工程：`ZhouBianTuan.xcodeproj`
- Scheme：`ZhouBianTuan`
- Target：`ZhouBianTuan`
- Bundle Display Name：`周边团`
- Bundle Identifier：`com.panpanpan.zhoubiantuan`

## 当前实现进度

目前 app 已经实现一个本地 Mock 数据驱动的 SwiftUI 原型。核心页面包括：

- 首页：关注 / 发现 / 市集切换，双列瀑布流
- 市集页：团购商品浏览
- 搜索页：搜索和筛选入口
- 团购详情页：图片、团购信息、联系方式、风险提示、评论、底部互动栏
- 发布页：图片选择、必填字段、发布校验
- 消息页：私信列表
- 聊天页：站内私信模拟
- 我的页：个人中心、收藏、提醒、后台入口
- 收藏页：收藏团购
- 截团提醒页：提醒列表
- 管理后台：举报列表、隐藏、下架、警告、忽略等模拟处理
- 用户主页：团长资料和帖子列表

## 已实现交互

- 点赞 / 取消点赞
- 收藏 / 取消收藏，并同步创建或移除截团提醒
- 关注 / 取消关注团长
- 添加评论
- 举报帖子
- 管理员处理举报
- 复制微信 / QQ 到剪贴板
- 发送站内私信
- 创建新的团购帖子
- Toast 提示反馈

## 重要文件

- `README.md`：项目说明和运行方式
- `project_progress.json`：当前项目进度、文件清单、实现范围和风险记录
- `file_manifest.txt`：迁移包文件清单
- `ZhouBianTuan/ZhouBianTuanApp.swift`：当前主要 SwiftUI 源码，包含模型、MockAppStore、页面和组件
- `ZhouBianTuan/Assets.xcassets/`：8 张原创娱乐周边样例图和资源配置
- `ZhouBianTuan.xcodeproj/project.pbxproj`：Xcode 工程配置

## 构建验证

迁移前已在当前设备上执行过构建验证，命令如下：

```bash
xcodebuild -project ZhouBianTuan.xcodeproj -scheme ZhouBianTuan -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

结果：`BUILD SUCCEEDED`

迁移到新设备后，建议先执行：

```bash
cd "欧美团app"
xcodebuild -project ZhouBianTuan.xcodeproj -scheme ZhouBianTuan -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

也可以直接用 Xcode 打开：

```text
欧美团app/ZhouBianTuan.xcodeproj
```

## 当前限制

- 所有业务状态都存在本地 `MockAppStore` 中，重启 app 后不会持久化
- 暂无真实后端、账号登录、权限、内容审核服务或外部表单接口
- 暂无站内支付、订单、退款、物流、售后或担保交易
- 暂无单元测试、UI 测试和截图回归测试
- 源码目前集中在单个 `ZhouBianTuanApp.swift` 文件中，后续建议拆分
- Git 仓库当前还没有首个提交，所有文件仍是未跟踪状态

## 建议下一步

1. 在新设备解压迁移包后，用 Xcode 打开工程并构建一次。
2. 确认页面能在模拟器中启动和浏览。
3. 建议先创建首个 Git 提交，固定当前可编译原型基线。
4. 后续继续开发前，优先拆分 `ZhouBianTuanApp.swift`：
   - `Models/`
   - `Store/`
   - `Views/`
   - `Components/`
5. 补充最小测试：发布校验、收藏提醒、举报处理、评论新增。

## 给新设备 Codex 的接手提示

如果要让新设备上的 Codex 继续开发，可以把下面这段话发给它：

```text
请读取当前目录下的 CODEX_HANDOFF.md、project_progress.json 和 file_manifest.txt，接手这个 SwiftUI iOS 项目。先不要大改结构，先确认 Xcode 工程能构建，再根据我的新需求继续迭代。当前项目是“周边团”高保真原型，主要源码在 ZhouBianTuan/ZhouBianTuanApp.swift。
```
