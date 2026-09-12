# 周边团

原生 SwiftUI iOS 客户端与 Node.js / PostgreSQL 后端，提供团购信息、收藏关注、评论、私信、库存编辑、内容审核与举报处理。不包含站内支付、订单、退款、物流或担保交易。收藏截团日期只在 App 内展示，目前没有系统推送。

## 本地运行

使用 `.node-version` 固定的 Node 24.21.0、PostgreSQL 16；iOS 最低 17，当前验证工具为 Xcode 26.3。Node 24 是受支持的 [LTS 分支](https://nodejs.org/en/about/previous-releases)。

```sh
npm --prefix backend ci --registry=https://registry.npmjs.org
cp backend/.env.example backend/.env
```

编辑 `backend/.env` 中的数据库、随机 JWT/验证码密钥、OSS 及 SMTP 配置。不要提交实际环境文件。明确指定环境文件再运行；生产部署步骤见下文。

```sh
cd backend
ENV_FILE="$PWD/.env" npm run migrate
ENV_FILE="$PWD/.env" npm start
```

开发时可用 Mock 审核，但不会因此提供免费的真实 OSS/邮件发送。未配置 SMTP 时验证码请求返回发送不可用，不能当作发送成功。不要对真实业务数据库运行 `seed`。

用 Xcode 打开 `ZhouBianTuan.xcodeproj`，选择 `ZhouBianTuan` scheme。Debug 默认 API 为 `http://127.0.0.1:18080/api`；后端示例同端口。模拟器中的该地址可以访问开发电脑，真机中的该地址指手机本身。真机调试可在 Xcode Scheme 的启动参数中加入 `-zhoubiantuan.backendBaseURL http://开发电脑局域网地址:18080/api`，指定手机可达的开发服务器地址；Release 固定使用正式 HTTPS API。

## 验证

所有后端测试强制合成环境，跳过本地私有 env，并禁用真实邮件。集成测试必须显式传入名称以 `zbt_test` 开头的独立数据库；自动从空库应用全部 SQL 迁移，测试数据只写该库。

```sh
npm --prefix backend test
TEST_DATABASE_URL=postgresql://zbt_test@127.0.0.1:5432/zbt_test_local npm --prefix backend run test:integration
npm --prefix backend audit --registry=https://registry.npmjs.org
xcodebuild -project ZhouBianTuan.xcodeproj -scheme ZhouBianTuan -configuration Debug -destination 'platform=iOS Simulator,id=你的模拟器ID' CODE_SIGNING_ALLOWED=NO test
xcodebuild -project ZhouBianTuan.xcodeproj -scheme ZhouBianTuan -configuration Release -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build
```

`.github/workflows/verify.yml` 在 PR/分支推送中运行干净安装、单测、临时 PostgreSQL 集成测试、安全审计、原生测试和 Release 模拟器构建。工作流已提交到本地源码，尚未在远程 CI 运行。

## 权限与生产部署

本次修复的[进度](docs/DIAGNOSTIC_FIX_PROGRESS.md)与[部署约束](docs/DIAGNOSTIC_FIX_DEPLOYMENT.md)记录迁移、客户端协议与生产验收。迁移 013–022 必须与新后端/客户端协调发布；历史代码不能与新的同步游标写入方式混用。部署前先备份并确认恢复方案。

图片统一通过 `/api/assets/<object-key>` 验证可见性。私信、待审核、撤回和下架图片不能通过 OSS/CDN 直链绕过该入口。`PUBLIC_ASSET_BASE_URL` 不再改变 App 返回的图片地址；禁止缓存权限网关响应。已有 CDN 缓存和公开对象 ACL 必须按部署文档收回，本地代码不会自动修改云策略。

管理员必须是已验证邮箱的显式数据库角色；`ADMIN_EMAILS` 不授予权限。`node scripts/moderator.js grant USER_ID` 只用于实际授权管理员。

生产必须明确 `NODE_ENV=production`、HTTPS `PUBLIC_API_BASE_URL`、`MODERATION_PROVIDER=aliyun`、有效 SMTP、强随机密钥及 `MODERATION_DAILY_CALL_LIMIT`。额度按北京时间每日供应商请求数计，包括每个文本分段和每张图；0 暂停自动审核并转人工。它不是人民币金额，需按实际套餐计费单位选择额度。相同输入当天复用结果；超时未明的调用占额度且不自动重发。人工审核队列需要实际负责人处理。

`TRUST_PROXY` 只填写真实反向代理地址/网段（本机 nginx 可用 `loopback`），不要无条件信任转发头。配置有限数据库连接池与超时，另为实时监听预留一个连接。SIGTERM/SIGINT 停止接新请求并释放 WebSocket、定时任务和数据库连接，最多等待 25 秒。

数据库 TLS、备份恢复、告警、账号权限和现有 CDN 撤销仍需生产环境验收，不能由本地测试替代。`CODEX_HANDOFF.md` 保留用户已有改动；当前交付状态以修复进度、Git 和实际文件为准。
