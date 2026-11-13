# 2026-09-13 iOS 橙色主题

- 维护工作树：`.worktrees/deploy-diagnostics-20260912`，分支 `codex/deploy-diagnostics-20260912`。
- 主色由粉色改为橙色：浅色模式 `#C24D00`，深色模式 `#FF923D`；白字按钮和跟团标签底色使用 `#C24D00`（对白字对比度约 4.82:1）。
- SwiftUI、系统 AccentColor、UIKit 导航图标与输入光标统一；登录品牌渐变、聊天气泡、标签、点赞收藏和发布控件同步。错误与删除操作使用独立红色，用户已有玫瑰色头像配色保留。
- Debug 截图模式支持 `ZBT_SCREENSHOT_APPEARANCE=light`，默认仍为深色；仅影响本地预览。

## 验证

- Xcode Debug 与 Release 模拟器构建均成功；`git diff --check` 通过。
- iPhone 17 Pro / iOS 26.3：实际检查深色、浅色首页、深色详情页与浅色发布页；点击跟团类型及标签，选中状态显示正常。
- Release 已安装到专用验证模拟器并成功打开线上首页。
- 本地预览（使用示例数据，未入库）：`output/app-store/theme-orange/home-dark.png`、`home-light.png`、`detail-dark.png`、`create-light.png`。
- 既有 NavigationLink 弃用与 AppIntents 元数据提示仍存在；本次未修改相关逻辑。

## 发布状态

这是 iOS 客户端代码更新。未上传 TestFlight / App Store，手机上的已安装版本不会自动变色；后端服务继续使用已部署版本。
