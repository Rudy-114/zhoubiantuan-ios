import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var feed: HomeFeed = .followGroup

    var body: some View {
        VStack(spacing: 0) {
            HomeHeader(feed: $feed, onSelect: selectFeed)
            if store.isShowingOfflineFeed {
                HStack(spacing: 7) {
                    Image(systemName: "wifi.slash")
                    Text("离线内容 · 最近同步的帖子和评论")
                    Spacer()
                }
                .font(.caption)
                .foregroundStyle(Theme.subtext)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Theme.panelRaised)
            }
            // Each feed is a real page with its own ScrollView, so the
            // neighbour follows the finger and both keep their scroll position.
            TabView(selection: $feed) {
                ForEach(HomeFeed.allCases) { item in
                    HomeFeedPage(feed: item)
                        .tag(item)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .sensoryFeedback(.selection, trigger: feed)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarHidden(true)
    }

    private func selectFeed(_ nextFeed: HomeFeed) {
        guard feed != nextFeed else { return }
        withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
            feed = nextFeed
        }
    }
}

struct HomeFeedPage: View {
    @EnvironmentObject private var store: MockAppStore
    let feed: HomeFeed

    var pageQuery: ContentQuery {
        .init(parameters: [
            "groupType": feed == .splitGoods ? "splitGoods" : "followGroup",
            "feedMode": "forYou"
        ])
    }

    var posts: [GroupBuyPost] {
        // The backend ranks `/feed?feedMode=forYou` and keeps a snapshot, so its
        // order is used as is. Only the offline mock data is ranked on device.
        if store.isBackendEnabled { return store.pagePosts(pageQuery) }
        let candidates = switch feed {
        case .followGroup:
            store.sortedFeedPosts(store.activePosts.filter { $0.groupType == .followGroup })
        case .splitGoods:
            store.sortedFeedPosts(store.activePosts.filter { $0.groupType == .splitGoods })
        }
        return store.recommendedFeedPosts(candidates, for: pageQuery)
    }

    var body: some View {
        PullToRefreshScrollView {
            VStack(spacing: 0) {
                if posts.isEmpty && (store.isLoadingInitialFeed || store.pageState(pageQuery).requestID != nil) {
                    HomeFeedSkeletonGrid()
                        .padding(.horizontal, 12)
                        .padding(.top, 12)
                        .padding(.bottom, 28)
                } else if posts.isEmpty {
                    HomeFeedStateView(error: store.pageState(pageQuery).error,
                                      isOffline: store.isShowingOfflineFeed,
                                      onRetry: {
                                          Task { await store.loadContentPage(pageQuery, reset: true) }
                                      })
                    .padding(.horizontal, 28)
                    .padding(.top, 100)
                } else {
                    WaterfallGrid(posts: posts, onNearEnd: {
                        store.prefetchFeedAssets(for: Array(posts.suffix(10)))
                        Task { await store.loadContentPage(pageQuery) }
                    })
                        .padding(.horizontal, 12)
                        .padding(.top, 12)
                        .padding(.bottom, 28)
                }
                ContentPageFooter(query: pageQuery)
            }
        } action: {
            await store.refreshHomeFeed(pageQuery)
        }
        .task(id: "\(store.authSessionVersion)-\(store.contentPageEpoch)-\(pageQuery.key)") {
            // Only load a feed that has never been loaded. Returning from a
            // detail page or switching pages must keep the current list, order
            // and scroll position; pull-to-refresh and retry start a new page.
            let state = store.pageState(pageQuery)
            guard !state.isLoaded, state.requestID == nil else { return }
            await store.loadContentPage(pageQuery, reset: true)
        }
    }
}

struct HomeFeedStateView: View {
    let error: String?
    let isOffline: Bool
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: isOffline ? "wifi.slash" : (error == nil ? "sparkles" : "arrow.clockwise.circle"))
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(Theme.accentSoft)
            Text(isOffline ? "当前没有可用的离线内容" : (error == nil ? "还没有相关帖子" : "内容加载失败"))
                .font(AppFont.headline.weight(.bold))
                .foregroundStyle(Theme.text)
            Text(isOffline ? "联网后刷新即可继续浏览" : (error ?? "换个分类或稍后再试"))
                .font(.subheadline)
                .foregroundStyle(Theme.subtext)
                .multilineTextAlignment(.center)
            Button("重新加载", action: onRetry)
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .accessibilityHint("重新请求当前信息流")
        }
        .frame(maxWidth: .infinity)
    }
}

enum HomeFeed: String, CaseIterable, Identifiable, Hashable {
    case followGroup = "跟团"
    case splitGoods = "拼谷"

    var id: String { rawValue }
}

struct HomeHeader: View {
    @Binding var feed: HomeFeed
    let onSelect: (HomeFeed) -> Void
    @Namespace private var indicator

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Color.clear
                    .frame(width: 44, height: 44)
                Spacer()
                HStack(spacing: 28) {
                    ForEach(HomeFeed.allCases) { item in
                        Button {
                            onSelect(item)
                        } label: {
                            VStack(spacing: 7) {
                                Text(item.rawValue)
                                    .font(AppFont.title.weight(feed == item ? .bold : .semibold))
                                    .foregroundStyle(feed == item ? Theme.text : Theme.subtext)
                                if feed == item {
                                    Capsule()
                                        .fill(Theme.accent)
                                        .frame(width: 40, height: 4)
                                        .matchedGeometryEffect(id: "home-feed-indicator", in: indicator)
                                } else {
                                    Color.clear
                                        .frame(width: 40, height: 4)
                                }
                            }
                        }
                        .accessibilityAddTraits(feed == item ? .isSelected : [])
                        .buttonStyle(.pressFeedback)
                    }
                }
                Spacer()
                NavigationLink(value: Route.search) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("搜索")
                .buttonStyle(.pressFeedback)
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
            .padding(.bottom, 2)

            Divider().overlay(Theme.hairline)
        }
        .background(Theme.background)
    }
}

struct FollowingFeedView: View {
    @EnvironmentObject private var store: MockAppStore
    let posts: [GroupBuyPost]

    var followedUsers: [User] {
        store.users.filter { store.followedUserIDs.contains($0.id) }
    }

    var body: some View {
        VStack(spacing: 16) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 26) {
                    ForEach(followedUsers) { user in
                        NavigationLink(value: Route.userProfile(user.id)) {
                            VStack(spacing: 10) {
                                AvatarView(user: user, size: 76)
                                Text(user.nickname)
                                    .font(AppFont.callout)
                                    .foregroundStyle(Theme.text.opacity(0.88))
                                    .lineLimit(1)
                                    .frame(width: 92)
                            }
                        }
                        .buttonStyle(.pressFeedback)
                    }
                }
                .padding(.horizontal, 28)
                .padding(.top, 20)
            }

            WaterfallGrid(posts: posts)
                .padding(.horizontal, 12)
                .padding(.bottom, 28)
        }
    }
}

struct WaterfallGrid: View {
    let posts: [GroupBuyPost]
    var onNearEnd: (() -> Void)? = nil
    private let spacing: CGFloat = FeedCardMetrics.columnSpacing

    private var columnWidth: CGFloat {
        FeedCardMetrics.columnWidth(screenWidth: UIScreen.main.bounds.width)
    }

    private var columns: [[GroupBuyPost]] {
        var result = [[], []] as [[GroupBuyPost]]
        var heights = [CGFloat.zero, .zero]
        for post in posts {
            let column = heights[0] <= heights[1] ? 0 : 1
            result[column].append(post)
            heights[column] += estimatedHeight(for: post) + 14
        }
        return result
    }

    private func estimatedHeight(for post: GroupBuyPost) -> CGFloat {
        let imageHeight = FeedCardMetrics.feedImageHeight(for: columnWidth, aspect: post.imageAspect)
        let titleLines = post.title.count > 18 ? 2 : 1
        let tagHeight: CGFloat = post.categoryTags.isEmpty ? 0 : 22
        return imageHeight + CGFloat(titleLines) * 19 + 76 + tagHeight
    }

    var body: some View {
        let columns = self.columns
        HStack(alignment: .top, spacing: 12) {
            LazyVStack(spacing: 14) {
                ForEach(columns[0]) { post in
                    PostCard(post: post, cardWidth: columnWidth)
                        .onAppear { notifyIfNearEnd(post) }
                }
            }
            LazyVStack(spacing: 14) {
                ForEach(columns[1]) { post in
                    PostCard(post: post, cardWidth: columnWidth)
                        .onAppear { notifyIfNearEnd(post) }
                }
            }
        }
    }

    private func notifyIfNearEnd(_ post: GroupBuyPost) {
        guard let onNearEnd,
              let triggerID = posts.dropLast(min(5, posts.count)).last?.id,
              post.id == triggerID else { return }
        onNearEnd()
    }
}

struct HomeFeedSkeletonGrid: View {
    private let spacing: CGFloat = FeedCardMetrics.columnSpacing

    private var columnWidth: CGFloat {
        FeedCardMetrics.columnWidth(screenWidth: UIScreen.main.bounds.width)
    }

    var body: some View {
        HStack(alignment: .top, spacing: spacing) {
            LazyVStack(spacing: 14) {
                ForEach(0..<3, id: \.self) { index in
                    HomeFeedSkeletonCard(cardWidth: columnWidth, imageRatio: index == 1 ? 1.12 : 1)
                }
            }
            LazyVStack(spacing: 14) {
                ForEach(0..<3, id: \.self) { index in
                    HomeFeedSkeletonCard(cardWidth: columnWidth, imageRatio: index == 0 ? 1.08 : 1)
                }
            }
        }
        .allowsHitTesting(false)
    }
}

struct HomeFeedSkeletonCard: View {
    let cardWidth: CGFloat
    var imageRatio: CGFloat = 1

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
                .fill(Theme.hairline.opacity(0.55))
                .frame(width: cardWidth, height: FeedCardMetrics.feedImageHeight(for: cardWidth) * imageRatio)

            VStack(alignment: .leading, spacing: 10) {
                RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
                    .fill(Theme.hairline.opacity(0.65))
                    .frame(width: cardWidth * 0.72, height: 14)
                RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
                    .fill(Theme.hairline.opacity(0.45))
                    .frame(width: cardWidth * 0.48, height: 12)
                HStack(spacing: 7) {
                    Circle()
                        .fill(Theme.hairline.opacity(0.65))
                        .frame(width: 24, height: 24)
                    RoundedRectangle(cornerRadius: Radius.control, style: .continuous)
                        .fill(Theme.hairline.opacity(0.45))
                        .frame(width: cardWidth * 0.42, height: 11)
                    Spacer(minLength: 0)
                }
            }
            .padding(10)
        }
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .stroke(Theme.hairline, lineWidth: 0.5)
        }
        .frame(width: cardWidth)
        .redacted(reason: .placeholder)
    }
}

enum FeedCardMetrics {
    static let horizontalPadding: CGFloat = 12
    static let columnSpacing: CGFloat = 12
    static let imageAspect: CGFloat = 0.75

    static func columnWidth(screenWidth: CGFloat) -> CGFloat {
        (screenWidth - horizontalPadding * 2 - columnSpacing) / 2
    }

    static func imageHeight(for width: CGFloat) -> CGFloat {
        width / imageAspect
    }

    static func imageHeight(for width: CGFloat, aspect: Double) -> CGFloat {
        let ratio = CGFloat(min(max(aspect, 0.56), 1.8))
        return min(width / ratio, width * 1.55)
    }

    /// Feed cards give the image more visual weight than the source asset's
    /// exact ratio. The image is still cropped with `.scaledToFill`, while a
    /// conservative cap keeps very tall portrait assets from taking over the
    /// entire feed. This matches the compact title treatment below and keeps
    /// the card closer to a Xiaohongshu-style visual rhythm.
    static func feedImageHeight(for width: CGFloat, aspect: Double) -> CGFloat {
        let sourceRatio = CGFloat(min(max(aspect, 0.56), 1.8))
        let feedRatio = min(max(sourceRatio * 0.82, 0.58), 1.15)
        return min(width / feedRatio, width * 1.62)
    }

    static func feedImageHeight(for width: CGFloat) -> CGFloat {
        feedImageHeight(for: width, aspect: Double(imageAspect))
    }
}

struct PostCard: View {
    @EnvironmentObject private var store: MockAppStore
    let post: GroupBuyPost
    let cardWidth: CGFloat

    var body: some View {
        let livePost = store.post(id: post.id) ?? post
        let author = store.user(id: livePost.authorID)
        let isEnded = livePost.isEnded
        ZStack(alignment: .bottomTrailing) {
            NavigationLink(value: Route.postDetail(livePost.id)) {
                VStack(alignment: .leading, spacing: 0) {
                    ZStack {
                        PostImageView(post: livePost, preferPreview: true, maxPixelSize: ImagePipeline.Tier.card)
                            .scaledToFill()
                            .frame(width: cardWidth, height: FeedCardMetrics.feedImageHeight(for: cardWidth, aspect: livePost.imageAspect))
                            .clipped()
                        if isEnded {
                            // F22: dim only the image; the text below stays readable.
                            Color.black.opacity(0.35)
                        }
                    }
                    .frame(width: cardWidth, height: FeedCardMetrics.feedImageHeight(for: cardWidth, aspect: livePost.imageAspect))
                    .overlay(alignment: .top) {
                        // One row so the two badges can never overlap; capped so
                        // large text sizes do not cover the cover image.
                        HStack(spacing: 6) {
                            PostCardTypeBadge(post: livePost)
                                .layoutPriority(1)
                            Spacer(minLength: 0)
                            PostCardDeadlineBadge(text: isEnded ? "已结团" : livePost.deadline.shortDeadlineText)
                        }
                        .padding(8)
                        .dynamicTypeSize(...DynamicTypeSize.xLarge)
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text(livePost.title)
                            .font(AppFont.callout.weight(.semibold))
                            .foregroundStyle(isEnded ? Theme.subtext : Theme.text)
                            .lineLimit(2)
                            .lineSpacing(-1.5)
                            .minimumScaleFactor(0.88)
                            .fixedSize(horizontal: false, vertical: true)

                        ModerationStatusBadge(status: livePost.status, reason: livePost.moderationReason)

                        if livePost.groupType == .splitGoods {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(livePost.pingguAveragePrice.isEmpty ? livePost.price : livePost.pingguAveragePrice)
                                    .font(AppFont.price)
                                    .foregroundStyle(livePost.groupType.accent)
                                if !livePost.pingguNote.isEmpty {
                                    Text(livePost.pingguNote)
                                        .font(AppFont.badge.weight(.medium))
                                        .foregroundStyle(Theme.subtext)
                                        .lineLimit(1)
                                }
                            }
                            .padding(7)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(livePost.groupType.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
                        }

                        if !livePost.categoryTags.isEmpty {
                            HStack(spacing: 5) {
                                ForEach(livePost.categoryTags.prefix(2), id: \.self) { tag in
                                    Text(tag)
                                        .font(AppFont.badge)
                                        .foregroundStyle(Theme.tagText)
                                        .padding(.horizontal, 7)
                                        .padding(.vertical, 3)
                                        .background(Theme.accent.opacity(0.13), in: Capsule())
                                }
                            }
                        }

                        HStack(spacing: 6) {
                            AvatarView(user: author, size: 22)
                            Text(author.nickname)
                                .font(AppFont.caption)
                                .foregroundStyle(Theme.subtext)
                                .lineLimit(1)
                            Spacer(minLength: 4)
                            Color.clear
                                .frame(width: 72, height: 28)
                        }
                    }
                    .padding(.horizontal, 9)
                    .padding(.vertical, 8)
                }
                .background(Theme.panel, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                // The cover image shares the card's rounded corners.
                .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                        .stroke(Theme.hairline, lineWidth: 0.5)
                }
                .frame(width: cardWidth)
            }
            .buttonStyle(.pressFeedback)
            // F16: VoiceOver reads the card as one link; liking is a custom action.
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(cardAccessibilityLabel(livePost, author: author, isEnded: isEnded))
            .accessibilityAddTraits(.isLink)
            .accessibilityAction(named: store.likedPostIDs.contains(livePost.id) ? "取消点赞" : "点赞") {
                guard !isEnded else { return }
                store.toggleLike(postID: livePost.id)
            }
            .contextMenu {
                Button {
                    store.markFeedPostNotInterested(livePost.id)
                } label: {
                    Label("不感兴趣", systemImage: "hand.thumbsdown")
                }
                Button {
                    store.hideFeedAuthor(livePost.authorID, postID: livePost.id)
                } label: {
                    Label("减少该团长内容", systemImage: "person.slash")
                }
            }

            if !isEnded {
                // The author row is always the card's last line; the reserved
                // 72x28 slot there lines the button up with the avatar.
                PostLikeCountButton(postID: livePost.id)
                    .padding(.trailing, 8)
                    .padding(.bottom, 6)
                    .accessibilityHidden(true)
            }
        }
        .frame(width: cardWidth)
        .onAppear {
            store.recordFeedEvent("impression", postID: livePost.id)
        }
        .scrollTransition(.animated(.easeOut(duration: 0.18))) { content, phase in
            content
                .opacity(phase.isIdentity ? 1 : 0.9)
                .scaleEffect(phase.isIdentity ? 1 : 0.985)
        }
    }
}

extension PostCard {
    func cardAccessibilityLabel(_ post: GroupBuyPost, author: User, isEnded: Bool) -> String {
        let price = post.groupType == .splitGoods && !post.pingguAveragePrice.isEmpty ? post.pingguAveragePrice : post.price
        let deadline = isEnded ? "已结团" : "截止 \(post.deadline.shortDeadlineText)"
        return [post.groupType.rawValue, post.title, price, "团长 \(author.nickname)", deadline,
                "\(post.likedCount.formattedCount) 赞"]
            .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            .joined(separator: "，")
    }
}

struct PostCardTypeBadge: View {
    let post: GroupBuyPost

    var body: some View {
        Label(post.groupType.rawValue, systemImage: post.groupType.icon)
            .font(AppFont.badge)
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.82)
            .padding(.horizontal, 9)
            .frame(minHeight: 28)
            .background(post.groupType == .followGroup ? Theme.accentFill : post.groupType.accent.opacity(0.94), in: Capsule())
    }
}

struct PostCardDeadlineBadge: View {
    let text: String

    var body: some View {
        Text(text)
            .font(AppFont.badge)
            .foregroundStyle(Theme.floatingBadgeText)
            .lineLimit(1)
            .minimumScaleFactor(0.78)
            .padding(.horizontal, 9)
            .frame(minHeight: 28)
            .background(Theme.floatingBadgeBackground, in: Capsule())
    }
}

struct PostLikeCountButton: View {
    @EnvironmentObject private var store: MockAppStore
    let postID: String
    /// Haptics follow the user's tap, not the like state, so a sync update or
    /// a failed-request rollback does not buzz.
    @State private var tapCount = 0

    private var post: GroupBuyPost? {
        store.post(id: postID)
    }

    private var isLiked: Bool {
        store.likedPostIDs.contains(postID)
    }

    var body: some View {
        Button {
            tapCount += 1
            withAnimation(.spring(response: 0.22, dampingFraction: 0.72)) {
                store.toggleLike(postID: postID)
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: isLiked ? "heart.fill" : "heart")
                    .font(.system(size: 17, weight: .semibold))
                    .symbolEffect(.bounce, value: isLiked)
                Text((post?.likedCount ?? 0).formattedCount)
                    .font(AppFont.caption.weight(.semibold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            }
            .foregroundStyle(isLiked ? Theme.accent : Theme.subtext)
            .frame(minWidth: 68, minHeight: 32, alignment: .trailing)
            .contentShape(Rectangle())
        }
        .buttonStyle(.pressFeedback)
        .sensoryFeedback(.impact(weight: .light), trigger: tapCount)
        .accessibilityLabel(isLiked ? "取消点赞" : "点赞")
        .accessibilityValue((post?.likedCount ?? 0).formattedCount)
    }
}

struct LegalSection: Identifiable {
    let title: String
    let body: String
    var id: String { title }
}

enum LegalDocument: String, CaseIterable, Identifiable {
    case userAgreement
    case privacyPolicy
    case minorsPolicy
    case personalInfoList
    case thirdPartySharingList

    var id: String { rawValue }

    var shortTitle: String {
        switch self {
        case .userAgreement: return "用户协议"
        case .privacyPolicy: return "隐私政策"
        case .minorsPolicy: return "未成年人个人信息保护规则"
        case .personalInfoList: return "个人信息收集清单"
        case .thirdPartySharingList: return "第三方信息共享清单"
        }
    }

    var title: String {
        switch self {
        case .userAgreement: return "周边团用户服务协议"
        case .privacyPolicy: return "周边团用户隐私政策"
        case .minorsPolicy: return "未成年人个人信息保护规则"
        case .personalInfoList: return "个人信息收集清单"
        case .thirdPartySharingList: return "第三方信息共享清单"
        }
    }

    var sections: [LegalSection] {
        switch self {
        case .userAgreement:
            return [
                LegalSection(title: "服务范围", body: "周边团提供团购信息发布、浏览、收藏、评论、私信沟通、举报和账号管理等信息服务。平台不直接承接支付、订单、退款、物流或售后，正式交易请在团长和用户确认的外部渠道完成。"),
                LegalSection(title: "账号使用", body: "你需要使用真实可接收邮件的邮箱注册或登录，并妥善保管密码和验证码。请勿冒用他人身份、发布违法或侵权内容，或通过自动化方式干扰平台正常运行。"),
                LegalSection(title: "内容责任", body: "你发布的帖子、评论、图片、联系方式和私信应由你自行确认合法、真实、清晰。平台可以基于用户举报、风险控制或法律要求，对违规内容采取隐藏、下架、限制账号等处理。"),
                LegalSection(title: "风险提示", body: "团购信息具有时效性和交易风险。请在付款前核对团长身份、商品信息、价格、截团时间、补款规则和售后安排，避免脱离可追溯沟通记录进行高风险交易。")
            ]
        case .privacyPolicy:
            return [
                LegalSection(title: "我们收集的信息", body: "为提供账号和社区功能，我们会收集账号标识、邮箱、昵称、个人资料、你主动填写的外部联系方式、你发布的帖子、评论、私信、举报内容、点赞收藏等互动记录，以及你主动选择上传的图片。"),
                LegalSection(title: "使用目的", body: "这些信息用于注册登录、验证码发送、账号展示、内容发布、互动通知、私信沟通、内容安全、举报处理、反滥用、客服支持和基础运营维护。"),
                LegalSection(title: "存储与安全", body: "账号密码以哈希形式保存，登录状态使用令牌维护。图片上传到云存储；基础错误日志和短期反滥用哈希用于保障服务安全。后端密钥不会放入 iOS 客户端。"),
                LegalSection(title: "你的选择", body: "你可以退出登录、编辑资料、删除本地浏览记录，或在「设置 - 账号与安全 - 删除账号」中直接删除账号。如需更正信息或寻求帮助，可在「设置 - 帮助与反馈」通过客服邮箱联系我们。我们不会将上述信息用于跨 App 或跨网站追踪。")
            ]
        case .minorsPolicy:
            return [
                LegalSection(title: "监护人同意", body: "未成年人使用本服务前，应取得父母或其他监护人的同意，并在监护人指导下理解团购信息、个人信息保护和网络交易风险。"),
                LegalSection(title: "最小必要", body: "平台仅围绕账号、内容发布和沟通功能处理必要信息。未成年人不应公开发布身份证件、住址、学校、银行卡、精确定位等敏感信息。"),
                LegalSection(title: "交易提醒", body: "未成年人不应独立进行高金额或高风险交易。涉及付款、补款、退款或线下见面时，应由监护人参与判断并保留沟通凭证。"),
                LegalSection(title: "保护请求", body: "监护人如发现未成年人信息被不当展示或使用，可以在「设置 - 帮助与反馈」通过客服邮箱联系我们处理。")
            ]
        case .personalInfoList:
            return [
                LegalSection(title: "账号与联系信息", body: "内部账号标识和邮箱用于注册、登录和验证码发送；昵称、头像、简介、地区、小红书号以及你主动填写的微信、QQ、群号等资料用于账号展示和社区沟通。"),
                LegalSection(title: "用户内容", body: "帖子、评论、私信、举报理由和详情用于展示、沟通、内容管理和安全处理。"),
                LegalSection(title: "互动与安全信息", body: "点赞、收藏、关注、拉黑、举报和内容处理记录用于提供社区功能并防止滥用；服务器会短期保存不可逆的反滥用哈希。"),
                LegalSection(title: "图片信息", body: "你主动选择的商品图片、头像或背景图会用于帖子和资料展示。App 只在你选择图片时访问相册。"),
                LegalSection(title: "本地偏好", body: "App 使用 UserDefaults 保存登录状态、深色模式、浏览记录、搜索历史、后端调试偏好等仅本 App 可访问的信息。")
            ]
        case .thirdPartySharingList:
            return [
                LegalSection(title: "云服务", body: "后端部署在云服务器，数据库和对象存储用于保存账号、内容和图片。邮件服务用于发送注册和登录验证码。"),
                LegalSection(title: "外部交易渠道", body: "帖子中可能展示微信、QQ、群聊或表单链接等外部联系方式。你离开本 App 后的信息处理和交易规则由相应第三方或团长负责。"),
                LegalSection(title: "法定披露", body: "如法律法规、监管要求、司法机关或平台安全处置需要，我们可能在必要范围内提供相关信息。"),
                LegalSection(title: "不用于追踪", body: "本应用不接入广告追踪 SDK，不将收集的信息用于跨 App 或跨网站追踪。")
            ]
        }
    }
}
