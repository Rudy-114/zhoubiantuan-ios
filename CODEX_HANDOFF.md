# Codex Conversation Handoff

Status: Ready for App Store Connect metadata follow-up
Generated: 2026-07-07 11:45 CST
Project root: `/Users/rudy2009/Documents/欧美团app`

## Resume Prompt

请读取 `/Users/rudy2009/Documents/欧美团app/CODEX_HANDOFF.md`，用当前文件系统和 Git 状态复核后继续。公开 HTTPS 隐私政策 URL 已发布为 `https://api.zhoubiantuanmail.top/privacy-policy`；下一优先级是 App Store Connect 送审资料、App Privacy 问卷、截图/描述/关键词/年龄分级/审核账号，并继续记住 `support@zhoubiantuanmail.top` 已能收发但后续必须接入能处理/回复邮件的 agent 或人工值守流程。

## Objective And User Intent

项目是 iOS App「周边团」，目标是完成 App Store 首次上架前的合规、安全、客服、隐私政策和送审材料收尾。Rudy 已确认 `support@zhoubiantuanmail.top` 邮箱可以收发，但提醒：现在还没有人或 agent 来实际回复邮件，后续要为这个邮箱配置邮件回复 agent。

## Current State

- Git 分支：`main`
- Git 状态：本地 `main` 比 `origin/main` ahead 6。
- 最近代码提交：
  - `cd167e7 Stabilize OSS URL tests`
  - `ef5f92c Add public privacy policy page`
  - `a09e33b Update handoff with support email agent follow-up`
  - `0cf8126 Finalize support email and mail dependency`
- 生产 API：`https://api.zhoubiantuanmail.top/api/health` 已验证 OK。
- 隐私政策 URL：`https://api.zhoubiantuanmail.top/privacy-policy` 已公开 HTTPS 可访问；兼容路径 `/privacy`、`/api/privacy-policy`、`/api/privacy` 也返回同一 HTML。
- 邮箱域名：`zhoubiantuanmail.top` 的 MX 和 SPF 已配置；企业微信邮箱可用。
- App 内客服入口：`ZhouBianTuan/SettingsViews.swift` 使用 `support@zhoubiantuanmail.top`。
- iOS 构建号：`CURRENT_PROJECT_VERSION = 10`，营销版本仍为 `1.0`。
- 后端 `nodemailer` 已升级到 `9.0.3`，本地与服务器 audit 均为 0 vulnerabilities。

## Completed Work

- 实现并部署上架前 P0/P1 修复：账号删除、用户拉黑、举报去重、密钥强制配置、上传白名单、图片代理安全、正式客服入口、清理假功能/Beta 文案。
- 服务器 env 已补齐并重启，生产服务正常。
- 生产迁移已执行到 `001` 至 `012`。
- 腾讯企业邮箱域名配置完成，`support@zhoubiantuanmail.top` 已由 Rudy 确认可收发。
- 删除客服邮箱 TODO，构建号升到 10。
- 升级 `nodemailer` 到 `9.0.3`，并同步部署到服务器。
- 新增并部署公开隐私政策 HTML 页面，内容覆盖账号、资料、帖子/合集、评论、私信、举报、图片、客服、安全日志、第三方云服务、账号删除和“不用于跨 App 或跨网站追踪”。
- 修复 OSS URL 单元测试对生产 `.env` 中 CDN 配置的环境耦合，使本地和服务器测试都稳定通过。

## Files Changed

最近由 Codex 完成并提交：

- `/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/SettingsViews.swift`
- `/Users/rudy2009/Documents/欧美团app/ZhouBianTuan.xcodeproj/project.pbxproj`
- `/Users/rudy2009/Documents/欧美团app/backend/package.json`
- `/Users/rudy2009/Documents/欧美团app/backend/package-lock.json`
- `/Users/rudy2009/Documents/欧美团app/backend/src/app.js`
- `/Users/rudy2009/Documents/欧美团app/backend/src/legal.js`
- `/Users/rudy2009/Documents/欧美团app/backend/src/oss.js`
- `/Users/rudy2009/Documents/欧美团app/backend/test/legal.test.js`
- `/Users/rudy2009/Documents/欧美团app/backend/test/oss_cdn.test.js`
- `/Users/rudy2009/Documents/欧美团app/backend/test/oss_proxy.test.js`

本次 handoff 更新：

- `/Users/rudy2009/Documents/欧美团app/CODEX_HANDOFF.md`
- `/Users/rudy2009/Documents/欧美团app/HANDOFF-2026-06-27.md`

## Verification

最近已通过：

```sh
npm --prefix backend audit --omit=dev --registry=https://registry.npmjs.org
EMAIL_CODE_SECRET="$(openssl rand -base64 48)" npm --prefix backend test
node --check backend/src/routes.js
node --check backend/src/email.js
node --check backend/src/app.js
node --check backend/src/legal.js
node --check backend/src/oss.js
git diff --check
xcodebuild -project ZhouBianTuan.xcodeproj -scheme ZhouBianTuan \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  build CODE_SIGNING_ALLOWED=NO
curl -fsS https://api.zhoubiantuanmail.top/api/health
curl -fsS -o /tmp/zhoubiantuan-privacy-policy.html -w '%{http_code} %{content_type} %{url_effective}\n' https://api.zhoubiantuanmail.top/privacy-policy
```

结果：audit 0 vulnerabilities；后端测试本地和服务器均 16/16 通过；iOS Debug 构建成功；生产 `zbt-backend` active；公网健康检查 OK；公网隐私政策 URL 返回 `200 text/html; charset=utf-8`，并确认页面含标题、客服邮箱、账号删除说明和无跨 App/网站追踪声明。

## Running Services And Environment

- 生产后端由服务器 systemd 服务 `zbt-backend.service` 管理，最近已确认 active。
- 本地没有需要保留的长期运行服务。
- 不要把 `.project-secrets/backend.env`、服务器密钥、邮箱密码或任何 token 写入聊天、文档或 Git。

## Key Decisions And Constraints

- `support@zhoubiantuanmail.top` 是正式 App 内客服邮箱，也应填入 App Store Connect 的支持/联系信息。
- 当前客服邮箱只是可收发，不代表已经有人长期处理邮件。必须在后续上线运营前配置邮件 agent 或明确人工值守。
- 首版仍不做站内支付、订单、退款、物流、担保交易。
- 高影响操作前先 checkpoint；不要回滚用户未明确要求回滚的改动。

## Unfinished Work

- App Store Connect 资料：支持 URL、隐私政策 URL、App Privacy 问卷、截图、描述、关键词、年龄分级、审核账号。
- 为 `support@zhoubiantuanmail.top` 配置邮件回复 agent 或人工值守流程；至少要能接收、分类、回复用户支持邮件。
- 可选但建议：补 DKIM、DMARC 更严格策略，提高邮箱信誉。
- 可选但建议：补后端路由级集成测试，覆盖账号删除、拉黑、举报去重、越权和事务失败。
- 可选但建议：真实本地通知、私信会话内拉黑入口、`/feed` 未登录资料收敛。

## Risks And Known Issues

- 本地 `main` ahead 6，尚未 push 到远端。
- 旧文档 `HANDOFF-2026-06-27.md` 部分早期描述已经过期；以当前文件系统、Git 和本文件为准。
- 如果没人或 agent 看 `support@...`，App 内客服入口虽可用，但运营上会变成无人回复。
- ASC 隐私问卷未完成前，不建议提交 App Review；问卷答案必须与 `https://api.zhoubiantuanmail.top/privacy-policy`、`PrivacyInfo.xcprivacy` 和实际后端行为一致。

## Next Actions

1. 整理 App Store Connect 资料：隐私政策 URL 填 `https://api.zhoubiantuanmail.top/privacy-policy`，支持/联系邮箱填 `support@zhoubiantuanmail.top`；继续准备支持 URL、App Privacy、截图、描述、关键词、年龄分级和审核账号。
2. 对照 `PrivacyInfo.xcprivacy`、后端字段和公开隐私政策逐项填写 App Privacy 问卷；注意账号邮箱、昵称/资料、用户内容、照片/视频、私信/客服、举报、安全日志、无追踪、无站内支付/订单/物流。
3. 为 `support@zhoubiantuanmail.top` 设计并接入邮件回复 agent/值守流程，至少覆盖自动确认、分类、人工接管和异常升级。
4. 需要上传前，确认 Git 是否 push、Archive build 10、上传 TestFlight 并做真机/审核账号验证。

## Important Commands And Paths

```sh
cd /Users/rudy2009/Documents/欧美团app
git status --short --branch
npm --prefix backend audit --omit=dev --registry=https://registry.npmjs.org
EMAIL_CODE_SECRET="$(openssl rand -base64 48)" npm --prefix backend test
xcodebuild -project ZhouBianTuan.xcodeproj -scheme ZhouBianTuan \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  build CODE_SIGNING_ALLOWED=NO
curl -fsS https://api.zhoubiantuanmail.top/api/health
```
