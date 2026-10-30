# 周边团：小红书式体验与全项目诊断

审查日期：2026-10-06  
代码基准：`codex/diagnostic-fixes-20260912`，HEAD `14ac5ab`。原始审查基准；实施结果见文末“实施复核”。

## 结论

项目的账号、内容审核、举报、图片权限、游标分页、私信增量同步和 WebSocket 基础已经比原型可靠，后端单测与 iOS 原生测试也能通过。但目前还不能称为“小红书级信息流”：首页本质仍是按发布时间倒序的瀑布流，缺少推荐闭环；手势主要用于切 tab/返回，缺少双击点赞、长按操作、稳定的手势优先级；图片和首屏加载会在弱网或数据量增长时放大延迟；大量状态只用 toast 表达，失败时用户看不到可恢复的操作。

如果目标是正式上线，先处理依赖安全、线上版本与本地分支的事实核对、图片加载和错误状态；如果目标是做出小红书式体验，最高价值的工程投入是“Feed 数据契约 + 行为埋点 + 召回/排序 + 曝光去重”，而不是继续堆页面。

## 验证边界

- `npm --prefix backend test`：21/21 通过。
- iOS Debug 测试：15/15 通过；Release 模拟器构建通过。
- 本机没有 PostgreSQL，48 项集成测试无法执行，不能把单测通过当成数据库链路通过。
- 当前环境是 Node 25.8.0，而项目锁定 Node 24.21.0；应在 Node 24 下复跑。
- 当前依赖审计实际发现 3 项：`compression` high、`nodemailer` high、`proxy-addr` critical 传递依赖。仓库旧验证文档写“0”，与当前 lockfile/环境不一致，需要重新安装并复核。
- 生产部署记录、`fix-verification/results.json` 和 `CODEX_HANDOFF.md` 对“是否已部署、生产迁移是否完成、当前 HEAD”存在冲突；在发布前必须以服务器实际提交、迁移记录和健康检查重新确认。

## P0：必须先处理

| 问题 | 证据 | 影响 | 建议 |
|---|---|---|---|
| Feed 没有推荐算法 | [contentPages.js:41-69](/Users/rudy2009/Documents/欧美团app/backend/src/contentPages.js:41)、[MockAppStore.swift:971-977](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/MockAppStore.swift:971) | 用户看到的是时间流，无法根据兴趣、关注、库存和互动形成个性化首页；也没有数据评估推荐质量 | 先做 Following/For You 两路 Feed，采集曝光、停留、完读、点赞、收藏、评论、关注、跳过、不感兴趣；再做召回、重排、去重、多样性和灰度版本 |
| 依赖安全状态不可信 | [backend/package.json](/Users/rudy2009/Documents/欧美团app/backend/package.json)、当前 `npm audit` 与旧验证文件不一致 | 可能把带已知漏洞的依赖带入发布 | 在 Node 24、干净目录执行 `npm ci` 和官方源 audit；逐项升级并跑邮件、代理、鉴权和上传回归，避免直接 `--force` |
| 发布/生产事实不一致 | [docs/DEPLOYMENT_2026-09-12.md](/Users/rudy2009/Documents/欧美团app/docs/DEPLOYMENT_2026-09-12.md)、[docs/fix-verification/results.json](/Users/rudy2009/Documents/欧美团app/docs/fix-verification/results.json) | 可能误以为服务、迁移和客户端已同步，导致新旧协议混用 | 建立一份当前 release manifest：后端 commit、迁移号、iOS build、客户端最低版本、生产健康检查、回滚点 |

## P1：用户体验与正确性

### 信息流与交互

1. **瀑布流不是实际 Masonry。** [HomeViews.swift:160-188](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/HomeViews.swift:160) 按奇偶序号分左右列，卡片高度不同时会产生大块空洞；应按估算高度分配到当前最短列，或使用真正支持 Masonry 的布局。

2. **封面统一裁剪。** [HomeViews.swift:282-285](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/HomeViews.swift:282) 固定 0.75 比例并 `scaledToFill`，海报、立牌和长图会丢主体。服务端已有 `imageAspect`，但首页没有使用它；应保留首图比例并设置最大高度。

3. **切换 Feed 丢状态。** [HomeViews.swift:39](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/HomeViews.swift:39) 用 `.id(feed)` 重建整个 ScrollView，切换“跟团/拼谷”会丢滚动位置、分页状态和预加载。每个 tab 应有独立的 scroll position 和分页状态。

4. **首页没有真正的空态/错误态。** [HomeViews.swift:24-38](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/HomeViews.swift:24) 在加载完但没有内容时仍显示空网格；[MockAppStore.swift:355-369](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/MockAppStore.swift:355) 首屏失败直接吞掉错误。应区分 loading、empty、offline、retrying、failed，并把重试放在页面中部。

5. **关注页没有发现入口。** [MarketViews.swift:35-41](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/MarketViews.swift:35) 和 [HomeViews.swift:133-156](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/HomeViews.swift:133) 在没有关注或没有帖子时基本是空白，应提供“发现团长/搜索角色/去关注” CTA。

6. **标签页空结果会显示全站 Feed。** [ProfileViews.swift:2109](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/ProfileViews.swift:2109) 对标签无结果时回退到全部帖子，破坏搜索信任。应显示“该标签暂无内容”和相关标签/搜索入口；标签页也应接服务端分页。

7. **搜索有死入口。** [SearchViews.swift:12-14](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/SearchViews.swift:12) 的“商品” tab 没有对应查询条件；[SearchViews.swift:233-235](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/SearchViews.swift:233) 空提交会默认搜索 “Bucky”，这是不可解释的行为。搜索建议没有 debounce、取消和请求状态。

8. **Feed 缺少小红书核心手势。** 当前只有全屏左右滑切 tab、返回侧滑、评论长按和图片排序拖拽；没有图片区域双击点赞、长按收藏/不感兴趣、卡片显式分享、回到顶部和重复点击 tab 回顶。建议手势优先级固定为：系统 edge-pop > ScrollView 垂直滚动 > 图片双击/长按 > 页面级手势，禁止在整个 ScrollView 上挂竞争性的 `simultaneousGesture`。

9. **页面级横向手势容易误触。** [HomeViews.swift:43-47](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/HomeViews.swift:43)、[PostDetailViews.swift:81-86](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/PostDetailViews.swift:81)、[MessageViews.swift:297-300](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/MessageViews.swift:297) 等把任意横向拖动当作切 tab/返回，会和纵向滚动、图片横滑、输入框、附件面板冲突。应限制起点区域、速度和角度，优先使用系统返回手势。

10. **互动失败状态不可靠。** [MockAppStore.swift:1098-1137](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/MockAppStore.swift:1098) 点赞/收藏先乐观修改；点赞请求失败依赖刷新恢复，关注分支甚至吞掉普通网络错误而不回滚。应有 per-action pending、失败回滚、重试队列和“待同步”状态。

11. **发布草稿入口是断链。** [ProfileViews.swift:1259-1285](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/ProfileViews.swift:1259) 的草稿始终为空，CreatePost 没有自动保存。实现文字、图片引用、合集、角色库存的草稿恢复，或暂时隐藏入口。

12. **发布表单缺少业务校验。** [CreatePostViews.swift:72-82](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/CreatePostViews.swift:72) 只检查“非空”，没有价格上下限、定金 0–100、角色数量 >0、截止日期未来性等校验，也没有定位到第一个错误字段。图片一次保留多份原始 Data，容易造成内存峰值。

13. **发布字段模型有死状态。** [CreatePostViews.swift:24-29](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/CreatePostViews.swift:24) 有独立 `deadline/wechat/qq/groupInfo` 状态，但 UI 不编辑这些值；[MockAppStore.swift:2397-2422](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/MockAppStore.swift:2397) 实际使用合集字段。应删除无效字段，或明确“合集共享信息”并提供编辑入口。

14. **详情评论体验不足。** [PostDetailViews.swift:966-1053](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/PostDetailViews.swift:966) 只有长按动作，没有显式菜单和 VoiceOver action；发送没有清晰的 submitting/failed/retry 状态，评论排序也没有“热门/最新”选择。

15. **聊天首次进入可能停在顶部。** [MessageViews.swift:188-218](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/MessageViews.swift:188) 只在最后一条消息变化时滚到底；已有消息首次进入时可能没有触发变化。应首次加载滚到底，加载历史时保持锚点。

16. **分享链接目前不能可靠落地。** [PostDetailViews.swift:426-428](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/PostDetailViews.swift:426) 和 [ProfileViews.swift:671-673](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/ProfileViews.swift:671) 复制 `zhoubiantuan://`，但 [Info.plist](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/Info.plist) 没有 URL scheme，App 也没有 `onOpenURL` 路由；外部分享应使用 ShareLink + universal link + Web fallback。

17. **删除没有确认/撤销。** [ProfileViews.swift:652-709](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/ProfileViews.swift:652) 帖子和合集删除成本高但没有确认或撤销；应增加 destructive confirmation、处理中状态和短时撤销。

### 响应与性能

18. **图片链路会放大滚动延迟。** [CommonComponents.swift:7-39](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/CommonComponents.swift:7) 禁用 URL cache；[CommonComponents.swift:49-67](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/CommonComponents.swift:49) 每个视图单独下载完整 Data，再在主线程解码，没有共享缓存、下采样、请求去重或预取。一页 30 帖再加头像会产生几十到上百次请求；后端每张图片还要执行一次权限查询。应使用 token-aware actor 图片管线、内存 LRU、磁盘缓存、ImageIO downsample、并发上限、缩略图和可见窗口预取。

19. **Bootstrap 太重。** [backend/src/bootstrap.js:8-51](/Users/rudy2009/Documents/欧美团app/backend/src/bootstrap.js:8) 并发读取 200 帖、200 合集、500 评论、100 举报、完整关系和消息页，随后为帖子再做 4 类计数聚合。[ZhouBianTuanApp.swift:191-200](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/ZhouBianTuanApp.swift:191) 又同时启动公开 Feed 与登录 bootstrap。应把 bootstrap 缩成会话/首屏，内容、评论、关系和消息按页/按需加载，并记录 p50/p95。

20. **每次刷新都绕过缓存。** [BackendClient.swift:469-475](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/BackendClient.swift:469) 使用 reloadIgnoringLocalCacheData，后端也缺少 ETag/条件请求。应对公开首屏使用短 TTL/ETag，对私密资源使用短时授权缓存并保留撤销策略。

21. **首屏瀑布流没有预取和可见窗口。** [HomeViews.swift:160-188](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/HomeViews.swift:160) 每次数据变化都重拆左右列，没有到达底部前预取下一页，图片加载也没有按可见卡片限流。应使用带稳定 ID 的分页数据源和可见窗口预取。

22. **搜索和审核队列会随数据量退化。** [backend/src/contentPages.js:57-64](/Users/rudy2009/Documents/欧美团app/backend/src/contentPages.js:57) 使用 substring + JSON 展开，缺少 trigram/FTS；审核队列 [routes.js:1112-1129](/Users/rudy2009/Documents/欧美团app/backend/src/routes.js:1112) 固定 LIMIT 200、无游标。应使用搜索索引、相关性排序和 keyset 分页。

23. **Feed 计数/用户信息查询过多。** [backend/src/postCounts.js:7-20](/Users/rudy2009/Documents/欧美团app/backend/src/postCounts.js:7) 每页做多次聚合；[contentPages.js:20-27](/Users/rudy2009/Documents/欧美团app/backend/src/contentPages.js:20) 对每个用户做相关计数。长期应使用异步计数读模型或批量聚合，并用 p95/连接池指标决定优化顺序。

### 可靠性、可访问性和工程

24. **固定尺寸阻碍响应式和大字。** 全项目约 380 处固定字号、142 处固定 frame、5 处 `UIScreen.main.bounds`，例如 [HomeViews.swift:164-165](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/HomeViews.swift:164)、[PostDetailViews.swift:42](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/PostDetailViews.swift:42)、[ProfileViews.swift:2137-2145](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/ProfileViews.swift:2137)。iPad、横屏和 Dynamic Type 会挤压或截断。应使用 GeometryReader/size class、@ScaledMetric、语义字体；明确只支持 iPhone 或完成 regular-width 布局。

25. **无障碍标签不完整。** 大量图标按钮没有 accessibilityLabel，选中 tab 只用颜色/下划线表达；例如 [HomeViews.swift:106-111](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/HomeViews.swift:106)。统一 IconButton，命中区域至少 44×44，添加 selected trait、hint 和 VoiceOver action。

26. **动效没有尊重系统设置。** [Theme.swift:60-68](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/Theme.swift:60) 全局使用 spring/位移动画，启动页固定等待 1.25 秒。[ZhouBianTuanApp.swift:205-214](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/ZhouBianTuanApp.swift:205) 应读取 reduceMotion，且启动页不能阻塞首屏可用内容。

27. **网络错误没有统一状态模型。** 多处只调用 `showToast(error.localizedDescription)`；首页首屏错误甚至被吞掉。建议统一 `idle/loading/refreshing/offline/degraded/failed/syncing`，页面内显示恢复入口，互动状态显示 pending/failed/retry。

28. **账号提交仍可重复点击。** [AuthViews.swift:326-338](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/AuthViews.swift:326) 提交按钮没有绑定 submitting 状态，验证码倒计时任务也没有可靠取消/会话绑定。应锁定提交、显示进度、离开页面取消任务。

29. **相册导入会一次请求全部缩略图。** [CreatePostViews.swift:830-843](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/CreatePostViews.swift:830) 没有可见窗口、缓存和取消；大量照片会造成内存峰值。应使用 PHCachingImageManager、网格分页和权限被拒后的“打开设置”入口。

30. **公开 Feed 同步会广播给所有连接。** [backend/src/realtime.js:88-98](/Users/rudy2009/Documents/欧美团app/backend/src/realtime.js:88) 公共事件对所有连接 fan-out，并让每个客户端补全对象。规模增长后会放大 WebSocket、数据库和主线程开销。应改为 feed-version invalidation 或按兴趣/关注分桶。

31. **互动接口缺少动作级限流。** 点赞、收藏、关注和发送消息路由没有和内容提交一样的细粒度频控；幂等只能避免重复行，不能避免恶意高频请求、同步游标和广播被打满。

32. **截止日期排序在服务端和客户端不一致。** [contentPages.js:44-68](/Users/rudy2009/Documents/欧美团app/backend/src/contentPages.js:44) 只按创建时间分页，客户端 [MockAppStore.swift:971-977](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/MockAppStore.swift:971) 才把已结束帖子放到后面。分页后重排会让第 1 页和第 2 页顺序跳变；应由服务端把截止日期策略、排序快照和游标一起定义。

33. **发帖审核仍同步阻塞请求。** [routes.js:459-573](/Users/rudy2009/Documents/欧美团app/backend/src/routes.js:459) 在写入帖子前等待文字/图片审核。审核供应商变慢时客户端会长时间等待；若客户端没有稳定提交键，超时重试仍有产生重复帖子的风险。应拆成创建 pending 任务、后台审核、状态查询/推送。

34. **同步用户补全没有统一拉黑过滤。** [sync.js:130-145](/Users/rudy2009/Documents/欧美团app/backend/src/sync.js:130) 补回用户资料时只检查 active/deleted，和内容 visibility 的双向 block 规则不完全一致。应让同步对象也走同一可见性策略，除非是当前用户的隐私设置专用响应。

35. **匿名 Feed 暴露的资料过多。** [contentPages.js:20-27](/Users/rudy2009/Documents/欧美团app/backend/src/contentPages.js:20) 配合 [mappers.js:3-30](/Users/rudy2009/Documents/欧美团app/backend/src/mappers.js:3) 会向未登录访问者返回地区、生日、性别等画像字段。若保留游客浏览，应为匿名用户使用最小化 mapper，并加反爬与请求频控。

36. **搜索、审核和同步缺少增长后的边界。** 搜索使用 substring/JSON 展开，审核队列固定 200 条且无游标；非法同步 cursor 会静默回到 0，可能触发事件重放。应改为严格参数校验、keyset 分页、FTS/trigram、审核目标复合索引和事件 coalesce。

37. **正常分页需要用户点击“加载更多”。** [ContentPaging.swift:158-188](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/ContentPaging.swift:158) 没有接近底部自动预取；这会打断信息流连续滑动。正常状态应使用 sentinel/onAppear 提前加载，底部只保留加载中、失败重试和真正结束提示。

38. **评论和搜索会在请求完成前显示空态。** [PostDetailViews.swift:984-1006](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/PostDetailViews.swift:984) 和 SearchResultsContent 只看当前数组是否为空，没有使用 page state 的 requestID/isLoaded/error；加载中的用户会先看到“抢首评”或“没有找到”。

39. **本地 Mock 模式的下拉刷新是无效反馈。** [ContentPaging.swift:89-91](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/ContentPaging.swift:89) 在非后端模式直接返回，但 Home/关注/消息仍展示系统 refresh 控件。应禁用该控件或真正刷新本地数据，并明确数据来源。

40. **浏览记录没有真实浏览时间。** [MockAppStore.swift:29-32](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/MockAppStore.swift:29) 只保存帖子 ID，[ProfileViews.swift:1327](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/ProfileViews.swift:1327) 却固定显示“昨天”。应存储 \\{postID, viewedAt\\}，按最近浏览排序并按今天/昨天/日期分组。

## 小红书式 Feed 应如何落地

建议分三步，避免一开始训练复杂模型：

1. **第一阶段：可解释规则排序。**  
   - Following：关注作者的新帖，按新鲜度和截止日期排序。  
   - For You：召回“同 fandom/角色/标签”“你看过的团长”“热门但未看过”“新作者探索”四类候选。  
   - 过滤：下架、拉黑、重复帖子；已结团降权而不是混到最前。  
   - 重排：作者连续帖上限、同标签连续帖上限、探索比例、图片质量、库存可用性、内容完整度。  
   - 返回 `feedVersion`、`rankReason`、`nextCursor` 和算法版本。

2. **第二阶段：行为闭环。**  
   定义事件：`impression`、`open`、`dwell`、`complete`、`like`、`favorite`、`comment`、`follow`、`share`、`notInterested`、`hideAuthor`。曝光必须带 `requestID`、位置、算法版本和内容版本；停留/完读做节流和批量上传，不要每次滚动都打一条请求。设置隐私保留期和删除机制。

3. **第三阶段：可评估的重排。**  
   用离线回放比较“新鲜度、保存率、有效咨询率、负反馈率、重复率、长尾作者曝光”，再做小流量 A/B。不要只优化点赞；这个产品更适合把收藏、私信咨询、库存匹配和有效评论作为主要目标。

## 建议执行顺序

1. 固定 Node 24，重跑干净安装、audit、后端集成和真实 CI；核对生产 commit/迁移/iOS build。
2. 先做图片管线、首页错误/空态、互动失败回滚、草稿链路和发布校验。
3. 把手势改成局部、可发现、可访问的动作，加入双击点赞、长按菜单、回顶、系统分享和 universal link。
4. 实现 Feed 事件契约、Following/For You API、规则召回和排序评估；同时把曝光/停留/负反馈纳入测试。
5. 再做 FTS/trigram、计数读模型、bootstrap 拆分、缓存和公开事件 fan-out 优化。
6. 最后补 UI/XCUITest、弱网/离线、Dynamic Type/VoiceOver、滚动帧率和 Instruments 验收。

## 完成标准

- 首屏 p95、图片首张 p95、滚动 1% low FPS、Feed API p95、同步延迟和 WebSocket fan-out 有基线。
- 网络断开时首页和互动都有明确可恢复状态，不丢草稿，不显示假点赞/假关注。
- 同一账号重复曝光可去重，Feed 能解释为什么推荐，支持不感兴趣和作者屏蔽。
- iPhone 小屏、Dynamic Type、VoiceOver、横屏/iPad（若支持）均有验收记录。
- Node 24 干净安装、依赖 audit、PostgreSQL 集成、iOS 测试和远程 CI 全部通过。

## 补充的用户路径问题

1. **资料保存会过早关闭页面**：`ProfileViews.swift:1799-1810`、`1859-1875` 的保存按钮没有 `isSaving`/进度状态，点击后立即 dismiss；云端失败反馈会在用户已经离开页面后才出现，无法就地重试。简介保存也有同样问题（`ProfileViews.swift:263-268`）。应等待保存结果再关闭，或保留 pending/error/retry 状态；编辑页还强制白底黑字，深色模式下与全局主题断裂。
2. **私信图片预览可能丢失鉴权**：`MessageViews.swift:742-750` 直接用 `URLSession.shared.data(from:)` 访问图片，没有复用带 token 的 `RemoteAssetRequest` 和统一缓存。缩略图能加载时，点开大图仍可能返回 401/404。预览、下载、取消和缓存应共用同一鉴权图片管线。
3. **私信分享卡错误显示播放按钮**：`MessageViews.swift:917-927` 无条件叠加 `play.fill`，项目没有视频模型或播放器，图片会被误认为可播放。应按 `mediaType` 判断，图片使用打开帖子/图片的图标。
4. **私信失败操作不可理解**：`MessageViews.swift:664-670` 的重试按钮只有图标，没有无障碍标签和提示。应把“重试发送”和错误文案组成可读、可操作的控件。
5. **相册导入的部分失败被静默吞掉**：`CreatePostViews.swift:878-896` 某张图片读取失败时直接 `continue`，只要有一张成功就关闭选择器，用户不知道少了哪些图片。应显示成功/失败计数，允许只重试失败项并保留选择状态。
6. **发布前没有预览和自动草稿**：`CreatePostViews.swift:99-334` 只有表单和提交，没有封面裁切、信息流卡片预览、联系方式遮罩、离开确认和自动保存。发布前预览能显著减少提交后才发现封面或信息展示错误的返工。
7. **相册标题带有不可用的下拉暗示**：`PhotoLibraryImportView.swift`（`CreatePostViews.swift:638-643`）“最近项目 + chevron.down”看起来可切换，但没有动作。应实现相册筛选，或移除 chevron。
8. **已结团内容仍可点击且被过度降灰**：`HomeViews.swift:277`、`355-356` 对整张卡片应用饱和度和透明度，文字可读性下降，却没有明确历史状态或查看历史动作。应保留可读信息，明确“已结团”，并在推荐流中降权或分区。
9. **评论操作面板承诺了下拉关闭却没有动作**：`PostDetailViews.swift:1065-1119` 显示 grabber，但没有 `DragGesture`/interactive dismiss；应使用系统 sheet 的拖拽指示器，或实现向下拖动关闭。
10. **图片详情缺少核心查看手势**：`PostDetailViews.swift:37-55` 只有分页滑动，没有 pinch-to-zoom、双指拖拽和长按保存，且外层 drag 与 `TabView` 横滑冲突。商品细节应使用只在图片区域生效的 zoomable gallery，边缘手势再触发返回。
11. **收藏提醒文案会暗示系统通知已经存在**：`MessageViews.swift:38-40` 的文案与 Settings 中“当前无系统通知”（`Settings` 相关代码）不一致。应明确写成“打开 App 查看收藏提醒（暂不支持系统推送）”，并在收藏成功时说明提醒范围。
12. **合集截止日期可以选到过去**：`ProfileViews.swift:1001`、`1037`、`1021-1023` 的 `DatePicker` 没有最小日期限制，`canCreate` 也没有验证 deadline > now；创建后会立刻显示已结团/不可交易状态。应限制为当前时间之后的最小周期，并在服务端再次校验。
13. **角色数量和价格输入会静默变成默认值**：`CreatePostViews.swift:462-469` 使用 `Int(...) ?? 1` 和类似的价格默认解析，空值或非法字符会被当成有效数量/价格，库存可信度会被破坏。应在添加前显示字段错误，拒绝非法数值并限制上下界。
14. **角色列表允许重复名称**：`CreatePostViews.swift:462-467` 直接 append，没有 canonical role key 去重或合并，详情和搜索会出现同角色多行，数量含义不清。应阻止重复、合并同角色数量，并提供编辑入口。
15. **帖子和合集的截止日期来源不一致**：`PostDetailViews.swift:764` 展示 `collection?.deadline ?? post.deadline`，但已结团判断仍可能使用 `post.deadline`，而发布页还会写入独立默认日期。编辑合集后，卡片、详情和可交易状态可能互相矛盾。应确定单一 canonical deadline，或明确继承、覆盖和版本规则。
16. **详情库存编辑缺少逐行校验**：`PostDetailViews.swift:804-833` 的保存按钮没有检查角色名非空、数量大于 0、重复角色和价格范围，`EditableRoleRow`（`872-880`）可提交非法数据。应禁用无效保存，按行显示错误，并在服务端失败时保留编辑内容和重试入口。
17. **外部交易链接不是可操作 CTA**：`PostDetailViews.swift:766` 的“外部表单”只显示 URL 文本，没有打开、复制、失败回退和域名风险提示。应使用 `Link`/复制按钮，校验允许的域名，并记录外链打开失败。
18. **消息入口没有完整的互动收件箱**：`RootView.swift:155-163` 的“消息”主要呈现私信和截团提醒，点赞、评论回复、关注/粉丝、审核结果没有统一活动入口；`unreadMessageCount` 也只统计私信。应拆分互动/通知与私信，聚合未读数量并支持逐条跳转和已读。
19. **评论区只有时间排序和单层列表**：`PostDetailViews.swift:984-1004` 没有按热度/最新切换、楼层折叠、作者回复置顶或评论点赞。长评论区的阅读和互动反馈明显弱于小红书，至少应增加排序、分页和回复层级。
20. **评论删除没有确认或撤销**：`CommentActionOverlay.swift:1092-1096` 长按后直接执行删除，误触不可恢复。应使用 destructive confirmation，或提供短时撤销。
21. **账号限制状态没有接入界面**：模型中的 `isRestricted`、`canShowContact`、`moderationStatus` 没有在实际 Profile/ContactCard 中转成“账号受限、联系方式不可见、审核中”等显式状态，用户会看到空白或不可用按钮却不知道原因。应把限制状态和可执行 CTA 统一建模。

## 预加载与断网浏览专项审计

当前项目没有小红书式的 Feed 预加载和离线 Feed 缓存。具体情况是：

- [`ContentPaging.swift:53-60`](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/ContentPaging.swift:53) 每次只请求当前页，固定 `limit=30`；[`ContentPaging.swift:163-187`](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/ContentPaging.swift:163) 依赖用户点击“加载更多”，没有接近底部时的 sentinel、下一页后台预取或预取并发窗口。
- 首屏公开 Feed 只单独请求 `/feed?limit=40`（[`MockAppStore.swift:355-369`](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/MockAppStore.swift:355)），请求完成后没有持久化 snapshot，也没有用 next cursor 继续预取。
- [`CommonComponents.swift:7-12`](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/CommonComponents.swift:7) 使用 ephemeral URLSession，关闭 URL cache；[`CommonComponents.swift:29`](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/CommonComponents.swift:29) 强制绕过本地和远程缓存。每个 `RemoteImageLoader` 独立下载并完整解码图片，没有共享内存缓存、磁盘缓存、请求合并、下采样或图片预取。
- [`BackendClient.swift:469-475`](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/BackendClient.swift:469) 也设置了 `reloadIgnoringLocalCacheData` 和 `waitsForConnectivity=false`，没有网络状态监测、离线模式或 stale-while-revalidate。
- 本地持久化目前主要覆盖登录状态、搜索/浏览记录和聊天 outbox；[`MockAppStore.swift:326`](/Users/rudy2009/Documents/欧美团app/ZhouBianTuan/MockAppStore.swift:326) 启动时 `posts=[]`，没有帖子/作者/合集 Feed 快照。

所以断网时的真实表现是：如果 App 仍在前台，已经成功加载到内存的当前页（通常 30 条，首屏公开请求可能是 40 条）可能还能继续看；滑到底部继续加载会失败，未成功加载或被回收的图片可能显示失败。杀掉 App、重启或冷启动断网后，基本无法恢复 Feed。现有 `MessageCache` 只服务聊天草稿和待发送消息，不是 Feed 离线缓存。

建议分三层实现：

1. **在线预取**：列表滚动到剩余 5-8 个卡片时，后台拉下一页或 1-2 页；每个 query/tab 保留独立 cursor、任务和取消逻辑，避免重复请求和切 tab 丢状态。
2. **Feed 快照**：将帖子、作者、合集、排序、cursor、revision、更新时间按 query 写入 SQLite/Core Data 或结构化文件。冷启动先展示最近快照，再后台刷新；断网时标记“离线内容”，保留页面内重试入口，并按账号隔离私密数据。
3. **图片管线**：使用 actor 管理内存 LRU 和磁盘缓存，缓存 key 至少包含 objectKey/revision/尺寸/账号权限范围；使用缩略图和 ImageIO downsampling，合并相同请求，限制并发约 4-6 个，提前加载可见区域后 2-3 张图片。私密图片必须有 token 失效和账号切换清理策略。

建议验收：在线打开并滚动两页后开启飞行模式，至少还能继续上滑一页且图片可见；杀掉 App 后在断网状态重新打开，能先显示最近快照并明确标识离线；同一帖子不重复请求、不重复出现，账号切换不泄露上一账号缓存，滚动仍保持 60 FPS。

## 实施复核（2026-10-06）

本报告最初记录的是只读诊断基准；本轮已按报告逐项落实可在当前产品模型中闭环的改动，下面记录真实实现范围与验收边界。

### 已落地

- 登录后的首页改为 `For You` 规则推荐，支持关注作者、标签兴趣、新鲜度、互动、库存、已结束内容降权、已看降权、作者/标签多样性、负反馈和 Following 模式；Feed 使用 6 小时服务端快照和绑定账号/查询/算法版本的游标。
- 新增 Feed 事件契约、90 天事件保留、批量幂等上报、事件限流和点赞/收藏/评论/曝光客户端批处理；点赞、收藏、关注失败会回滚本地状态并提示可恢复。
- 首页按卡片估算高度分配到较短列，使用服务端图片比例，接近底部自动分页和图片/评论预取；切换 tab 不再依赖重建整个滚动树。
- 增加账号隔离的 Feed 快照和远程图片缓存：最近 3 天、首页两个 tab 合计最多 10 个帖子，包含作者、合集、每帖评论和预览/原图/头像资源。退出登录、切换账号、过期和拉黑会清理对应快照/图片。
- 冷启动会先恢复最近快照，再后台刷新；断网时保留快照并显示离线提示。缓存使用原子写入、白名单 URL、请求合并、并发窗口、ImageIO 下采样和磁盘过期清理。
- 发布页增加字段和库存校验；草稿支持账号隔离、自动保存、手动保存、恢复、删除和发布后清理。评论、资料、相册、私信图片、删除确认、系统分享、外链、缩放/双击点赞、卡片长按“不感兴趣/减少团长内容”、局部返回手势和登录重复提交问题已处理。
- 后端 bootstrap 缩小首屏数据，匿名资料最小化，互动接口增加限流；同步游标、Feed 游标、举报快照和读路径索引已加固。依赖升级后官方源 `npm audit` 为 0 项。

### 验收结果

- 后端单元测试：23/23 通过。
- PostgreSQL 16.14 隔离库全量集成测试：43/43 通过；001–026 迁移在全新数据库中全部成功。测试库和临时数据库服务已停止，未修改生产环境。
- iOS Debug 构建通过；iOS Simulator 测试 18/18 通过，包含离线快照账号隔离、3 天过期、图片白名单/账号清理测试；Release Simulator 构建通过。
- `git diff --check` 通过。

### 仍需产品或上线环境确认的边界

- 搜索页原有“商品”标签没有独立的业务筛选含义，已按产品决定移除；当前保留“全部”“拼谷角色”“团长”三个搜索范围，跟团/拼谷仍由现有筛选和首页 Feed 承担。
- 评论“最热/最新”需要后端提供评论点赞聚合字段，目前保留现有时间排序，避免用猜测数据做排序。
- 真机飞行模式验收、滚动帧率/Instruments 指标、Node 24 环境下的 CI 和生产迁移/发布仍需在目标设备和生产流水线执行；本轮没有部署生产。

## 追加体验调整（2026-10-06）

- Feed 卡片提高图片视觉权重：根据源图片比例扩大展示高度，最高约为列宽的 1.62 倍；标题、价格、团长和标签区域同步压缩，瀑布流高度估算与骨架屏保持一致。
- 首页在冷启动和切换“跟团/拼谷”时主动请求第一页，避免依赖旧缓存；接近列表末尾继续分页，批量演示数据可以完整刷完。
- 新增 `backend/scripts/seed-batch-posts.js` 和 `npm --prefix backend run seed:batch`：默认生成 100 条 active 测试帖子、100 条评论、5 个测试团长和关注关系。脚本固定 ID、可重复运行，并拒绝生产环境和非回环数据库；图片使用 App 自带资源，不写线上数据库。
