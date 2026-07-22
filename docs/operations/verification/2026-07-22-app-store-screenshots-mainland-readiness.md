# App Store 截图与中国大陆上线准备验证

日期：2026-07-22

## 结论

- 已在 iPhone 17 Pro Max（iOS 26.3）模拟器上安装 Debug 截图版本，并导出 5 张真实 App UI 截图。
- 截图中的帖子、用户、头像和商品图片均为合成内容；截图模式使用 preview store，不登录生产账号、不访问生产后端。
- 截图入口与 fixture 均位于 `#if DEBUG`，Release 构建成功，Release App 内未发现截图环境变量、fixture 标识或生成素材。
- 已根据 Apple、工信部和阿里云官方资料编写 Apple Distribution、App Review 材料和中国大陆 App ICP 备案指南。
- 本次未上传 TestFlight、未操作 App Store Connect、未提交审核、未改动或部署生产后端。

## 截图产物

App Store 上传文件：`output/app-store/screenshots-upload/`

1. `01-home-feed.jpg`
2. `02-post-detail.jpg`
3. `03-create-post.jpg`
4. `04-profile.jpg`
5. `05-report-safety.jpg`

验证结果：

- 每张均为 1320×2868 竖屏 JPEG。
- 每张均无 alpha/透明通道。
- 已逐张视觉检查：无调试地址、系统弹窗、真实邮箱、真实联系方式或真实用户数据。
- 模拟器原始 PNG 保留在 `output/app-store/screenshots/`，不直接用于上传，因为模拟器 PNG 含 alpha 通道。

## 实现边界

- 启动环境变量：`ZBT_SCREENSHOT_MODE=home|detail|create|profile|safety`
- fixture 素材安装位置：模拟器 App 沙盒的 `Documents/AppStoreScreenshotAssets/`
- 自动化脚本：`scripts/capture-app-store-screenshots.sh`
- 生成素材不加入 Xcode Resources，也不进入正式 App target 资源包。
- 正常 Debug 启动不设置该环境变量时仍走原有 App 路径。

## 验证

- Debug 模拟器构建：成功。
- Xcode 测试：96/96 通过，0 failed，0 skipped。
- 新增 fixture 测试确认 preview store 已登录、后端关闭、用户/帖子 ID 均为 screenshot 命名空间、无远程图片 URL、可见文案无 synthetic/截图标记。
- Release 模拟器构建：成功。
- `git diff --check`：通过。
- 截图脚本 `bash -n`：通过。
- Release App 资源/二进制扫描未发现 `ZBT_SCREENSHOT_MODE`、`screenshot-user`、`AppStoreScreenshotAssets` 或生成截图素材文件。

## 中国大陆仍需完成的外部事项

1. 确认备案主体、域名实名认证和阿里云中国内地生产实例/备案服务码。
2. 确认实际 App Store 分发证书，并取得 iOS 备案使用的公钥和 SHA-1 指纹。
3. 通过阿里云发起周边团 App ICP 备案。
4. 备案号下发后，在 App 和 Support 页面显著展示真实编号，并生成新的最终 Build。
5. 在 App Store Connect 填写 ICP Filing Number，确认简体中文 App 名称与备案一致，再启用中国大陆。
6. 填写真实 Review Contact、版权主体和长期有效的审核账号。
7. 取得 Rudy 当次明确确认后，才可点击最终 `Submit for Review`。

详细步骤见 `docs/app-store/2026-07-22-mainland-china-launch-guide.md`。
