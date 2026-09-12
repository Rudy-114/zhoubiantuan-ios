import SwiftUI

#if DEBUG
enum AppStoreScreenshotScreen: String, CaseIterable {
    case home
    case detail
    case create
    case profile
    case safety

    static var current: AppStoreScreenshotScreen? {
        guard let value = ProcessInfo.processInfo.environment["ZBT_SCREENSHOT_MODE"] else {
            return nil
        }
        return AppStoreScreenshotScreen(rawValue: value)
    }
}

enum AppStoreScreenshotFixtures {
    static let currentUserID = "screenshot-user-me"
    static let creatorUserID = "screenshot-user-creator"
    static let studioUserID = "screenshot-user-studio"
    static let detailPostID = "screenshot-post-pins"
    static let collectionID = "screenshot-collection-spring"

    static func imageData(named name: String) -> Data? {
        guard let documentsURL = FileManager.default.urls(
            for: .documentDirectory,
            in: .userDomainMask
        ).first else {
            return nil
        }
        return try? Data(
            contentsOf: documentsURL
                .appendingPathComponent("AppStoreScreenshotAssets", isDirectory: true)
                .appendingPathComponent(name)
        )
    }
}

extension MockAppStore {
    func installAppStoreScreenshotFixture() {
        let pinsImage = AppStoreScreenshotFixtures.imageData(named: "merch-enamel-pins.png")
        let standeesImage = AppStoreScreenshotFixtures.imageData(named: "merch-acrylic-standees.png")
        let photocardsImage = AppStoreScreenshotFixtures.imageData(named: "merch-photocard-set.png")
        let linAvatar = AppStoreScreenshotFixtures.imageData(named: "user-avatar-lin.png")
        let momoAvatar = AppStoreScreenshotFixtures.imageData(named: "user-avatar-momo.png")
        let now = Date()
        let deadline = Calendar.current.date(byAdding: .day, value: 18, to: now) ?? now

        let currentUser = User(
            id: AppStoreScreenshotFixtures.currentUserID,
            nickname: "棉花糖研究所",
            bio: "收集原创周边，也记录每一次顺利成团。",
            followingCount: 2,
            followersCount: 128,
            postCount: 2,
            isRestricted: false,
            canShowContact: true,
            avatarSymbol: "棉",
            avatarTint: .rose,
            region: "上海",
            avatarImageData: linAvatar,
            backgroundImageData: pinsImage
        )
        let creator = User(
            id: AppStoreScreenshotFixtures.creatorUserID,
            nickname: "林下作坊",
            bio: "原创制品与小批量拼团，进度会持续更新。",
            followingCount: 36,
            followersCount: 842,
            postCount: 18,
            isRestricted: false,
            canShowContact: true,
            avatarSymbol: "林",
            avatarTint: .teal,
            region: "杭州",
            avatarImageData: momoAvatar,
            backgroundImageData: standeesImage
        )
        let studio = User(
            id: AppStoreScreenshotFixtures.studioUserID,
            nickname: "星轨制品社",
            bio: "把喜欢做成可以触摸的小物。",
            followingCount: 21,
            followersCount: 516,
            postCount: 12,
            isRestricted: false,
            canShowContact: true,
            avatarSymbol: "星",
            avatarTint: .violet,
            region: "成都",
            avatarImageData: linAvatar,
            backgroundImageData: photocardsImage
        )

        let collection = GroupCollection(
            id: AppStoreScreenshotFixtures.collectionID,
            ownerID: AppStoreScreenshotFixtures.currentUserID,
            name: "植物星球春季制品",
            contactWechat: "仅站内沟通",
            contactQQ: "",
            contactGroupNumber: "",
            groupInfo: "成团后统一通知补款，进度持续更新",
            deadline: deadline,
            defaultNote: "满额后统一打样，进度会在合集内更新。",
            postIDs: ["screenshot-post-standees", "screenshot-post-photocards"],
            createdAt: now.addingTimeInterval(-86_400 * 8)
        )
        let creatorCollection = GroupCollection(
            id: "screenshot-collection-pins",
            ownerID: AppStoreScreenshotFixtures.creatorUserID,
            name: "星月徽章春季团",
            contactWechat: "仅站内沟通",
            contactQQ: "",
            contactGroupNumber: "",
            groupInfo: "成团后统一通知补款，进度持续更新",
            deadline: deadline,
            defaultNote: "确认成团后统一通知补款。",
            postIDs: [AppStoreScreenshotFixtures.detailPostID, "screenshot-post-mini-pins"],
            createdAt: now.addingTimeInterval(-86_400 * 10)
        )

        let posts = [
            GroupBuyPost(
                id: AppStoreScreenshotFixtures.detailPostID,
                title: "星月珐琅徽章｜暖银工艺跟团",
                imageNames: ["merch_badges"],
                uploadedImageData: pinsImage.map { [$0] } ?? [],
                authorID: creator.id,
                groupType: .followGroup,
                collectionID: creatorCollection.id,
                categoryTags: ["吧唧", "原创设计", "预售"],
                fandomTags: ["星月收藏"],
                price: "¥36-42",
                deposit: "定金 30%",
                deadline: deadline,
                condition: "满 30 枚成团",
                isFormed: true,
                description: "暖银底色搭配半透明珐琅，边缘做了细闪处理。每枚徽章都会单独装袋，并附保养说明。",
                wechat: "仅站内沟通",
                qq: "",
                groupNumber: "",
                groupInfo: "成团后约 25 天出货",
                externalLink: "",
                createdAt: now.addingTimeInterval(-2_400),
                likedCount: 286,
                favoriteCount: 194,
                commentCount: 23,
                reportCount: 0,
                status: .active,
                imageAspect: 1
            ),
            GroupBuyPost(
                id: "screenshot-post-standees",
                title: "植物星球亚克力立牌拼团",
                imageNames: ["merch_standees"],
                uploadedImageData: standeesImage.map { [$0] } ?? [],
                authorID: currentUser.id,
                groupType: .followGroup,
                collectionID: collection.id,
                categoryTags: ["立牌", "自印团"],
                fandomTags: ["植物星球"],
                price: "¥48-68",
                deposit: "无定金",
                deadline: deadline,
                condition: "满 20 件成团",
                isFormed: false,
                description: "透明亚克力搭配雾面底座，共三款可选。",
                wechat: "仅站内沟通",
                qq: "",
                groupNumber: "",
                groupInfo: "预计截团后 30 天发货",
                externalLink: "",
                createdAt: now.addingTimeInterval(-5_400),
                likedCount: 168,
                favoriteCount: 121,
                commentCount: 15,
                reportCount: 0,
                status: .active,
                imageAspect: 1
            ),
            GroupBuyPost(
                id: "screenshot-post-photocards",
                title: "海岸来信收藏卡套装",
                imageNames: ["merch_photocards"],
                uploadedImageData: photocardsImage.map { [$0] } ?? [],
                authorID: currentUser.id,
                groupType: .followGroup,
                collectionID: collection.id,
                categoryTags: ["小卡", "现货"],
                fandomTags: ["海岸来信"],
                price: "¥29",
                deposit: "无定金",
                deadline: deadline,
                condition: "现货 60 份",
                isFormed: true,
                description: "柔雾膜收藏卡，一套六张并附收纳封套。",
                wechat: "仅站内沟通",
                qq: "",
                groupNumber: "",
                groupInfo: "下单后 7 天内寄出",
                externalLink: "",
                createdAt: now.addingTimeInterval(-9_600),
                likedCount: 139,
                favoriteCount: 88,
                commentCount: 9,
                reportCount: 0,
                status: .active,
                imageAspect: 1
            ),
            GroupBuyPost(
                id: "screenshot-post-mini-pins",
                title: "暮色花园迷你徽章组合",
                imageNames: ["merch_badges"],
                uploadedImageData: pinsImage.map { [$0] } ?? [],
                authorID: studio.id,
                groupType: .followGroup,
                collectionID: creatorCollection.id,
                categoryTags: ["吧唧", "现货"],
                fandomTags: ["暮色花园"],
                price: "¥24-32",
                deposit: "无定金",
                deadline: deadline,
                condition: "现货少量",
                isFormed: true,
                description: "低饱和配色的小尺寸徽章组合。",
                wechat: "仅站内沟通",
                qq: "",
                groupNumber: "",
                groupInfo: "下单后 5 天内寄出",
                externalLink: "",
                createdAt: now.addingTimeInterval(-14_400),
                likedCount: 98,
                favoriteCount: 57,
                commentCount: 6,
                reportCount: 0,
                status: .active,
                imageAspect: 1
            ),
            GroupBuyPost(
                id: "screenshot-post-split",
                title: "星轨角色亚克力拼谷｜余量可选",
                imageNames: ["merch_standees"],
                uploadedImageData: standeesImage.map { [$0] } ?? [],
                authorID: studio.id,
                groupType: .splitGoods,
                collectionID: creatorCollection.id,
                categoryTags: ["立牌", "拼谷"],
                fandomTags: ["星轨计划"],
                price: "¥52-72",
                deposit: "定金 20%",
                deadline: deadline,
                condition: "满 12 组开团",
                isFormed: false,
                description: "三款原创角色立牌，可按余量选择。",
                wechat: "仅站内沟通",
                qq: "",
                groupNumber: "",
                groupInfo: "余量实时更新",
                externalLink: "",
                createdAt: now.addingTimeInterval(-18_000),
                likedCount: 76,
                favoriteCount: 44,
                commentCount: 8,
                reportCount: 0,
                status: .active,
                imageAspect: 1,
                pingguAveragePrice: "¥62",
                pingguNote: "不同款式按工艺小幅调价",
                unsoldRoles: [
                    UnsoldRole(name: "晨星款", quantity: 3),
                    UnsoldRole(name: "月桂款", quantity: 2, priceAdjustment: 6)
                ]
            )
        ]

        isBackendEnabled = false
        isLoggedIn = true
        isDarkModeEnabled = true
        currentUserID = currentUser.id
        users = [currentUser, creator, studio]
        self.posts = posts
        collections = [collection, creatorCollection]
        reviews = []
        comments = [
            Comment(
                id: "screenshot-comment-one",
                body: "颜色很舒服，已经收藏等截团提醒。",
                authorID: studio.id,
                postID: AppStoreScreenshotFixtures.detailPostID,
                replyToID: nil,
                createdAt: now.addingTimeInterval(-1_200),
                status: .active
            )
        ]
        threads = []
        reports = []
        safetyReports = []
        likedPostIDs = [AppStoreScreenshotFixtures.detailPostID, "screenshot-post-photocards"]
        favoritePostIDs = [AppStoreScreenshotFixtures.detailPostID, "screenshot-post-standees"]
        followedUserIDs = [creator.id, studio.id]
        followingIDsByUserID = [
            currentUser.id: [creator.id, studio.id],
            creator.id: [currentUser.id],
            studio.id: [currentUser.id]
        ]
        blockedUserIDs = []
        blockedByUserIDs = []
        browsingHistoryIDs = [AppStoreScreenshotFixtures.detailPostID]
        searchHistory = ["原创徽章", "亚克力立牌"]
    }
}

struct AppStoreScreenshotRoot: View {
    @EnvironmentObject private var store: MockAppStore
    let screen: AppStoreScreenshotScreen

    var body: some View {
        Group {
            if screen == .safety {
                safetyReport
            } else {
                AppStoreScreenshotTabShell(screen: screen)
            }
        }
    }

    private var safetyReport: some View {
        let reportedUser = store.user(id: AppStoreScreenshotFixtures.creatorUserID)
        let source = SafetyReportSourceFactory.user(reportedUser)
        let evidenceItems = AppStoreScreenshotFixtures.imageData(named: "merch-enamel-pins.png")
            .map { [SafetyReportEvidenceItem(data: $0)] } ?? []
        let snapshot = SafetyReportFormSnapshot(
            reporterUserID: store.currentUserID,
            source: source,
            reason: .suspectedScam,
            reportedField: .content,
            detail: "对方要求跳转外部链接并提前转账，页面信息与描述不一致。",
            evidence: SafetyReportEvidenceBuffer(items: evidenceItems),
            blockReportedUser: true,
            clientRequestID: "app-store-screenshot-report"
        )
        return ReportSheet(source: source, initialSnapshot: snapshot) {}
    }
}

private struct AppStoreScreenshotTabShell: View {
    @EnvironmentObject private var store: MockAppStore
    let screen: AppStoreScreenshotScreen
    @State private var selectedTab: AppTab

    init(screen: AppStoreScreenshotScreen) {
        self.screen = screen
        _selectedTab = State(initialValue: screen == .create ? .create : (screen == .profile ? .profile : .home))
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                if screen == .detail {
                    PostDetailView(postID: AppStoreScreenshotFixtures.detailPostID)
                        .withAppDestinations()
                } else {
                    HomeView()
                        .withAppDestinations()
                }
            }
            .tabItem { Label(AppTab.home.title, systemImage: AppTab.home.icon) }
            .tag(AppTab.home)

            NavigationStack {
                MarketView()
                    .withAppDestinations()
            }
            .tabItem { Label(AppTab.market.title, systemImage: AppTab.market.icon) }
            .tag(AppTab.market)

            NavigationStack {
                CreatePostView()
                    .withAppDestinations()
            }
            .tabItem { Label(AppTab.create.title, systemImage: AppTab.create.icon) }
            .tag(AppTab.create)

            NavigationStack {
                MessagesView()
                    .withAppDestinations()
            }
            .tabItem { Label(AppTab.messages.title, systemImage: AppTab.messages.icon) }
            .tag(AppTab.messages)

            NavigationStack {
                ProfileView()
                    .withAppDestinations()
            }
            .tabItem { Label(AppTab.profile.title, systemImage: AppTab.profile.icon) }
            .tag(AppTab.profile)
        }
        .tint(Theme.hotPink)
    }
}
#endif
