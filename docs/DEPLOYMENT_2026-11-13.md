# 2026-11-13 发布记录

## 结果

- 后端：已上线提交 `eab3cfd`（分支 `claude/merge-prod-20261112`，已快进合入 `main`）。目录为 `/opt/zbt-releases/20261113-merge`，使用 Node 24.21.0。
- 生产库迁移：已执行 `024_feed_events`、`025_feed_snapshots`、`026_backend_read_path_indexes`、`027_moderation_queue_cursor`、`028_account_security`，共 36 个迁移。
- iOS：build 13（1.0）已归档。命令行上传失败，因为 `xcodebuild` 没有 App Store Connect 账号。用户改用 Xcode Organizer 上传：第一次因为 Apple 开发者协议没有同意而被拒（"You do not have required contracts"），同意协议后重新上传，状态显示 "Uploaded to Apple"。
  - **待确认**：Organizer 里还有一个 2026-09-13 的 1.0 (13)，状态也是已上传。需要到 App Store Connect → TestFlight 看 build 13 的上传日期。如果是 09-13，说明今天这个包被当成重复 build 丢掉了，要把 build 号改成 14 再传一次。
- 停服时间：08:33:24 至 08:39:49 CST，约 6.5 分钟。

## 内容

把生产线 `5bf2c59`（网页管理员、安全案件、申诉、AI shadow 审核、举报界面、橙色主题）合并进修复方案 A–E。冲突的处理规则写在合并提交 `0bf28b3` 的说明里。迁移编号的处理：生产已有的迁移文件名保持不变，我们新增的迁移从 023–027 顺延为 024–028。

## 发布前验证

- 后端单测 53/54。没过的那个文件需要数据库，在 `test:db` 里通过。
- 后端集成测试 68/68，`test:db` 251/251。
- iOS 构建零警告，iOS 测试 128/128，`swift test` 27/27。
- 迁移演练做了三轮，都在本机临时 PostgreSQL 16 上进行：
  1. 空库：迁移 → 回滚 028→024 → 再迁移，表结构一致。
  2. 9 月 12 日停服备份：重放 013–028，各表行数不变；回滚后回到 023。
  3. 11 月 13 日 08:23 的生产导出：迁移和回滚后行数都不变，`token_version` 全部填好，表结构一致；新后端在这份数据上冒烟测试通过。
- 服务器上的预检：源码语法检查通过，生产配置能正常加载，待执行迁移正好是 024–028，对应的回滚脚本都在。

## 备份

- `.project-secrets/deployments/20261113/prod-preflight.dump`（08:23，发布前）
- `.project-secrets/deployments/20261113/prod-cutover.dump`（08:36，停服后、迁移前）
- 两份都有 `.sha256` 校验文件。服务器上保留了旧 systemd 配置 `/opt/zbt-releases/diagnostics.conf.bak-20261113`，旧版本目录 `/opt/zbt-releases/20260912-diagnostics` 原样保留。

## 上线后检查

- 服务器本机：`/api/health`、`/api/feed`（旧参数和 `feedMode=forYou` 都试过）、`/api/collections` 都返回 200，耗时 3–11 ms。经 nginx 访问也是 200。
- 公网：上面这些接口返回 200；`/me`、`/messages/threads` 未登录时返回 401；管理后台返回 200。
- 从本机访问公网 HTTPS 偶尔出现 TLS 握手失败，耗时 2–8 秒。服务器端不慢，问题出在本机网络或代理，和这次发布无关。

## 回滚办法

1. 停止 `zbt-backend`。
2. 在新目录下依次执行 `backend/sql/down/028…024`，执行时用 `ENV_FILE=/opt/zbt-releases/20261113-merge/.env`，执行后回到 023。
3. 把 `/opt/zbt-releases/diagnostics.conf.bak-20261113` 恢复为 `/etc/systemd/system/zbt-backend.service.d/diagnostics.conf`，执行 `daemon-reload`，再启动服务。

注意：回滚 028 会删除密码重置和删号验证码，并且不恢复 F15 的文案。这两点是有意这样设计的。
