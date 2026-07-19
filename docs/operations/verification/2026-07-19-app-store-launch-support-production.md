# App Store 上线材料与 Support 页面生产验证

日期：2026-07-19

## 结论

- App Store 公开 Support 页面已上线：`https://api.zhoubiantuanmail.top/support`
- 隐私政策已补充实际数据处理说明并与 Support 页面互链：`https://api.zhoubiantuanmail.top/privacy-policy`
- 生产后端已从 `04af0c913cb37fb18bf68758cac06626bd150d39` 切换至 `5acca636bc00b9b85cd612b69db1b801b63021d1`。
- 本次没有数据库迁移、Nginx 修改、付费 AI 调用或自动处罚开关变更。
- iOS 发布构建号已从 11 提升至 12；本地归档已生成，但尚未上传 TestFlight 或提交 App Review。

## 变更范围

- 新增公开 `/support`、`/help`、`/api/support`、`/api/help` 路由。
- Support 页面包含客服邮箱、账号与登录、账号删除、举报与申诉、社区安全、外部交易风险及隐私入口。
- 隐私政策和 App 内隐私说明新增账号标识、外部联系方式、互动记录、基础诊断和短期反滥用哈希说明。
- `PrivacyInfo.xcprivacy` 补齐 User ID、Other User Contact Info、Coarse Location、Product Interaction、Other Diagnostic Data 和 Other Data Types。
- 新增 App Store Connect 可直接填写的描述、关键词、Review Notes、隐私问卷、年龄分级及截图清单。

## 本地验证

- `npm --prefix backend test`：166/166 通过。
- `swift test --package-path .`：27/27 通过。
- `xcodebuild ... test`：95/95 通过。
- Release 模拟器构建：成功。
- iOS 设备归档：成功，`1.0 (12)`，隐私清单已嵌入，`codesign --verify --deep --strict` 通过。
- Support 页面桌面与 390×844 手机视口检查：无横向溢出，FAQ 可展开，控制台 0 error / 0 warning，支持减少动态效果。

## 生产部署与回滚

- 部署包 SHA-256：`c97275aa74716e8c01d0388120e83d3c35854d509ca4f8ff0b4b7739ea0dec6e`
- 部署后进程：PID `366540`，`NRestarts=0`，`ExecMainStatus=0`。
- 切换脚本在服务启动后确认本机 `/api/health` 与 `/support` 返回成功并包含 Support 页面标记。
- 最终只读复核确认服务仍为 active，最近 30 分钟 error 级日志为 0，外部 AI 调用标记为 0。
- 运行目录备份：`/opt/zbt-backend.support-backup-20260719-093725`
- 原运行目录：`/opt/zbt-backend.support-replaced-20260719-093725`
- 安全开关在部署前确认如下，候选运行目录原样复制生产 `.env`：
  - `SAFETY_CASES_ENABLED=true`
  - `SAFETY_AI_MODE=shadow`
  - `SAFETY_AUTO_ACTIONS_ENABLED=false`
  - `SAFETY_AI_MONTHLY_BUDGET_CNY=0`
  - `ADMIN_WEB_ENABLED=true`

## 公网验证

部署后通过独立公网抓取确认：

- `/api/health` 返回 `{"ok":true}`。
- `/support` 返回“周边团用户支持”，包含客服邮箱、删除账号、举报与申诉及社区安全说明。
- `/privacy-policy` 返回更新后的数据处理说明。
- `/api/feed?limit=1` 返回公开 feed 数据。
- `/admin` 返回管理员登录页面。
- 未登录访问 `/admin/api/cases?limit=1` 返回 401 `admin_auth_required`。

本机直连在切换后验收阶段曾遭遇源地址短时连接重置，随后限制解除；服务器只读复核、服务本机健康探测和独立公网探测现已全部通过，不需要重新部署。

## 尚未完成的外部事项

- 当前钥匙串只有 Apple Development 身份；正式上传前需由 Xcode/Apple Developer 生成或下载 Apple Distribution 签名能力。
- 尚需准备 5 张不含真实用户信息的正式 App Store 截图。
- 尚需在 App Store Connect 填写真实审核联系人、长期有效的密码登录审核账号、版权主体、分发地区、DSA/税务/协议状态。
- 若覆盖中国大陆，须先确认真实有效的 ICP 备案；否则首次发布应排除中国大陆。
- TestFlight 上传和最终“提交审核”均未执行，必须取得 Rudy 当次明确确认后再进行。
