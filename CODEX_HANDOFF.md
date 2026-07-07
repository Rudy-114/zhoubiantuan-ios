# Codex Conversation Handoff

Status: Backend deployed, ready for iOS two-account verification
Generated: 2026-07-07 22:45 CST
Project root: `/Users/rudy2009/Documents/欧美团app`

## Resume Prompt

请读取 `/Users/rudy2009/Documents/欧美团app/CODEX_HANDOFF.md`，用当前文件系统、Git、服务器和模拟器状态复核后继续。当前不要优先处理 App Store Connect；第一优先级是用两台 iOS 18.5 模拟器重新登录双账号，手动验证最新拉黑/解除拉黑/私信失败气泡/双向取关/未关注两条私信限制。后端已于 2026-07-07 22:29 CST 部署到 ECS 并通过 API 集成测试。

## Objective And User Intent

项目是 iOS App「周边团」。当前阶段目标是稳定私信、拉黑、关注关系这些核心社交安全流程。Rudy 最新明确：App Store 资料现在不着急处理，后续 agent 应按本文件和最新代码继续，不要回到旧需求语义。

最新产品语义：

- A 拉黑 B 后，双方真实互相取关；解除拉黑不自动恢复关注，需要手动重新关注。
- 双方互相看不到主页内容/帖子，但消息列表入口、私信历史和主页「发私信」入口保留。
- 只要任一方向存在拉黑关系，私信发送先显示拉黑失败，不再先触发「对方未关注你前最多发送两条消息」。
- 拉黑期间发送的失败假消息只在发送方本地保留，不上传云端、不让对方看到、不计入两条额度；解除拉黑后允许点红色感叹号重发，并按当前真实关系重新判断。

## Current State

- Branch before the requested checkpoint commit: `main`, ahead of `origin/main` by 6 commits.
- Backend production service: deployed and restarted on ECS.
- ECS path: `/opt/zbt-backend`.
- Service: `zbt-backend.service`.
- Public API health: `https://api.zhoubiantuanmail.top/api/health` returned `{"ok":true}`.
- Local Debug tunnel: `http://127.0.0.1:18080/api/health` returned `{"ok":true}`.
- Local `127.0.0.1:18080` is an SSH tunnel to ECS `127.0.0.1:8080`, not a local Node server.
- Public privacy policy is still live at `https://api.zhoubiantuanmail.top/privacy-policy`.
- Two simulators were booted during verification:
  - iPhone 16 Pro `4A818C18-C716-4104-A797-D2A0D5C422F9`
  - iPhone 16 Pro Max `BF96DF18-2567-4945-90B2-37C3E45ABDED`
- Both simulator app preferences showed backend enabled, logged out, and two-message limit enabled:
  - `zhoubiantuan.isBackendEnabled = 1`
  - `zhoubiantuan.isLoggedIn = 0`
  - `zhoubiantuan.limitsUnrepliedMessages = 1`

## Completed Work

- Backend now returns machine-readable blocked-message codes via `error.apiCode` mapped to response `code`.
- Bootstrap and sync payloads include `blockedUserIDs` and `blockedByUserIDs`.
- Backend content bootstrap filters posts, collections, and comments in either block direction while preserving message threads/history.
- Backend block route deletes both follow edges.
- Backend unblock route does not restore follows.
- Backend relationship sync events are emitted on follow/block/unblock changes.
- iOS consumes `blockedUserIDs` and `blockedByUserIDs`.
- iOS local block immediately removes both visible follow edges when known.
- Text/image send and retry check local block failure before the two-message limit.
- iOS maps:
  - `blocked_by_recipient` -> `你已被对方拉黑，无法发送消息`
  - `blocked_recipient` -> `你已拉黑对方，解除拉黑后才能发送`
- iOS only treats HTTP `401` as auth expiry; `403` no longer logs the user out.
- Debug/backend token handling was tightened to avoid fake logged-in states without a token.
- Debug keychain fallback token support exists for simulator testing.
- The two-message limit is on by default again and counts only successful/non-failed current-user messages while the peer does not follow the sender.
- Chat timestamp separators now use real message times.
- Realtime fallback sync was tightened to 3 seconds and no longer relies solely on websocket `connected` state.
- Public HTTPS privacy policy and support email work from prior commits remain in place.

## Deployment And Backend Verification

Commands run locally before deployment:

```sh
git diff --check
node --check backend/src/routes.js
node --check backend/src/app.js
node --check backend/src/bootstrap.js
node --check backend/src/sync.js
node --check backend/src/validators.js
npm --prefix backend test
```

Result: passed; backend tests were 16/16 green.

Deployment command used:

```sh
rsync -az --delete --exclude node_modules --exclude .env --exclude '.env.*' \
  -e 'ssh -i ~/.ssh/zbt_backend.pem -o BatchMode=yes' \
  backend/ ecs-user@47.103.44.42:/opt/zbt-backend/
```

Remote test/restart command used:

```sh
ssh -i ~/.ssh/zbt_backend.pem -o BatchMode=yes ecs-user@47.103.44.42 \
  'set -e; cd /opt/zbt-backend; npm test; sudo systemctl restart zbt-backend; sleep 2; systemctl is-active zbt-backend; curl -fsS http://127.0.0.1:8080/api/health'
```

Remote result:

- `npm test`: 16/16 passed.
- `systemctl is-active zbt-backend`: `active`.
- ECS local health: `{"ok":true}`.
- Public health: `{"ok":true}`.
- 18080 tunnel health: `{"ok":true}`.
- Local and remote SHA-256 checksums matched for:
  - `backend/src/app.js`
  - `backend/src/bootstrap.js`
  - `backend/src/routes.js`
  - `backend/src/sync.js`
  - `backend/src/validators.js`

Production API smoke tests:

- `GET /api/feed?limit=3` returned users/posts/collections.
- Unauthenticated `GET /api/bootstrap` correctly returned `401`.
- Privacy policy returned HTML.

Production API integration test:

- Used two temporary `codex-deploy-*` users created directly on ECS for the test.
- Verified mutual follow setup.
- Verified A blocks B -> both follow edges are removed.
- Verified bootstrap exposes `blockedUserIDs` for blocker and `blockedByUserIDs` for blocked user.
- Verified B -> A send returns `code: "blocked_by_recipient"`.
- Verified A -> B send returns `code: "blocked_recipient"`.
- Verified mutual block priority returns `blocked_by_recipient`.
- Verified unblock does not restore follow edges.
- Verified message send succeeds after both block relationships are removed.
- Temporary users were cleaned up; remaining `codex-deploy-*` user count was `0`.

## iOS Verification

Latest Swift build run in this thread:

```sh
xcodebuild -project ZhouBianTuan.xcodeproj -scheme ZhouBianTuan \
  -configuration Debug \
  -destination 'id=4A818C18-C716-4104-A797-D2A0D5C422F9' \
  build CODE_SIGNING_ALLOWED=NO
```

Result: `BUILD SUCCEEDED`.

The Debug app existed at:

```sh
/Users/rudy2009/Library/Developer/Xcode/DerivedData/ZhouBianTuan-envkvyhnwuiedvfmxlwqqecpatcd/Build/Products/Debug-iphonesimulator/ZhouBianTuan.app
```

Manual UI matrix is still pending because both simulators are logged out.

## Important Files

- `/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/BackendClient.swift`
- `/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/MessageViews.swift`
- `/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/MockAppStore.swift`
- `/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/Models.swift`
- `/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/PostDetailViews.swift`
- `/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/ProfileViews.swift`
- `/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/SearchViews.swift`
- `/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/SettingsViews.swift`
- `/Users/rudy2009/Documents/欧美团app/backend/src/app.js`
- `/Users/rudy2009/Documents/欧美团app/backend/src/bootstrap.js`
- `/Users/rudy2009/Documents/欧美团app/backend/src/routes.js`
- `/Users/rudy2009/Documents/欧美团app/backend/src/sync.js`
- `/Users/rudy2009/Documents/欧美团app/backend/src/validators.js`
- `/Users/rudy2009/Documents/欧美团app/BLOCKING_AND_CHAT_REQUIREMENTS.md`
- `/Users/rudy2009/Documents/欧美团app/HANDOFF-2026-07-07.md`

## Key Decisions And Constraints

- Latest rule wins: block deletes both follow edges; unblock does not restore either follow edge.
- Content/profile visibility is hidden in either block direction, but message threads and message history remain accessible as evidence.
- Profile「发私信」 remains tappable even if blocked.
- Mutual block priority: if both users block each other, sender sees the blocked-by-peer wording.
- Failed local block messages are local-only and excluded from the two-message limit.
- Two-message limit uses current real follow state, not historical follow state.
- App Store work is deliberately not the next focus unless Rudy asks for it again.
- `support@zhoubiantuanmail.top` is the formal support email, but operational support handling still needs a reply agent or human workflow later.
- Do not write `.project-secrets/backend.env`, server `.env`, tokens, test passwords, SSH private keys, or email credentials into docs, commits, or chat.

## Unfinished Work

- Re-login both simulators with two test accounts.
- Manually verify the full block/private-message matrix:
  - A follows B and B follows A.
  - A blocks B -> both follow edges disappear.
  - B can still enter old chat thread and sending creates local failed bubble: `你已被对方拉黑，无法发送消息`.
  - A sending to B creates local failed bubble: `你已拉黑对方，解除拉黑后才能发送`.
  - Mutual block prioritizes blocked-by-peer wording.
  - A unblocks B -> neither follow edge is restored.
  - After unblock, if peer does not follow sender, the two-message limit applies based on prior successful messages only.
- Confirm backend sync makes the other device pick up `blockedByUserIDs` quickly after block/unblock.
- Consider adding permanent backend integration tests for block/unblock/follow/message-limit-adjacent semantics. The ad-hoc production integration test passed, but the committed backend test suite still does not cover those flows.
- Commit/push state as requested by Rudy.
- Later, when Rudy resumes App Store work: support URL, App Privacy, screenshots, description, keywords, age rating, review account, and support email reply workflow.

## Next Actions

1. Commit the current checkpoint if not already committed.
2. Launch/relaunch the Debug app on both simulators if needed:

```sh
APP='/Users/rudy2009/Library/Developer/Xcode/DerivedData/ZhouBianTuan-envkvyhnwuiedvfmxlwqqecpatcd/Build/Products/Debug-iphonesimulator/ZhouBianTuan.app'
for UDID in 4A818C18-C716-4104-A797-D2A0D5C422F9 BF96DF18-2567-4945-90B2-37C3E45ABDED; do
  xcrun simctl terminate "$UDID" com.panpanpan.zhoubiantuan >/dev/null 2>&1 || true
  xcrun simctl install "$UDID" "$APP"
  xcrun simctl launch "$UDID" com.panpanpan.zhoubiantuan
done
```

3. Login both simulator accounts and run the manual matrix above.
4. If UI behavior is correct, push the branch or continue to the next requested work.

## Important Paths

- Project root: `/Users/rudy2009/Documents/欧美团app`
- Main handoff: `/Users/rudy2009/Documents/欧美团app/CODEX_HANDOFF.md`
- iOS project: `/Users/rudy2009/Documents/欧美团app/ZhouBianTuan.xcodeproj`
- Backend source: `/Users/rudy2009/Documents/欧美团app/backend`
- ECS backend path: `/opt/zbt-backend`
- ECS host: `47.103.44.42`
- Service: `zbt-backend`
- Tunnel LaunchAgent label: `com.zhoubiantuan.backend-tunnel`
- Bundle ID: `com.panpanpan.zhoubiantuan`
- Public privacy policy: `https://api.zhoubiantuanmail.top/privacy-policy`
- Public API health: `https://api.zhoubiantuanmail.top/api/health`
- Support email: `support@zhoubiantuanmail.top`
