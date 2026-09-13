# 2026-09-13 TestFlight 上传记录

- 用户已明确授权保存 Git 并上传新版到 TestFlight，并要求使用 Xcode 完成上传。
- 橙色主题提交：`185bcc1`；发布源码提交：`ecdb409`（将构建号从 12 升至 13）。
- App：周边团；Bundle ID：`com.panpanpan.zhoubiantuan`；版本：`1.0 (13)`。
- 包含此前诊断修复、举报与安全功能以及橙色主题。

## 打包与上传结果

- Xcode 26.3，Release / generic iOS arm64 Archive 成功，代码签名严格验证通过。
- 归档 Info.plist 确认版本 1.0、构建号 13、最低 iOS 17.0、豁免加密声明；包内未发现凭据文件或截图 fixture 素材。
- 通过 Xcode Organizer 的 `Distribute App > App Store Connect` 完成上传。
- 2026-09-13 10:45（Asia/Shanghai），Xcode 显示 `App upload complete`、`ZhouBianTuan 1.0 (13) uploaded`；归档列表显示 `Uploaded to Apple`，Submission Status 的 Build Number 为 13。
- Xcode 已确认上传成功；Apple 后续构建处理及测试人员可安装状态未独立确认，未提交正式 App Store 审核。
- 本地归档：`output/app-store/testflight-20260913/ZhouBianTuan-1.0-13.xcarchive`（已由 Git 忽略）。Xcode Organizer 保留了此次上传记录。
- 后端继续运行 `913f05a`；本次没有重新部署服务器。

## 下一步

在 TestFlight 查看周边团 `1.0 (13)`；Apple 处理完成并向现有测试组开放后，即可在手机安装测试。若暂未显示，先查看构建处理或测试组状态，不要重复上传相同构建号。
