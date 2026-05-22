import SwiftUI
import UIKit
import Photos
import PhotosUI
import Security
import UniformTypeIdentifiers

enum ImageDataNormalizer {
    static func jpegData(from data: Data, maxSide: CGFloat = 1800, compressionQuality: CGFloat = 0.8) -> Data {
        guard let image = UIImage(data: data) else { return data }
        return jpegData(from: image, maxSide: maxSide, compressionQuality: compressionQuality) ?? data
    }

    static func jpegData(from image: UIImage, maxSide: CGFloat = 1800, compressionQuality: CGFloat = 0.8) -> Data? {
        let sourceSize = image.size
        guard sourceSize.width > 0, sourceSize.height > 0 else {
            return image.jpegData(compressionQuality: compressionQuality)
        }

        let longestSide = max(sourceSize.width, sourceSize.height)
        let scale = min(1, maxSide / max(longestSide, 1))
        let targetSize = CGSize(width: sourceSize.width * scale, height: sourceSize.height * scale)

        guard scale < 1 || image.imageOrientation != .up else {
            return image.jpegData(compressionQuality: compressionQuality)
        }

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: targetSize, format: format)
        let renderedImage = renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: targetSize))
        }
        return renderedImage.jpegData(compressionQuality: compressionQuality)
    }
}

@main
struct ZhouBianTuanApp: App {
    @StateObject private var store = MockAppStore()

    init() {
        let tabAppearance = UITabBarAppearance()
        tabAppearance.configureWithOpaqueBackground()
        tabAppearance.backgroundColor = Theme.barBackgroundUIColor
        tabAppearance.stackedLayoutAppearance.normal.iconColor = UIColor.secondaryLabel
        tabAppearance.stackedLayoutAppearance.normal.titleTextAttributes = [.foregroundColor: UIColor.secondaryLabel]
        tabAppearance.stackedLayoutAppearance.selected.iconColor = UIColor(red: 1, green: 0.12, blue: 0.27, alpha: 1)
        tabAppearance.stackedLayoutAppearance.selected.titleTextAttributes = [.foregroundColor: Theme.primaryTextUIColor]
        UITabBar.appearance().standardAppearance = tabAppearance
        UITabBar.appearance().scrollEdgeAppearance = tabAppearance

        let navAppearance = UINavigationBarAppearance()
        navAppearance.configureWithOpaqueBackground()
        navAppearance.backgroundColor = Theme.barBackgroundUIColor
        navAppearance.titleTextAttributes = [.foregroundColor: Theme.primaryTextUIColor]
        navAppearance.largeTitleTextAttributes = [.foregroundColor: Theme.primaryTextUIColor]
        UINavigationBar.appearance().standardAppearance = navAppearance
        UINavigationBar.appearance().scrollEdgeAppearance = navAppearance
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .tint(Theme.hotPink)
                .preferredColorScheme(store.isDarkModeEnabled ? .dark : .light)
        }
    }
}

enum AppTab: String, CaseIterable, Identifiable {
    case home
    case market
    case create
    case messages
    case profile

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: "首页"
        case .market: "关注"
        case .create: "发布"
        case .messages: "消息"
        case .profile: "我"
        }
    }

    var icon: String {
        switch self {
        case .home: "house.fill"
        case .market: "fanblades"
        case .create: "plus.app.fill"
        case .messages: "bubble.left.and.bubble.right.fill"
        case .profile: "person.fill"
        }
    }
}

enum UserRelationKind: String, Hashable {
    case following
    case followers

    var title: String {
        switch self {
        case .following: "关注"
        case .followers: "粉丝"
        }
    }

    var emptyText: String {
        switch self {
        case .following: "还没有关注卖家"
        case .followers: "还没有粉丝"
        }
    }
}

enum Route: Hashable {
    case search
    case postDetail(String)
    case collectionDetail(String)
    case tag(String)
    case chat(String)
    case userProfile(String)
    case userRelations(String, UserRelationKind)
    case editProfile
    case favorites
    case reminders
    case drafts
    case browsingHistory
    case settings
    case accountSecuritySettings
    case generalSettings
    case notificationSettings
    case admin
}

struct RootView: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var selectedTab: AppTab = .home

    private var isAuthenticated: Bool {
        store.isLoggedIn
    }

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            TabView(selection: $selectedTab) {
                NavigationStack {
                    HomeView()
                        .withAppDestinations()
                }
                .tabItem { Label(AppTab.home.title, systemImage: AppTab.home.icon) }
                .tag(AppTab.home)

                NavigationStack {
                    AuthenticatedTabContent {
                        MarketView()
                    }
                        .withAppDestinations()
                }
                .tabItem { Label(AppTab.market.title, systemImage: AppTab.market.icon) }
                .tag(AppTab.market)

                NavigationStack {
                    AuthenticatedTabContent {
                        CreatePostView()
                    }
                        .withAppDestinations()
                }
                .tabItem { Label(AppTab.create.title, systemImage: AppTab.create.icon) }
                .tag(AppTab.create)

                NavigationStack {
                    AuthenticatedTabContent {
                        MessagesView()
                    }
                        .withAppDestinations()
                }
                .tabItem { Label(AppTab.messages.title, systemImage: AppTab.messages.icon) }
                .tag(AppTab.messages)

                NavigationStack {
                    AuthenticatedTabContent {
                        ProfileView()
                    }
                        .withAppDestinations()
                }
                .tabItem { Label(AppTab.profile.title, systemImage: AppTab.profile.icon) }
                .tag(AppTab.profile)
            }
            .id("\(store.authSessionVersion)-\(isAuthenticated)")
            .tint(Theme.hotPink)
            .overlay(alignment: .top) {
                ToastHost()
            }
            .fullScreenCover(isPresented: $store.isAuthPromptPresented) {
                GuestAuthView(onClose: {
                    store.isAuthPromptPresented = false
                })
                .environmentObject(store)
                .preferredColorScheme(.dark)
            }
            .onChange(of: store.isLoggedIn) {
                if store.isLoggedIn {
                    store.isAuthPromptPresented = false
                }
            }
            .task {
                await store.loadBackendIfNeeded()
            }
        }
    }
}

struct AuthenticatedTabContent<Content: View>: View {
    @EnvironmentObject private var store: MockAppStore
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        if store.isLoggedIn {
            content
        } else {
            GuestAuthView()
        }
    }
}

extension View {
    func withAppDestinations() -> some View {
        navigationDestination(for: Route.self) { route in
            switch route {
            case .search:
                SearchView()
            case .postDetail(let id):
                PostDetailView(postID: id)
            case .collectionDetail(let id):
                CollectionDetailView(collectionID: id)
            case .tag(let tag):
                TagContentView(tag: tag)
            case .chat(let id):
                ChatView(threadID: id)
            case .userProfile(let id):
                UserProfileView(userID: id)
            case .userRelations(let id, let kind):
                UserRelationListView(userID: id, kind: kind)
            case .editProfile:
                EditProfileView()
            case .favorites:
                FavoritesView()
            case .reminders:
                ReminderCenterView()
            case .drafts:
                DraftsView()
            case .browsingHistory:
                BrowsingHistoryView()
            case .settings:
                SettingsView()
            case .accountSecuritySettings:
                AccountSecuritySettingsView()
            case .generalSettings:
                GeneralSettingsView()
            case .notificationSettings:
                NotificationSettingsView()
            case .admin:
                AdminReportView()
            }
        }
    }
}

enum Theme {
    static let background = Color(adaptiveUIColor(
        dark: UIColor(red: 0.055, green: 0.055, blue: 0.075, alpha: 1),
        light: UIColor.white
    ))
    static let panel = Color(adaptiveUIColor(
        dark: UIColor(red: 0.095, green: 0.095, blue: 0.12, alpha: 1),
        light: UIColor(red: 0.965, green: 0.965, blue: 0.975, alpha: 1)
    ))
    static let panelRaised = Color(adaptiveUIColor(
        dark: UIColor(red: 0.13, green: 0.13, blue: 0.16, alpha: 1),
        light: UIColor(red: 0.92, green: 0.92, blue: 0.94, alpha: 1)
    ))
    static let hairline = Color(adaptiveUIColor(
        dark: UIColor.white.withAlphaComponent(0.08),
        light: UIColor.black.withAlphaComponent(0.10)
    ))
    static let text = Color(adaptiveUIColor(
        dark: UIColor.white.withAlphaComponent(0.92),
        light: UIColor.black.withAlphaComponent(0.88)
    ))
    static let subtext = Color(adaptiveUIColor(
        dark: UIColor.white.withAlphaComponent(0.58),
        light: UIColor.black.withAlphaComponent(0.58)
    ))
    static let muted = Color(adaptiveUIColor(
        dark: UIColor.white.withAlphaComponent(0.36),
        light: UIColor.black.withAlphaComponent(0.36)
    ))
    static let floatingBadgeBackground = Color(adaptiveUIColor(
        dark: UIColor.black.withAlphaComponent(0.54),
        light: UIColor.white.withAlphaComponent(0.78)
    ))
    static let floatingBadgeText = Color(adaptiveUIColor(
        dark: UIColor.white.withAlphaComponent(0.92),
        light: UIColor.black.withAlphaComponent(0.78)
    ))
    static let hotPink = Color(red: 1, green: 0.12, blue: 0.27)
    static let softPink = Color(red: 1, green: 0.42, blue: 0.58)

    static let barBackgroundUIColor = adaptiveUIColor(
        dark: UIColor(red: 0.07, green: 0.07, blue: 0.09, alpha: 1),
        light: UIColor.white
    )
    static let primaryTextUIColor = adaptiveUIColor(
        dark: UIColor.white.withAlphaComponent(0.92),
        light: UIColor.black.withAlphaComponent(0.88)
    )

    private static func adaptiveUIColor(dark: UIColor, light: UIColor) -> UIColor {
        UIColor { traitCollection in
            traitCollection.userInterfaceStyle == .dark ? dark : light
        }
    }
}

struct BundleImage: View {
    let name: String

    var body: some View {
        if let url = Bundle.main.url(forResource: name, withExtension: "png"),
           let image = UIImage(contentsOfFile: url.path) {
            Image(uiImage: image)
                .resizable()
        } else {
            Rectangle()
                .fill(Theme.panelRaised)
                .overlay {
                    Image(systemName: "photo")
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                }
        }
    }
}

struct UploadedImageView: View {
    let data: Data

    var body: some View {
        if let image = UIImage(data: data) {
            Image(uiImage: image)
                .resizable()
        } else {
            Rectangle()
                .fill(Theme.panelRaised)
                .overlay {
                    Image(systemName: "photo")
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                }
        }
    }
}

struct RemoteImageView: View {
    let urlString: String

    var body: some View {
        if let url = URL(string: urlString) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable()
                case .failure:
                    imagePlaceholder
                case .empty:
                    imagePlaceholder
                @unknown default:
                    imagePlaceholder
                }
            }
        } else {
            imagePlaceholder
        }
    }

    private var imagePlaceholder: some View {
        Rectangle()
            .fill(Theme.panelRaised)
            .overlay {
                Image(systemName: "photo")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(Theme.muted)
            }
    }
}

struct PostImageView: View {
    let post: GroupBuyPost
    var index = 0

    var body: some View {
        if post.remoteImageURLs.indices.contains(index) {
            RemoteImageView(urlString: post.remoteImageURLs[index])
        } else if post.uploadedImageData.indices.contains(index) {
            UploadedImageView(data: post.uploadedImageData[index])
        } else {
            let fallbackIndex = max(0, index - post.uploadedImageData.count)
            let imageName = post.imageNames.indices.contains(fallbackIndex) ? post.imageNames[fallbackIndex] : "merch_photocards"
            BundleImage(name: imageName)
        }
    }
}

struct UserBackgroundImage: View {
    let user: User

    var body: some View {
        if !user.backgroundURL.isEmpty {
            RemoteImageView(urlString: user.backgroundURL)
        } else if let imageData = user.backgroundImageData,
           let image = UIImage(data: imageData) {
            Image(uiImage: image)
                .resizable()
        } else {
            BundleImage(name: user.backgroundImageName)
        }
    }
}

enum AppMotion {
    static let page = Animation.spring(response: 0.32, dampingFraction: 0.88)
    static let quick = Animation.spring(response: 0.24, dampingFraction: 0.86)

    static var sideCoverTransition: AnyTransition {
        .asymmetric(
            insertion: .move(edge: .trailing).combined(with: .opacity),
            removal: .move(edge: .trailing).combined(with: .opacity)
        )
    }
}

func hideKeyboard() {
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap(\.windows)
        .forEach { $0.endEditing(true) }
}

func parsePriceAdjustment(_ value: String) -> Double {
    let cleaned = value
        .replacingOccurrences(of: "¥", with: "")
        .replacingOccurrences(of: "元", with: "")
        .trimmed
    return Double(cleaned) ?? 0
}

func formatPlainAmount(_ value: Double) -> String {
    guard value != 0 else { return "" }
    return value.rounded() == value ? String(Int(value)) : String(format: "%.2f", value)
}

enum SearchMatcher {
    static func normalized(_ value: String) -> String {
        value
            .folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: .current)
            .lowercased()
            .filter { !$0.isWhitespace && !$0.isNewline }
    }

    static func matchingCharacterCount(query: String, in candidate: String) -> Int {
        let queryText = normalized(query)
        let candidateText = normalized(candidate)
        guard !queryText.isEmpty, !candidateText.isEmpty else { return 0 }

        var remaining: [Character: Int] = [:]
        for character in candidateText {
            remaining[character, default: 0] += 1
        }

        var count = 0
        for character in queryText {
            if let value = remaining[character], value > 0 {
                remaining[character] = value - 1
                count += 1
            }
        }
        return count
    }

    static func score(query: String, candidate: String) -> Int {
        let queryText = normalized(query)
        let candidateText = normalized(candidate)
        guard !queryText.isEmpty, !candidateText.isEmpty else { return 0 }
        let overlap = matchingCharacterCount(query: query, in: candidate)
        let containsBoost = candidateText.contains(queryText) || queryText.contains(candidateText) ? 1_000 : 0
        let prefixBoost = candidateText.hasPrefix(queryText) ? 500 : 0
        return containsBoost + prefixBoost + overlap
    }

    static func matches(query: String, candidate: String) -> Bool {
        let queryText = normalized(query)
        guard !queryText.isEmpty else { return false }
        let candidateText = normalized(candidate)
        guard !candidateText.isEmpty else { return false }
        if candidateText.contains(queryText) || queryText.contains(candidateText) {
            return true
        }
        return matchingCharacterCount(query: query, in: candidate) >= min(2, queryText.count)
    }
}

struct User: Identifiable, Hashable {
    let id: String
    var email: String = ""
    var nickname: String
    var bio: String
    var followingCount: Int
    var followersCount: Int
    var postCount: Int
    var isRestricted: Bool
    var canShowContact: Bool
    var avatarSymbol: String
    var avatarTint: ColorToken
    var redBookID: String = ""
    var gender: String = ""
    var birthday: String = ""
    var region: String = ""
    var backgroundImageName: String = "merch_magazine"
    var avatarImageData: Data? = nil
    var backgroundImageData: Data? = nil
    var avatarURL: String = ""
    var backgroundURL: String = ""
    var lastNicknameChangedAt: Date? = nil
    var phoneNumber: String = ""
    var password: String = ""
}

struct GroupBuyPost: Identifiable, Hashable {
    let id: String
    var title: String
    var imageNames: [String]
    var uploadedImageData: [Data] = []
    var remoteImageURLs: [String] = []
    var imageObjectKeys: [String] = []
    var authorID: String
    var groupType: GroupBuyType = .followGroup
    var collectionID: String? = nil
    var categoryTags: [String]
    var fandomTags: [String]
    var price: String
    var deposit: String
    var deadline: Date
    var condition: String
    var isFormed: Bool
    var description: String
    var wechat: String
    var qq: String
    var groupInfo: String
    var externalLink: String
    var createdAt: Date
    var likedCount: Int
    var favoriteCount: Int
    var commentCount: Int
    var reportCount: Int
    var status: ContentStatus
    var imageAspect: Double
    var pingguAveragePrice: String = ""
    var pingguNote: String = ""
    var unsoldRoles: [UnsoldRole] = []

    var isEnded: Bool {
        deadline <= Date()
    }

    var searchableText: String {
        ([title, description, price, deposit, condition, pingguAveragePrice, pingguNote] + categoryTags + fandomTags + unsoldRoles.map(\.name))
            .joined(separator: " ")
    }
}

enum GroupBuyType: String, CaseIterable, Identifiable, Hashable {
    case followGroup = "跟团"
    case splitGoods = "拼谷"

    var id: String { rawValue }

    var moduleTitle: String {
        switch self {
        case .followGroup: "跟团"
        case .splitGoods: "拼谷"
        }
    }

    var feedDescription: String {
        switch self {
        case .followGroup: "自印团信息流"
        case .splitGoods: "角色余量可筛选"
        }
    }

    var icon: String {
        switch self {
        case .followGroup: "bag.fill"
        case .splitGoods: "person.3.fill"
        }
    }

    var accent: Color {
        switch self {
        case .followGroup: Theme.hotPink
        case .splitGoods: Color(red: 0.25, green: 0.78, blue: 0.72)
        }
    }

    var backendValue: String {
        switch self {
        case .followGroup: "followGroup"
        case .splitGoods: "splitGoods"
        }
    }

    static func backendValue(_ value: String) -> GroupBuyType {
        switch value {
        case "splitGoods", "拼谷":
            return .splitGoods
        default:
            return .followGroup
        }
    }
}

struct UnsoldRole: Identifiable, Hashable {
    let id: String
    var name: String
    var quantity: Int
    var priceAdjustment: Double

    init(id: String = "role-\(UUID().uuidString)", name: String, quantity: Int, priceAdjustment: Double = 0) {
        self.id = id
        self.name = name
        self.quantity = quantity
        self.priceAdjustment = priceAdjustment
    }

    var isAvailable: Bool {
        quantity > 0 && !name.trimmed.isEmpty
    }

    var priceAdjustmentText: String {
        guard priceAdjustment != 0 else { return "无调价" }
        let value = abs(priceAdjustment)
        let formatted = value.rounded() == value ? String(Int(value)) : String(format: "%.2f", value)
        return "\(priceAdjustment > 0 ? "+" : "-")¥\(formatted)"
    }
}

struct GroupCollection: Identifiable, Hashable {
    let id: String
    var ownerID: String
    var name: String
    var contactWechat: String
    var contactQQ: String
    var groupInfo: String
    var deadline: Date
    var defaultNote: String
    var postIDs: [String]
    var createdAt: Date

    var isEnded: Bool {
        deadline <= Date()
    }
}

struct ReviewPost: Identifiable, Hashable {
    let id: String
    var imageName: String
    var body: String
    var groupBuyPostID: String
    var publisherID: String
    var authorID: String
    var likedCount: Int
    var commentCount: Int
    var createdAt: Date
}

struct Comment: Identifiable, Hashable {
    let id: String
    var body: String
    var authorID: String
    var postID: String
    var replyToID: String?
    var createdAt: Date
    var status: ContentStatus
}

struct MessageThread: Identifiable, Hashable, Codable {
    let id: String
    var buyerUserID: String
    var publisherUserID: String
    var relatedPostID: String?
    var messages: [DirectMessage]
    var unreadCount: Int
    var updatedAt: Date
}

struct DirectMessage: Identifiable, Hashable, Codable {
    let id: String
    var senderID: String
    var body: String
    var createdAt: Date
    var imageData: Data? = nil
    var sharedPostID: String? = nil
    var sharedProfileUserID: String? = nil
}

struct Report: Identifiable, Hashable {
    let id: String
    var target: ReportTarget
    var reason: String
    var detail: String
    var reporterID: String
    var status: ReportStatus
    var adminResult: String?
    var handledAt: Date?
}

struct Reminder: Identifiable, Hashable {
    let id: String
    var userID: String
    var postID: String
    var deadline: Date
    var remindAt: Date
    var hasReminded: Bool
}

enum ReportTarget: Hashable {
    case post(String)
    case comment(String)
}

enum ContentStatus: String, Hashable {
    case active = "公开"
    case hidden = "已隐藏"
    case removed = "已下架"
    case deleted = "已删除"
}

enum ReportStatus: String, Hashable {
    case pending = "待处理"
    case ignored = "已忽略"
    case hidden = "已隐藏"
    case removed = "已下架"
    case warned = "已警告"
}

enum ColorToken: String, Hashable {
    case rose
    case violet
    case amber
    case teal
    case blue

    var gradient: LinearGradient {
        switch self {
        case .rose:
            LinearGradient(colors: [Theme.hotPink, Color(red: 0.42, green: 0.08, blue: 0.18)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .violet:
            LinearGradient(colors: [Color(red: 0.58, green: 0.36, blue: 1), Color(red: 0.16, green: 0.11, blue: 0.32)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .amber:
            LinearGradient(colors: [Color(red: 1, green: 0.72, blue: 0.22), Color(red: 0.48, green: 0.23, blue: 0.08)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .teal:
            LinearGradient(colors: [Color(red: 0.18, green: 0.82, blue: 0.72), Color(red: 0.04, green: 0.26, blue: 0.3)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .blue:
            LinearGradient(colors: [Color(red: 0.32, green: 0.58, blue: 1), Color(red: 0.06, green: 0.16, blue: 0.4)], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }
}

extension ContentStatus {
    static func backendValue(_ value: String) -> ContentStatus {
        switch value {
        case "active", "公开":
            return .active
        case "hidden", "已隐藏":
            return .hidden
        case "removed", "已下架":
            return .removed
        case "deleted", "已删除":
            return .deleted
        default:
            return .active
        }
    }
}

extension ReportStatus {
    static func backendValue(_ value: String) -> ReportStatus {
        switch value {
        case "ignored", "已忽略":
            return .ignored
        case "hidden", "已隐藏":
            return .hidden
        case "removed", "已下架":
            return .removed
        case "warned", "已警告":
            return .warned
        default:
            return .pending
        }
    }
}

enum BackendDateParser {
    static func date(from value: String?) -> Date {
        guard let value else { return Date() }
        if let date = fractionalFormatter.date(from: value) {
            return date
        }
        if let date = plainFormatter.date(from: value) {
            return date
        }
        return Date()
    }

    private static let fractionalFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let plainFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}

struct BackendPayload: Decodable {
    var token: String?
    var currentUser: BackendUser?
    var users: [BackendUser]?
    var posts: [BackendPost]?
    var collections: [BackendCollection]?
    var comments: [BackendComment]?
    var reports: [BackendReport]?
    var likedPostIDs: [String]?
    var favoritePostIDs: [String]?
    var followedUserIDs: [String]?
}

struct BackendUser: Decodable {
    let id: String
    let email: String?
    let nickname: String
    let bio: String
    let followingCount: Int
    let followersCount: Int
    let postCount: Int
    let isRestricted: Bool
    let canShowContact: Bool
    let avatarSymbol: String
    let avatarTint: String
    let redBookID: String
    let gender: String
    let birthday: String
    let region: String
    let backgroundImageName: String
    let avatarURL: String?
    let backgroundURL: String?
    let phoneNumber: String?
    let lastNicknameChangedAt: String?

    func localUser() -> User {
        User(
            id: id,
            email: email ?? "",
            nickname: nickname,
            bio: bio,
            followingCount: followingCount,
            followersCount: followersCount,
            postCount: postCount,
            isRestricted: isRestricted,
            canShowContact: canShowContact,
            avatarSymbol: avatarSymbol,
            avatarTint: ColorToken(rawValue: avatarTint) ?? .rose,
            redBookID: redBookID,
            gender: gender,
            birthday: birthday,
            region: region,
            backgroundImageName: backgroundImageName,
            avatarURL: avatarURL ?? "",
            backgroundURL: backgroundURL ?? "",
            lastNicknameChangedAt: lastNicknameChangedAt.map(BackendDateParser.date(from:)),
            phoneNumber: phoneNumber ?? ""
        )
    }
}

struct BackendRole: Decodable {
    let id: String?
    let name: String
    let quantity: Int
    let priceAdjustment: Double?

    func localRole() -> UnsoldRole {
        UnsoldRole(id: id ?? "role-\(UUID().uuidString)", name: name, quantity: quantity, priceAdjustment: priceAdjustment ?? 0)
    }
}

struct BackendPost: Decodable {
    let id: String
    let title: String
    let imageNames: [String]
    let remoteImageURLs: [String]?
    let imageObjectKeys: [String]?
    let authorID: String
    let groupType: String
    let collectionID: String?
    let categoryTags: [String]
    let fandomTags: [String]
    let price: String
    let deposit: String
    let deadline: String
    let condition: String
    let isFormed: Bool
    let description: String
    let wechat: String
    let qq: String
    let groupInfo: String
    let externalLink: String
    let createdAt: String
    let likedCount: Int
    let favoriteCount: Int
    let commentCount: Int
    let reportCount: Int
    let status: String
    let imageAspect: Double
    let pingguAveragePrice: String
    let pingguNote: String
    let unsoldRoles: [BackendRole]

    func localPost() -> GroupBuyPost {
        GroupBuyPost(
            id: id,
            title: title,
            imageNames: imageNames,
            remoteImageURLs: remoteImageURLs ?? [],
            imageObjectKeys: imageObjectKeys ?? [],
            authorID: authorID,
            groupType: GroupBuyType.backendValue(groupType),
            collectionID: collectionID,
            categoryTags: categoryTags,
            fandomTags: fandomTags,
            price: price,
            deposit: deposit,
            deadline: BackendDateParser.date(from: deadline),
            condition: condition,
            isFormed: isFormed,
            description: description,
            wechat: wechat,
            qq: qq,
            groupInfo: groupInfo,
            externalLink: externalLink,
            createdAt: BackendDateParser.date(from: createdAt),
            likedCount: likedCount,
            favoriteCount: favoriteCount,
            commentCount: commentCount,
            reportCount: reportCount,
            status: ContentStatus.backendValue(status),
            imageAspect: imageAspect,
            pingguAveragePrice: pingguAveragePrice,
            pingguNote: pingguNote,
            unsoldRoles: unsoldRoles.map { $0.localRole() }
        )
    }
}

struct BackendCollection: Decodable {
    let id: String
    let ownerID: String
    let name: String
    let contactWechat: String
    let contactQQ: String
    let groupInfo: String
    let deadline: String
    let defaultNote: String
    let postIDs: [String]
    let createdAt: String

    func localCollection() -> GroupCollection {
        GroupCollection(
            id: id,
            ownerID: ownerID,
            name: name,
            contactWechat: contactWechat,
            contactQQ: contactQQ,
            groupInfo: groupInfo,
            deadline: BackendDateParser.date(from: deadline),
            defaultNote: defaultNote,
            postIDs: postIDs,
            createdAt: BackendDateParser.date(from: createdAt)
        )
    }
}

struct BackendComment: Decodable {
    let id: String
    let body: String
    let authorID: String
    let postID: String
    let replyToID: String?
    let createdAt: String
    let status: String

    func localComment() -> Comment {
        Comment(id: id, body: body, authorID: authorID, postID: postID, replyToID: replyToID, createdAt: BackendDateParser.date(from: createdAt), status: ContentStatus.backendValue(status))
    }
}

struct BackendReportTarget: Decodable {
    let type: String
    let id: String
}

struct BackendReport: Decodable {
    let id: String
    let target: BackendReportTarget
    let reason: String
    let detail: String
    let reporterID: String
    let status: String
    let adminResult: String?
    let handledAt: String?

    func localReport() -> Report {
        let localTarget: ReportTarget = target.type == "comment" ? .comment(target.id) : .post(target.id)
        return Report(id: id, target: localTarget, reason: reason, detail: detail, reporterID: reporterID, status: ReportStatus.backendValue(status), adminResult: adminResult, handledAt: handledAt.map(BackendDateParser.date(from:)))
    }
}

struct UploadTarget: Decodable {
    let objectKey: String
    let uploadUrl: String
}

final class AliyunBackendClient {
    static let baseURLDefaultsKey = "zhoubiantuan.backendBaseURL"
    static let defaultBaseURL = "https://api.zhoubiantuanmail.top/api"

    private let baseURL: URL
    private let session: URLSession
    private static let defaultSession: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 18
        configuration.timeoutIntervalForResource = 55
        configuration.waitsForConnectivity = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration)
    }()

    private static var configuredBaseURL: String {
        #if DEBUG
        return UserDefaults.standard.string(forKey: baseURLDefaultsKey) ?? defaultBaseURL
        #else
        return defaultBaseURL
        #endif
    }

    init(baseURLString: String = AliyunBackendClient.configuredBaseURL, session: URLSession = AliyunBackendClient.defaultSession) {
        self.baseURL = URL(string: baseURLString) ?? URL(string: Self.defaultBaseURL)!
        self.session = session
    }

    func register(email: String, password: String, nickname: String) async throws -> BackendPayload {
        try await request("/auth/register", method: "POST", body: [
            "email": email,
            "password": password,
            "nickname": nickname
        ])
    }

    func sendEmailCode(email: String, purpose: String) async throws {
        let _: EmptyResponse = try await request("/auth/email/send-code", method: "POST", body: [
            "email": email,
            "purpose": purpose
        ])
    }

    func registerWithEmailCode(email: String, password: String, nickname: String, code: String) async throws -> BackendPayload {
        try await request("/auth/email/register", method: "POST", body: [
            "email": email,
            "password": password,
            "nickname": nickname,
            "code": code
        ])
    }

    func login(email: String, password: String) async throws -> BackendPayload {
        try await request("/auth/email/login", method: "POST", body: [
            "email": email,
            "password": password
        ])
    }

    func loginWithEmailCode(email: String, code: String) async throws -> BackendPayload {
        try await request("/auth/email/login", method: "POST", body: [
            "email": email,
            "code": code
        ])
    }

    func bootstrap(token: String) async throws -> BackendPayload {
        try await request("/bootstrap", token: token)
    }

    func updateProfile(token: String, user: User, avatarObjectKey: String? = nil, backgroundObjectKey: String? = nil) async throws {
        var body: [String: Any] = [
            "nickname": user.nickname,
            "bio": user.bio,
            "redBookID": user.redBookID,
            "gender": user.gender,
            "birthday": user.birthday,
            "region": user.region,
            "avatarSymbol": user.avatarSymbol,
            "avatarTint": user.avatarTint.rawValue,
            "backgroundImageName": user.backgroundImageName
        ]
        if let avatarObjectKey {
            body["avatarObjectKey"] = avatarObjectKey
        }
        if let backgroundObjectKey {
            body["backgroundObjectKey"] = backgroundObjectKey
        }
        let _: EmptyResponse = try await request("/me", method: "PATCH", token: token, body: body)
    }

    func createCollection(token: String, collection: GroupCollection) async throws {
        let _: EmptyResponse = try await request("/collections", method: "POST", token: token, body: [
            "id": collection.id,
            "name": collection.name,
            "wechat": collection.contactWechat,
            "qq": collection.contactQQ,
            "groupInfo": collection.groupInfo,
            "deadline": BackendDateParserString.string(from: collection.deadline),
            "defaultNote": collection.defaultNote
        ])
    }

    func deleteCollection(token: String, collectionID: String) async throws {
        try await emptyRequest("/collections/\(collectionID)", method: "DELETE", token: token)
    }

    func createPost(token: String, post: GroupBuyPost, imageObjectKeys: [String]) async throws {
        let roles = post.unsoldRoles.map { ["id": $0.id, "name": $0.name, "quantity": $0.quantity, "priceAdjustment": $0.priceAdjustment] as [String: Any] }
        let _: EmptyResponse = try await request("/posts", method: "POST", token: token, body: [
            "id": post.id,
            "title": post.title,
            "imageNames": post.imageNames,
            "imageObjectKeys": imageObjectKeys,
            "groupType": post.groupType.backendValue,
            "collectionID": post.collectionID ?? "",
            "categoryTags": post.categoryTags,
            "fandomTags": post.fandomTags,
            "price": post.price,
            "deposit": post.deposit,
            "deadline": BackendDateParserString.string(from: post.deadline),
            "condition": post.condition,
            "isFormed": post.isFormed,
            "description": post.description,
            "wechat": post.wechat,
            "qq": post.qq,
            "groupInfo": post.groupInfo,
            "externalLink": post.externalLink,
            "imageAspect": post.imageAspect,
            "pingguAveragePrice": post.pingguAveragePrice,
            "pingguNote": post.pingguNote,
            "unsoldRoles": roles
        ])
    }

    func deletePost(token: String, postID: String) async throws {
        try await emptyRequest("/posts/\(postID)", method: "DELETE", token: token)
    }

    func setPostFlag(token: String, postID: String, flag: String, enabled: Bool) async throws {
        try await emptyRequest("/posts/\(postID)/\(flag)", method: enabled ? "POST" : "DELETE", token: token)
    }

    func setFollow(token: String, userID: String, enabled: Bool) async throws {
        try await emptyRequest("/users/\(userID)/follow", method: enabled ? "POST" : "DELETE", token: token)
    }

    func addComment(token: String, postID: String, body: String, replyToID: String? = nil) async throws {
        let _: EmptyResponse = try await request("/posts/\(postID)/comments", method: "POST", token: token, body: [
            "body": body,
            "replyToID": replyToID ?? ""
        ])
    }

    func deleteComment(token: String, commentID: String) async throws {
        try await emptyRequest("/comments/\(commentID)", method: "DELETE", token: token)
    }

    func reportPost(token: String, postID: String, reason: String) async throws {
        let _: EmptyResponse = try await request("/reports", method: "POST", token: token, body: [
            "targetType": "post",
            "targetID": postID,
            "reason": reason,
            "detail": "来自 iOS 内测版举报"
        ])
    }

    func uploadPostImages(token: String, images: [Data]) async throws -> [String] {
        try await uploadImages(token: token, images: images, kind: "post", filenamePrefix: "post")
    }

    func uploadProfileImage(token: String, data: Data, kind: String) async throws -> String {
        try await uploadImages(token: token, images: [data], kind: kind, filenamePrefix: kind).first ?? ""
    }

    private func uploadImages(token: String, images: [Data], kind: String, filenamePrefix: String) async throws -> [String] {
        var keys: [String] = []
        for (index, data) in images.enumerated() {
            let target: UploadTarget = try await request("/uploads/presign", method: "POST", token: token, body: [
                "kind": kind,
                "filename": "\(filenamePrefix)-\(index).jpg",
                "contentType": "image/jpeg"
            ])
            guard let uploadURL = URL(string: target.uploadUrl) else {
                throw NSError(domain: "AliyunBackendClient", code: -1000, userInfo: [NSLocalizedDescriptionKey: "上传地址无效"])
            }
            var request = URLRequest(url: uploadURL)
            request.httpMethod = "PUT"
            request.timeoutInterval = 45
            request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
            do {
                let (_, response) = try await session.upload(for: request, from: data)
                try validate(response: response, data: Data())
            } catch let error as URLError where error.code == .timedOut {
                throw NSError(domain: "AliyunBackendClient", code: error.errorCode, userInfo: [NSLocalizedDescriptionKey: "图片上传超时，请换个网络或稍后重试"])
            }
            keys.append(target.objectKey)
        }
        return keys
    }

    private func request<T: Decodable>(_ path: String, method: String = "GET", token: String? = nil, body: [String: Any]? = nil) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))))
        request.httpMethod = method
        request.timeoutInterval = 18
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        do {
            let (data, response) = try await session.data(for: request)
            try validate(response: response, data: data)
            if T.self == EmptyResponse.self {
                return EmptyResponse() as! T
            }
            return try JSONDecoder().decode(T.self, from: data)
        } catch let error as URLError where error.code == .timedOut {
            throw NSError(domain: "AliyunBackendClient", code: error.errorCode, userInfo: [NSLocalizedDescriptionKey: "网络请求超时，请稍后重试"])
        }
    }

    private func emptyRequest(_ path: String, method: String, token: String) async throws {
        let _: EmptyResponse = try await request(path, method: method, token: token)
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            let errorMessage = (try? JSONDecoder().decode(APIError.self, from: data).error) ?? "请求失败"
            throw NSError(domain: "AliyunBackendClient", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: errorMessage])
        }
    }

    private struct APIError: Decodable {
        let error: String
    }
}

struct BackendDateParserString {
    static func string(from date: Date) -> String {
        formatter.string(from: date)
    }

    private static let formatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

struct EmptyResponse: Decodable {}

enum KeychainStore {
    private static let service = "com.panpanpan.zhoubiantuan"

    static func string(forKey key: String) -> String? {
        var query = baseQuery(forKey: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            return nil
        }
        return value
    }

    @discardableResult
    static func set(_ value: String, forKey key: String) -> Bool {
        let data = Data(value.utf8)
        let query = baseQuery(forKey: key)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            return add(data, forKey: key)
        } else if status != errSecSuccess {
            delete(forKey: key)
            return add(data, forKey: key)
        }
        return true
    }

    static func delete(forKey key: String) {
        SecItemDelete(baseQuery(forKey: key) as CFDictionary)
    }

    private static func baseQuery(forKey key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
    }

    @discardableResult
    private static func add(_ data: Data, forKey key: String) -> Bool {
        var item = baseQuery(forKey: key)
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }
}

@MainActor
final class MockAppStore: ObservableObject {
    @Published var users: [User]
    @Published var posts: [GroupBuyPost]
    @Published var collections: [GroupCollection]
    @Published var reviews: [ReviewPost]
    @Published var comments: [Comment]
    @Published var threads: [MessageThread] {
        didSet {
            persistThreads()
        }
    }
    @Published var reports: [Report]
    @Published var reminders: [Reminder]
    @Published var likedPostIDs: Set<String>
    @Published var favoritePostIDs: Set<String>
    @Published var followedUserIDs: Set<String>
    @Published var followingIDsByUserID: [String: Set<String>]
    @Published var browsingHistoryIDs: [String] {
        didSet {
            UserDefaults.standard.set(browsingHistoryIDs, forKey: Self.browsingHistoryDefaultsKey(for: currentUserID))
        }
    }
    @Published var searchHistory: [String] {
        didSet {
            UserDefaults.standard.set(searchHistory, forKey: Self.searchHistoryDefaultsKey)
        }
    }
    @Published var toastMessage: String?
    @Published var isAuthPromptPresented = false
    @Published var isLoggedIn: Bool {
        didSet {
            UserDefaults.standard.set(isLoggedIn, forKey: Self.loginDefaultsKey)
        }
    }
    @Published var currentUserID = "u-me"
    @Published var authSessionVersion = UUID()
    @Published var isDarkModeEnabled: Bool {
        didSet {
            UserDefaults.standard.set(isDarkModeEnabled, forKey: Self.darkModeDefaultsKey)
        }
    }
    @Published var limitsUnrepliedMessages: Bool {
        didSet {
            UserDefaults.standard.set(limitsUnrepliedMessages, forKey: Self.messageLimitDefaultsKey)
        }
    }
    @Published var isBackendEnabled: Bool {
        didSet {
            UserDefaults.standard.set(isBackendEnabled, forKey: Self.backendEnabledDefaultsKey)
        }
    }

    private static let demoUserID = "u-me"
    private static let loginDefaultsKey = "zhoubiantuan.isLoggedIn"
    private static let darkModeDefaultsKey = "zhoubiantuan.isDarkModeEnabled"
    private static let messageLimitDefaultsKey = "zhoubiantuan.limitsUnrepliedMessages"
    private static let backendEnabledDefaultsKey = "zhoubiantuan.isBackendEnabled"
    private static let backendTokenDefaultsKey = "zhoubiantuan.backendToken"
    private static let backendTokenFallbackDefaultsKey = "zhoubiantuan.backendToken.fallback"
    private static let browsingHistoryDefaultsKeyPrefix = "zhoubiantuan.browsingHistory"
    private static let messageThreadsDefaultsKey = "zhoubiantuan.messageThreads"
    private static let searchHistoryDefaultsKey = "zhoubiantuan.searchHistory"
    private static let defaultSearchHistory = ["Bucky", "Steve Rogers", "吧唧拼谷", "巡演小卡", "冬兵生日团", "Loki", "亚克力立牌", "自印团补款", "Tony Stark", "主角团角色位"]
    private static let demoLikedPostIDs: Set<String> = ["p-card", "p-plush"]
    private static let demoFavoritePostIDs: Set<String> = ["p-card", "p-album"]
    private let backendClient = AliyunBackendClient()
    private var cachedBackendToken: String?
    private var isRestoringThreads = false
    private var backendToken: String? {
        get {
            cachedBackendToken ??
            KeychainStore.string(forKey: Self.backendTokenDefaultsKey) ??
            UserDefaults.standard.string(forKey: Self.backendTokenFallbackDefaultsKey)
        }
        set {
            if let newValue, !newValue.isEmpty {
                cachedBackendToken = newValue
                KeychainStore.set(newValue, forKey: Self.backendTokenDefaultsKey)
                UserDefaults.standard.set(newValue, forKey: Self.backendTokenFallbackDefaultsKey)
            } else {
                cachedBackendToken = nil
                KeychainStore.delete(forKey: Self.backendTokenDefaultsKey)
                UserDefaults.standard.removeObject(forKey: Self.backendTokenFallbackDefaultsKey)
            }
        }
    }

    private static func migrateBackendTokenToKeychain() {
        let defaults = UserDefaults.standard
        guard let legacyToken = defaults.string(forKey: backendTokenDefaultsKey), !legacyToken.isEmpty else { return }
        if KeychainStore.string(forKey: backendTokenDefaultsKey) == nil {
            if !KeychainStore.set(legacyToken, forKey: backendTokenDefaultsKey) {
                defaults.set(legacyToken, forKey: backendTokenFallbackDefaultsKey)
            }
        }
        defaults.removeObject(forKey: backendTokenDefaultsKey)
    }

    private static func browsingHistoryDefaultsKey(for userID: String) -> String {
        "\(browsingHistoryDefaultsKeyPrefix).\(userID)"
    }

    private static var messageThreadsStorageURL: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("zhoubiantuan-message-threads.json")
    }

    private func persistThreads() {
        guard !isRestoringThreads,
              let data = try? JSONEncoder().encode(threads) else { return }
        guard let storageURL = Self.messageThreadsStorageURL else {
            UserDefaults.standard.set(data, forKey: Self.messageThreadsDefaultsKey)
            return
        }
        try? FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: storageURL, options: .atomic)
    }

    private func restorePersistedThreads() {
        let fileData = Self.messageThreadsStorageURL.flatMap { try? Data(contentsOf: $0) }
        guard let data = fileData ?? UserDefaults.standard.data(forKey: Self.messageThreadsDefaultsKey),
              let restoredThreads = try? JSONDecoder().decode([MessageThread].self, from: data) else { return }
        isRestoringThreads = true
        threads = restoredThreads
        isRestoringThreads = false
    }

    private static func normalizedMessageImageData(_ data: Data) -> Data {
        ImageDataNormalizer.jpegData(from: data, maxSide: 1600, compressionQuality: 0.78)
    }

    init() {
        Self.migrateBackendTokenToKeychain()
        cachedBackendToken = KeychainStore.string(forKey: Self.backendTokenDefaultsKey) ?? UserDefaults.standard.string(forKey: Self.backendTokenFallbackDefaultsKey)
        let startsLoggedIn = UserDefaults.standard.object(forKey: Self.loginDefaultsKey) as? Bool ?? false
        isLoggedIn = startsLoggedIn
        isDarkModeEnabled = UserDefaults.standard.object(forKey: Self.darkModeDefaultsKey) as? Bool ?? true
        limitsUnrepliedMessages = UserDefaults.standard.object(forKey: Self.messageLimitDefaultsKey) as? Bool ?? true
        isBackendEnabled = UserDefaults.standard.object(forKey: Self.backendEnabledDefaultsKey) as? Bool ?? true
        let now = Date()
        let myCollectionID = "col-my-winter"
        let winterCollectionID = "col-winter-bucky"
        let tourCollectionID = "col-tour-cards"
        let berryCollectionID = "col-berry-doll"
        let blackCollectionID = "col-black-jewelry"
        let moonMagazineCollectionID = "col-moon-magazine"
        users = [
            User(id: "u-me", nickname: "潘潘潘", bio: "点击这里，填写简介", followingCount: 2, followersCount: 1, postCount: 1, isRestricted: false, canShowContact: true, avatarSymbol: "潘", avatarTint: .amber, redBookID: "63844111650", gender: "未设置", birthday: "选择生日", region: "北京", backgroundImageName: "merch_magazine", phoneNumber: "+861391237122", password: "123456"),
            User(id: "u-black", nickname: "黑贝果", bio: "原创设计小众饰品，开团前都会补细节说明。", followingCount: 88, followersCount: 12800, postCount: 36, isRestricted: false, canShowContact: true, avatarSymbol: "黑", avatarTint: .rose, redBookID: "BlackBagel2026", region: "上海", backgroundImageName: "merch_jewelry"),
            User(id: "u-moon", nickname: "月光补货站", bio: "演唱会周边、立牌、吧唧团购整理。", followingCount: 54, followersCount: 5320, postCount: 22, isRestricted: false, canShowContact: true, avatarSymbol: "月", avatarTint: .violet, redBookID: "MoonPin0909", region: "广州", backgroundImageName: "merch_badges"),
            User(id: "u-berry", nickname: "莓果小铺", bio: "娃娃衣和棉花娃配件长期团。", followingCount: 91, followersCount: 2401, postCount: 18, isRestricted: false, canShowContact: true, avatarSymbol: "莓", avatarTint: .amber, redBookID: "BerryDollClub", region: "杭州", backgroundImageName: "merch_plush"),
            User(id: "u-echo", nickname: "Echo周边记录", bio: "专辑、杂志、明信片成团信息搬运。", followingCount: 37, followersCount: 901, postCount: 11, isRestricted: false, canShowContact: true, avatarSymbol: "E", avatarTint: .blue, redBookID: "EchoGB2026", region: "成都", backgroundImageName: "merch_album")
        ]
        let initialPosts = [
            GroupBuyPost(id: "p-card", title: "巡演限定小卡套组二开，余量 30 份", imageNames: ["merch_photocards", "merch_magazine"], authorID: "u-echo", collectionID: tourCollectionID, categoryTags: ["小卡", "预售", "自印团"], fandomTags: ["欧美巡演", "收藏卡"], price: "¥42/套", deposit: "¥15 定金", deadline: Self.date(days: 1, hour: 22), condition: "满 60 套开团，未成团原路退定", isFormed: true, description: "这次是巡演风格小卡套组二开，含 6 张卡 + 硬质保护套。图片为打样效果，实物会有轻微色差。适合自留和交换，不拆卖。", wechat: "EchoGB2026", qq: "82190477", groupInfo: "QQ群 743 219 008，答案：小卡", externalLink: "https://forms.example/cards", createdAt: now.addingTimeInterval(-3600 * 2), likedCount: 9618, favoriteCount: 1280, commentCount: 86, reportCount: 0, status: .active, imageAspect: 1.12),
            GroupBuyPost(id: "p-badge", title: "2026冬兵生日团吧唧拼谷，今晚截团", imageNames: ["merch_badges", "merch_jewelry"], authorID: "u-moon", groupType: .splitGoods, collectionID: winterCollectionID, categoryTags: ["吧唧", "现货", "拼谷"], fandomTags: ["Steve Rogers", "Bucky Barnes"], price: "¥35/吧唧", deposit: "全款", deadline: Self.date(days: 0, hour: 23), condition: "主角团角色位优先成团，余量实时更新", isFormed: true, description: "星芒主题金属吧唧，黑粉双色电镀，适合痛包和陈列。库存不多，截团后不追加。", wechat: "MoonPin0909", qq: "190443821", groupInfo: "微信群复制微信后拉群", externalLink: "", createdAt: now.addingTimeInterval(-3600 * 5), likedCount: 880, favoriteCount: 282, commentCount: 24, reportCount: 1, status: .active, imageAspect: 0.86, pingguAveragePrice: "均价35元/吧唧", pingguNote: "目前还缺主角团角色位", unsoldRoles: [UnsoldRole(name: "Steve Rogers", quantity: 2), UnsoldRole(name: "Bucky Barnes", quantity: 3), UnsoldRole(name: "Tony Stark", quantity: 5)]),
            GroupBuyPost(id: "p-stand", title: "2026冬兵生日团亚克力立牌角色位", imageNames: ["merch_standees", "merch_album"], authorID: "u-moon", groupType: .splitGoods, collectionID: winterCollectionID, categoryTags: ["立牌", "预售", "拼谷"], fandomTags: ["Bucky Barnes", "Sam Wilson"], price: "¥68/立牌", deposit: "¥20 定金", deadline: Self.date(days: 3, hour: 20), condition: "满 120 套开模，角色位未满可继续认领", isFormed: true, description: "亚克力立牌含底座，舞台灯光主题。已完成第一次打样，边缘透粉光，适合桌面陈列。", wechat: "MoonPin0909", qq: "190443821", groupInfo: "微信群复制微信后拉群", externalLink: "https://forms.example/standee", createdAt: now.addingTimeInterval(-3600 * 20), likedCount: 2301, favoriteCount: 911, commentCount: 51, reportCount: 0, status: .active, imageAspect: 1.24, pingguAveragePrice: "均价68元/立牌", pingguNote: "Bucky 和 Sam 位还可拼", unsoldRoles: [UnsoldRole(name: "Bucky Barnes", quantity: 2), UnsoldRole(name: "Sam Wilson", quantity: 1), UnsoldRole(name: "Natasha Romanoff", quantity: 2)]),
            GroupBuyPost(id: "p-plush", title: "棉花娃睡衣和小配件自印团，粉色猫耳款", imageNames: ["merch_plush", "merch_concert"], authorID: "u-berry", collectionID: berryCollectionID, categoryTags: ["娃娃", "饰品", "自印团"], fandomTags: ["棉花娃", "娃衣"], price: "¥35 起", deposit: "¥10 定金", deadline: Self.date(days: 5, hour: 21), condition: "满 50 件成团，可混款", isFormed: false, description: "包含猫耳睡衣、迷你挂件、拍照小垫子。10cm/15cm 娃可选，备注尺寸。", wechat: "BerryDollClub", qq: "448102930", groupInfo: "QQ群 518 221 974", externalLink: "", createdAt: now.addingTimeInterval(-3600 * 8), likedCount: 1490, favoriteCount: 507, commentCount: 39, reportCount: 0, status: .active, imageAspect: 1.06),
            GroupBuyPost(id: "p-album", title: "巡演黑胶专辑 + 明信片补款提醒，明晚截止", imageNames: ["merch_album", "merch_photocards"], authorID: "u-echo", collectionID: tourCollectionID, categoryTags: ["专辑", "明信片", "补款"], fandomTags: ["黑胶", "欧美音乐"], price: "¥118/套", deposit: "已收 ¥30", deadline: Self.date(days: 1, hour: 20), condition: "已成团，补款后统一打包", isFormed: true, description: "黑胶专辑加 8 张明信片，当前进入补款阶段。请收藏过本团的宝子留意截团提醒。", wechat: "EchoGB2026", qq: "82190477", groupInfo: "原补款群内公告", externalLink: "https://forms.example/album", createdAt: now.addingTimeInterval(-3600 * 30), likedCount: 620, favoriteCount: 308, commentCount: 17, reportCount: 0, status: .active, imageAspect: 0.98),
            GroupBuyPost(id: "p-magazine", title: "杂志切页 + 拍立得风卡册自印团", imageNames: ["merch_magazine", "merch_badges"], authorID: "u-moon", collectionID: moonMagazineCollectionID, categoryTags: ["杂志", "小卡", "自印团"], fandomTags: ["切页", "卡册"], price: "¥26 起", deposit: "全款", deadline: Self.date(days: 2, hour: 18), condition: "满 30 本拆页，当前 21 本", isFormed: false, description: "杂志切页和拍立得风卡册拼团，可选单页/整套。开团后按编号排单。", wechat: "MoonPin0909", qq: "190443821", groupInfo: "QQ群 204 118 776", externalLink: "", createdAt: now.addingTimeInterval(-3600 * 6), likedCount: 402, favoriteCount: 122, commentCount: 11, reportCount: 2, status: .active, imageAspect: 1.18),
            GroupBuyPost(id: "p-jewelry", title: "银色星心挂件拼谷，Loki 位有余量", imageNames: ["merch_jewelry", "merch_badges"], authorID: "u-black", groupType: .splitGoods, collectionID: blackCollectionID, categoryTags: ["饰品", "孤品", "拼谷"], fandomTags: ["Loki", "Mobius"], price: "¥39-79", deposit: "全款", deadline: Self.date(days: 4, hour: 22), condition: "现货余量 18 件，拍完即止", isFormed: true, description: "星心元素挂件、项链、手链，适合挂包或日常佩戴。孤品数量少，不支持长时间占位。", wechat: "BlackBagel2026", qq: "60092118", groupInfo: "微信群，复制微信备注：星心", externalLink: "", createdAt: now.addingTimeInterval(-3600 * 12), likedCount: 734, favoriteCount: 241, commentCount: 29, reportCount: 0, status: .active, imageAspect: 0.92, pingguAveragePrice: "均价49元/挂件", pingguNote: "Loki 位还有少量可拼", unsoldRoles: [UnsoldRole(name: "Loki", quantity: 4), UnsoldRole(name: "Mobius", quantity: 1)]),
            GroupBuyPost(id: "p-concert", title: "演唱会痛包挂件 + 应援棒收纳套", imageNames: ["merch_concert", "merch_standees"], authorID: "u-berry", collectionID: berryCollectionID, categoryTags: ["演唱会周边", "痛包", "自印团"], fandomTags: ["应援", "收纳"], price: "¥58/套", deposit: "¥20 定金", deadline: Self.date(days: 6, hour: 20), condition: "满 100 套生产，当前 73 套", isFormed: false, description: "黑粉色痛包挂件、证件卡套、应援棒收纳套组合。适合巡演现场携带。", wechat: "BerryDollClub", qq: "448102930", groupInfo: "QQ群 518 221 974", externalLink: "https://forms.example/concertbag", createdAt: now.addingTimeInterval(-3600 * 3), likedCount: 1188, favoriteCount: 609, commentCount: 41, reportCount: 0, status: .active, imageAspect: 1.08),
            GroupBuyPost(id: "p-my-pinggu", title: "2026冬兵生日团角色余量更新", imageNames: ["merch_badges", "merch_standees"], authorID: "u-me", groupType: .splitGoods, collectionID: myCollectionID, categoryTags: ["吧唧", "立牌", "拼谷"], fandomTags: ["Steve Rogers", "Bucky Barnes", "Tony Stark"], price: "¥35-68", deposit: "全款/定金", deadline: Self.date(days: 4, hour: 22), condition: "角色位有余量即可认领，售罄后从列表隐藏", isFormed: true, description: "这里是团长本人可维护的拼谷演示帖，可以在详情页实时编辑未售角色和数量。", wechat: "PanPanGroup", qq: "638441116", groupInfo: "QQ群 638 441 116，备注：冬兵生日团", externalLink: "", createdAt: now.addingTimeInterval(-1800), likedCount: 126, favoriteCount: 48, commentCount: 3, reportCount: 0, status: .active, imageAspect: 1.04, pingguAveragePrice: "均价35元/吧唧", pingguNote: "目前还缺主角团角色位", unsoldRoles: [UnsoldRole(name: "Steve Rogers", quantity: 2), UnsoldRole(name: "Bucky Barnes", quantity: 3), UnsoldRole(name: "Tony Stark", quantity: 5)])
        ]
        posts = initialPosts
        collections = [
            GroupCollection(id: myCollectionID, ownerID: "u-me", name: "2026冬兵生日团", contactWechat: "PanPanGroup", contactQQ: "638441116", groupInfo: "QQ群 638 441 116，备注：冬兵生日团", deadline: Self.date(days: 4, hour: 22), defaultNote: "同一拼谷团内的宣传、进度、角色余量更新共用联系方式和截团时间。", postIDs: ["p-my-pinggu"], createdAt: now.addingTimeInterval(-3600 * 3)),
            GroupCollection(id: winterCollectionID, ownerID: "u-moon", name: "2026冬兵生日团", contactWechat: "MoonPin0909", contactQQ: "190443821", groupInfo: "微信群复制微信后拉群，备注：冬兵生日团", deadline: Self.date(days: 3, hour: 23), defaultNote: "同一生日团内宣传、进度和余量更新共用联系方式与截团时间。", postIDs: ["p-badge", "p-stand"], createdAt: now.addingTimeInterval(-3600 * 26)),
            GroupCollection(id: tourCollectionID, ownerID: "u-echo", name: "巡演补款小卡团", contactWechat: "EchoGB2026", contactQQ: "82190477", groupInfo: "QQ群 743 219 008，答案：小卡", deadline: Self.date(days: 1, hour: 22), defaultNote: "巡演相关制品统一在原群登记，补款、余量和到货更新都会归入这个合集。", postIDs: ["p-card", "p-album"], createdAt: now.addingTimeInterval(-3600 * 42)),
            GroupCollection(id: berryCollectionID, ownerID: "u-berry", name: "棉花娃衣配件团", contactWechat: "BerryDollClub", contactQQ: "448102930", groupInfo: "QQ群 518 221 974", deadline: Self.date(days: 6, hour: 20), defaultNote: "棉花娃娃衣、痛包配件和收纳周边统一更新余量与截团时间。", postIDs: ["p-plush", "p-concert"], createdAt: now.addingTimeInterval(-3600 * 18)),
            GroupCollection(id: blackCollectionID, ownerID: "u-black", name: "星心饰品拼谷团", contactWechat: "BlackBagel2026", contactQQ: "60092118", groupInfo: "微信群，复制微信备注：星心", deadline: Self.date(days: 4, hour: 22), defaultNote: "小众饰品和孤品拼谷信息统一放在这里，余量按帖子更新。", postIDs: ["p-jewelry"], createdAt: now.addingTimeInterval(-3600 * 16)),
            GroupCollection(id: moonMagazineCollectionID, ownerID: "u-moon", name: "杂志切页自印团", contactWechat: "MoonPin0909", contactQQ: "190443821", groupInfo: "QQ群 204 118 776", deadline: Self.date(days: 2, hour: 18), defaultNote: "杂志切页、卡册和相关自印内容统一登记，进度与补款后续在合集内更新。", postIDs: ["p-magazine"], createdAt: now.addingTimeInterval(-3600 * 10))
        ]
        reviews = [
            ReviewPost(id: "r-1", imageName: "merch_badges", body: "上一团吧唧到货，电镀质感比预期好。", groupBuyPostID: "p-badge", publisherID: "u-moon", authorID: "u-me", likedCount: 88, commentCount: 9, createdAt: now.addingTimeInterval(-86400 * 3))
        ]
        comments = [
            Comment(id: "c-1", body: "还能上车吗？想要两套小卡。", authorID: "u-me", postID: "p-card", replyToID: nil, createdAt: now.addingTimeInterval(-1400), status: .active),
            Comment(id: "c-2", body: "可以，表单里备注昵称就行，今晚统一拉群。", authorID: "u-echo", postID: "p-card", replyToID: "c-1", createdAt: now.addingTimeInterval(-1100), status: .active),
            Comment(id: "c-3", body: "立牌会有单人拆卖吗？", authorID: "u-berry", postID: "p-stand", replyToID: nil, createdAt: now.addingTimeInterval(-2800), status: .active),
            Comment(id: "c-4", body: "蹲补款提醒，怕错过。", authorID: "u-me", postID: "p-album", replyToID: nil, createdAt: now.addingTimeInterval(-5200), status: .active)
        ]
        threads = [
            MessageThread(id: "t-card", buyerUserID: "u-me", publisherUserID: "u-echo", relatedPostID: "p-card", messages: [
                DirectMessage(id: "m-1", senderID: "u-me", body: "小卡套组还能上车吗？", createdAt: now.addingTimeInterval(-3600)),
                DirectMessage(id: "m-2", senderID: "u-echo", body: "可以，复制微信备注“巡演小卡”我拉你进群。", createdAt: now.addingTimeInterval(-3200)),
                DirectMessage(id: "m-share-card", senderID: "u-me", body: "分享了制品：巡演限定小卡套组二开", createdAt: now.addingTimeInterval(-2600), sharedPostID: "p-card")
            ], unreadCount: 1, updatedAt: now.addingTimeInterval(-3200)),
            MessageThread(id: "t-plush", buyerUserID: "u-me", publisherUserID: "u-berry", relatedPostID: "p-plush", messages: [
                DirectMessage(id: "m-3", senderID: "u-berry", body: "15cm 娃衣还有粉色和灰色。", createdAt: now.addingTimeInterval(-9200))
            ], unreadCount: 0, updatedAt: now.addingTimeInterval(-9200))
        ]
        reports = [
            Report(id: "rp-1", target: .post("p-badge"), reason: "无效联系方式", detail: "用户反馈微信搜索不到，需团长确认。", reporterID: "u-me", status: .pending, adminResult: nil, handledAt: nil),
            Report(id: "rp-2", target: .post("p-magazine"), reason: "过期未处理", detail: "评论里有人说截团时间不一致。", reporterID: "u-black", status: .pending, adminResult: nil, handledAt: nil)
        ]
        reminders = [
            Reminder(id: "re-card", userID: "u-me", postID: "p-card", deadline: initialPosts[0].deadline, remindAt: initialPosts[0].deadline.addingTimeInterval(-3600 * 3), hasReminded: false),
            Reminder(id: "re-album", userID: "u-me", postID: "p-album", deadline: initialPosts[4].deadline, remindAt: initialPosts[4].deadline.addingTimeInterval(-3600 * 6), hasReminded: true)
        ]
        let initialFollowedUserIDs: Set<String> = ["u-echo", "u-black"]
        likedPostIDs = startsLoggedIn ? Self.demoLikedPostIDs : []
        favoritePostIDs = startsLoggedIn ? Self.demoFavoritePostIDs : []
        followedUserIDs = startsLoggedIn ? initialFollowedUserIDs : []
        followingIDsByUserID = [
            "u-me": initialFollowedUserIDs,
            "u-berry": ["u-me"],
            "u-echo": ["u-moon", "u-me"],
            "u-black": ["u-echo", "u-me"],
            "u-moon": ["u-black"]
        ]
        browsingHistoryIDs = UserDefaults.standard.stringArray(forKey: Self.browsingHistoryDefaultsKey(for: Self.demoUserID)) ?? []
        searchHistory = UserDefaults.standard.stringArray(forKey: Self.searchHistoryDefaultsKey) ?? Self.defaultSearchHistory
        restorePersistedThreads()
        if isBackendEnabled {
            if backendToken == nil {
                isLoggedIn = false
            } else {
                Task { await refreshFromBackend() }
            }
        }
    }

    var currentUser: User {
        users.first(where: { $0.id == currentUserID })!
    }

    func loadBackendIfNeeded() async {
        guard isBackendEnabled else { return }
        await refreshFromBackend(silent: true)
    }

    func backendModeChanged() {
        if isBackendEnabled {
            if backendToken == nil {
                logOut()
                showToast("已切换到阿里云后端，请登录测试账号")
            } else {
                Task { await refreshFromBackend() }
            }
        } else {
            backendToken = nil
            showToast("已切换到本地 Mock 数据")
        }
    }

    func refreshFromBackend(silent: Bool = false) async {
        guard isBackendEnabled, let backendToken else { return }
        do {
            let payload = try await backendClient.bootstrap(token: backendToken)
            applyBackendPayload(payload)
            if !silent {
                showToast("云端数据已同步")
            }
        } catch {
            if !silent {
                showToast(error.localizedDescription)
            }
        }
    }

    private func applyBackendPayload(_ payload: BackendPayload) {
        let previousUserID = currentUserID
        let previousLoggedIn = isLoggedIn
        if let token = payload.token {
            backendToken = token
        }
        if let users = payload.users {
            self.users = users.map { $0.localUser() }
        }
        if let posts = payload.posts {
            self.posts = posts.map { $0.localPost() }
        }
        if let collections = payload.collections {
            self.collections = collections.map { $0.localCollection() }
        }
        if let comments = payload.comments {
            self.comments = comments.map { $0.localComment() }
        }
        if let reports = payload.reports {
            self.reports = reports.map { $0.localReport() }
        }
        if let likedPostIDs = payload.likedPostIDs {
            self.likedPostIDs = Set(likedPostIDs)
        }
        if let favoritePostIDs = payload.favoritePostIDs {
            self.favoritePostIDs = Set(favoritePostIDs)
        }
        if let followedUserIDs = payload.followedUserIDs {
            self.followedUserIDs = Set(followedUserIDs)
        }
        if let currentUser = payload.currentUser?.localUser() {
            if !users.contains(where: { $0.id == currentUser.id }) {
                users.append(currentUser)
            }
            currentUserID = currentUser.id
            browsingHistoryIDs = UserDefaults.standard.stringArray(forKey: Self.browsingHistoryDefaultsKey(for: currentUser.id)) ?? []
        }
        followingIDsByUserID[currentUserID] = followedUserIDs
        isLoggedIn = payload.currentUser != nil || backendToken != nil
        isAuthPromptPresented = false
        if previousUserID != currentUserID || previousLoggedIn != isLoggedIn {
            authSessionVersion = UUID()
        }
    }

    private func runBackendMutation(refreshAfterSuccess: Bool = false, refreshAfterFailure: Bool = false, _ operation: @escaping (String) async throws -> Void) {
        guard isBackendEnabled, let backendToken else { return }
        Task {
            do {
                try await operation(backendToken)
                if refreshAfterSuccess {
                    await refreshFromBackend(silent: true)
                }
            } catch {
                showToast(error.localizedDescription)
                if refreshAfterFailure {
                    await refreshFromBackend(silent: true)
                }
            }
        }
    }

    var activePosts: [GroupBuyPost] {
        posts.filter { $0.status == .active }
    }

    var messageThreads: [MessageThread] {
        threads
            .filter(isCurrentUserThread)
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    var currentUserReminders: [Reminder] {
        reminders
            .filter { $0.userID == currentUserID }
            .sorted { $0.deadline < $1.deadline }
    }

    func messageThread(id: String) -> MessageThread? {
        threads.first { $0.id == id && isCurrentUserThread($0) }
    }

    func isCurrentUserThread(_ thread: MessageThread) -> Bool {
        thread.buyerUserID == currentUserID || thread.publisherUserID == currentUserID
    }

    func peerUserID(for thread: MessageThread) -> String {
        thread.publisherUserID == currentUserID ? thread.buyerUserID : thread.publisherUserID
    }

    func user(id: String) -> User {
        users.first(where: { $0.id == id }) ?? currentUser
    }

    func post(id: String) -> GroupBuyPost? {
        posts.first(where: { $0.id == id })
    }

    func collection(id: String?) -> GroupCollection? {
        guard let id else { return nil }
        return collections.first(where: { $0.id == id })
    }

    func registrationID(for userID: String) -> String {
        let registrationNumber = (users.firstIndex { $0.id == userID } ?? 0) + 1
        return String(format: "%06d", registrationNumber)
    }

    func followingUsers(for userID: String) -> [User] {
        let ids = followingIDs(for: userID)
        return users
            .filter { ids.contains($0.id) }
            .sorted { registrationID(for: $0.id) < registrationID(for: $1.id) }
    }

    func followerUsers(for userID: String) -> [User] {
        users
            .filter { followingIDs(for: $0.id).contains(userID) }
            .sorted { registrationID(for: $0.id) < registrationID(for: $1.id) }
    }

    func mutualFriendUsers() -> [User] {
        users
            .filter { user in
                user.id != currentUserID &&
                followedUserIDs.contains(user.id) &&
                followingIDs(for: user.id).contains(currentUserID)
            }
            .sorted { registrationID(for: $0.id) < registrationID(for: $1.id) }
    }

    func relationUsers(for userID: String, kind: UserRelationKind) -> [User] {
        switch kind {
        case .following: followingUsers(for: userID)
        case .followers: followerUsers(for: userID)
        }
    }

    private func followingIDs(for userID: String) -> Set<String> {
        userID == currentUserID ? followedUserIDs : (followingIDsByUserID[userID] ?? [])
    }

    func collections(ownerID: String) -> [GroupCollection] {
        collections
            .filter { $0.ownerID == ownerID }
            .sorted { lhs, rhs in
                if lhs.isEnded != rhs.isEnded {
                    return !lhs.isEnded
                }
                return lhs.createdAt > rhs.createdAt
            }
    }

    func unfinishedCollectionCount(ownerID: String) -> Int {
        collections.filter { $0.ownerID == ownerID && !$0.isEnded }.count
    }

    func completedGroupTotal(for userID: String) -> Int {
        user(id: userID).postCount
    }

    func posts(in collectionID: String) -> [GroupBuyPost] {
        guard let collection = collection(id: collectionID) else { return [] }
        return sortedFeedPosts(collection.postIDs.compactMap(post).filter { $0.status == .active })
    }

    func sortedFeedPosts(_ posts: [GroupBuyPost]) -> [GroupBuyPost] {
        posts.sorted { lhs, rhs in
            if lhs.isEnded != rhs.isEnded {
                return !lhs.isEnded
            }
            return lhs.createdAt > rhs.createdAt
        }
    }

    func splitGoodsPosts(matchingRole keyword: String) -> [GroupBuyPost] {
        let trimmed = keyword.trimmed
        guard !trimmed.isEmpty else { return [] }
        return activePosts
            .filter { post in
                post.groupType == .splitGoods &&
                post.unsoldRoles.contains { role in
                    role.isAvailable && SearchMatcher.matches(query: trimmed, candidate: role.name)
                }
            }
            .sorted { lhs, rhs in
                let lhsScore = lhs.unsoldRoles.map { SearchMatcher.score(query: trimmed, candidate: $0.name) }.max() ?? 0
                let rhsScore = rhs.unsoldRoles.map { SearchMatcher.score(query: trimmed, candidate: $0.name) }.max() ?? 0
                if lhsScore != rhsScore { return lhsScore > rhsScore }
                return lhs.createdAt > rhs.createdAt
            }
    }

    func groupLeaderUsers(matching keyword: String) -> [User] {
        let trimmed = keyword.trimmed
        let userMatches = users.filter { user in
            guard user.id != currentUserID else { return false }
            guard !trimmed.isEmpty else { return false }
            let authoredText = posts
                .filter { $0.authorID == user.id && $0.status == .active }
                .flatMap { post in
                    [post.title, post.description, post.price] + post.categoryTags + post.fandomTags + post.unsoldRoles.map(\.name)
                }
                .joined(separator: " ")
            let searchableText = [
                user.nickname,
                user.redBookID,
                user.bio,
                user.region,
                user.email,
                authoredText
            ]
                .joined(separator: " ")
            return SearchMatcher.matches(query: trimmed, candidate: searchableText)
        }

        return userMatches.sorted { lhs, rhs in
            let lhsScore = SearchMatcher.score(query: trimmed, candidate: [lhs.nickname, lhs.redBookID, lhs.bio, lhs.region].joined(separator: " "))
            let rhsScore = SearchMatcher.score(query: trimmed, candidate: [rhs.nickname, rhs.redBookID, rhs.bio, rhs.region].joined(separator: " "))
            if lhsScore != rhsScore { return lhsScore > rhsScore }
            if followedUserIDs.contains(lhs.id) != followedUserIDs.contains(rhs.id) {
                return followedUserIDs.contains(lhs.id)
            }
            return lhs.followersCount > rhs.followersCount
        }
    }

    func availableRoles(for postID: String) -> [UnsoldRole] {
        post(id: postID)?.unsoldRoles.filter(\.isAvailable).sorted { $0.name < $1.name } ?? []
    }

    func browsingHistoryPosts() -> [GroupBuyPost] {
        browsingHistoryIDs.compactMap(post).filter { $0.status == .active }
    }

    func recordBrowse(postID: String) {
        browsingHistoryIDs.removeAll { $0 == postID }
        browsingHistoryIDs.insert(postID, at: 0)
        if browsingHistoryIDs.count > 30 {
            browsingHistoryIDs = Array(browsingHistoryIDs.prefix(30))
        }
    }

    func recordSearchHistory(_ term: String) {
        let trimmed = term.trimmed
        guard !trimmed.isEmpty else { return }
        searchHistory.removeAll { $0.localizedCaseInsensitiveCompare(trimmed) == .orderedSame }
        searchHistory.insert(trimmed, at: 0)
        if searchHistory.count > 20 {
            searchHistory = Array(searchHistory.prefix(20))
        }
    }

    func removeBrowsingHistory(postIDs: Set<String>) {
        browsingHistoryIDs.removeAll { postIDs.contains($0) }
        showToast(postIDs.isEmpty ? "未选择记录" : "已删除浏览记录")
    }

    func comments(for postID: String) -> [Comment] {
        comments.filter { $0.postID == postID && $0.status == .active }.sorted { $0.createdAt < $1.createdAt }
    }

    func comment(id: String) -> Comment? {
        comments.first(where: { $0.id == id })
    }

    func canDeleteComment(_ comment: Comment) -> Bool {
        comment.authorID == currentUserID || post(id: comment.postID)?.authorID == currentUserID
    }

    @discardableResult
    func requireLogin(prompt: String = "登录后才能使用该功能") -> Bool {
        guard isLoggedIn else {
            showToast(prompt)
            isAuthPromptPresented = true
            return false
        }
        return true
    }

    func toggleLike(postID: String) {
        guard requireLogin(prompt: "登录后才能点赞") else { return }
        guard let index = posts.firstIndex(where: { $0.id == postID }) else { return }
        if likedPostIDs.contains(postID) {
            likedPostIDs.remove(postID)
            posts[index].likedCount = max(0, posts[index].likedCount - 1)
            runBackendMutation { token in
                try await self.backendClient.setPostFlag(token: token, postID: postID, flag: "like", enabled: false)
            }
        } else {
            likedPostIDs.insert(postID)
            posts[index].likedCount += 1
            runBackendMutation { token in
                try await self.backendClient.setPostFlag(token: token, postID: postID, flag: "like", enabled: true)
            }
        }
    }

    func toggleFavorite(postID: String) {
        guard requireLogin(prompt: "登录后才能收藏") else { return }
        guard let index = posts.firstIndex(where: { $0.id == postID }) else { return }
        if favoritePostIDs.contains(postID) {
            favoritePostIDs.remove(postID)
            posts[index].favoriteCount = max(0, posts[index].favoriteCount - 1)
            reminders.removeAll { $0.postID == postID && $0.userID == currentUserID }
            showToast("已取消收藏和截团提醒")
            runBackendMutation { token in
                try await self.backendClient.setPostFlag(token: token, postID: postID, flag: "favorite", enabled: false)
            }
        } else {
            favoritePostIDs.insert(postID)
            posts[index].favoriteCount += 1
            let post = posts[index]
            reminders.append(Reminder(id: "re-\(postID)-\(Int(Date().timeIntervalSince1970))", userID: currentUserID, postID: postID, deadline: post.deadline, remindAt: post.deadline.addingTimeInterval(-3600 * 3), hasReminded: false))
            showToast("已收藏，截团前会提醒你")
            runBackendMutation { token in
                try await self.backendClient.setPostFlag(token: token, postID: postID, flag: "favorite", enabled: true)
            }
        }
    }

    func toggleFollow(userID: String) {
        guard requireLogin(prompt: "登录后才能关注") else { return }
        guard userID != currentUserID else { return }
        let targetIndex = users.firstIndex(where: { $0.id == userID })
        let currentIndex = users.firstIndex(where: { $0.id == currentUserID })
        if followedUserIDs.contains(userID) {
            followedUserIDs.remove(userID)
            followingIDsByUserID[currentUserID] = followedUserIDs
            if let currentIndex {
                users[currentIndex].followingCount = followedUserIDs.count
            }
            if let targetIndex {
                users[targetIndex].followersCount = max(0, users[targetIndex].followersCount - 1)
            }
            showToast("已取消关注")
            runBackendMutation { token in
                try await self.backendClient.setFollow(token: token, userID: userID, enabled: false)
            }
        } else {
            followedUserIDs.insert(userID)
            followingIDsByUserID[currentUserID] = followedUserIDs
            if let currentIndex {
                users[currentIndex].followingCount = followedUserIDs.count
            }
            if let targetIndex {
                users[targetIndex].followersCount += 1
            }
            showToast("已关注团长")
            runBackendMutation { token in
                try await self.backendClient.setFollow(token: token, userID: userID, enabled: true)
            }
        }
    }

    func addComment(postID: String, body: String, replyToID: String? = nil) {
        guard requireLogin(prompt: "登录后才能评论") else { return }
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        comments.append(Comment(id: "c-\(UUID().uuidString)", body: trimmed, authorID: currentUserID, postID: postID, replyToID: replyToID, createdAt: Date(), status: .active))
        if let index = posts.firstIndex(where: { $0.id == postID }) {
            posts[index].commentCount += 1
        }
        showToast("评论已发布")
        runBackendMutation { token in
            try await self.backendClient.addComment(token: token, postID: postID, body: trimmed, replyToID: replyToID)
        }
    }

    func copyComment(_ comment: Comment) {
        UIPasteboard.general.string = comment.body
        showToast("已复制评论")
    }

    func deleteComment(commentID: String) {
        guard requireLogin(prompt: "登录后才能删除评论") else { return }
        guard let commentIndex = comments.firstIndex(where: { $0.id == commentID }),
              comments[commentIndex].status == .active else { return }
        let comment = comments[commentIndex]
        guard canDeleteComment(comment) else {
            showToast("只能删除自己的评论")
            return
        }
        comments[commentIndex].status = .deleted
        if let postIndex = posts.firstIndex(where: { $0.id == comment.postID }) {
            posts[postIndex].commentCount = max(0, posts[postIndex].commentCount - 1)
        }
        showToast("评论已删除")
        runBackendMutation { token in
            try await self.backendClient.deleteComment(token: token, commentID: commentID)
        }
    }

    func reportPost(postID: String, reason: String = "用户举报") {
        guard requireLogin(prompt: "登录后才能举报") else { return }
        reports.append(Report(id: "rp-\(UUID().uuidString)", target: .post(postID), reason: reason, detail: "来自详情页的原型举报。", reporterID: currentUserID, status: .pending, adminResult: nil, handledAt: nil))
        if let index = posts.firstIndex(where: { $0.id == postID }) {
            posts[index].reportCount += 1
        }
        showToast("已提交举报，管理员将后审处理")
        runBackendMutation { token in
            try await self.backendClient.reportPost(token: token, postID: postID, reason: reason)
        }
    }

    func handleReport(reportID: String, status: ReportStatus) {
        guard let reportIndex = reports.firstIndex(where: { $0.id == reportID }) else { return }
        reports[reportIndex].status = status
        reports[reportIndex].adminResult = status.rawValue
        reports[reportIndex].handledAt = Date()
        if case .post(let postID) = reports[reportIndex].target,
           let postIndex = posts.firstIndex(where: { $0.id == postID }) {
            switch status {
            case .hidden:
                posts[postIndex].status = .hidden
            case .removed:
                posts[postIndex].status = .removed
            case .warned, .ignored, .pending:
                break
            }
        }
        showToast("处理结果：\(status.rawValue)")
    }

    func copyToPasteboard(_ value: String, label: String) {
        guard requireLogin(prompt: "登录后才能复制内容") else { return }
        UIPasteboard.general.string = value
        showToast("已复制\(label)")
    }

    func posts(tagged tag: String) -> [GroupBuyPost] {
        sortedFeedPosts(activePosts
            .filter { $0.categoryTags.contains(tag) || $0.fandomTags.contains(tag) || $0.title.localizedCaseInsensitiveContains(tag) }
        )
    }

    func canChangeNickname(for user: User) -> Bool {
        guard let lastChangedAt = user.lastNicknameChangedAt,
              let nextAvailableDate = Calendar.current.date(byAdding: .month, value: 4, to: lastChangedAt) else {
            return true
        }
        return Date() >= nextAvailableDate
    }

    func nextNicknameChangeDate(for user: User) -> Date? {
        guard let lastChangedAt = user.lastNicknameChangedAt else { return nil }
        return Calendar.current.date(byAdding: .month, value: 4, to: lastChangedAt)
    }

    func updateCurrentBio(_ bio: String) {
        guard let index = users.firstIndex(where: { $0.id == currentUserID }) else { return }
        users[index].bio = bio.trimmed.isEmpty ? "点击这里，填写简介" : bio.trimmed
        showToast("简介已保存")
    }

    func updateCurrentProfile(nickname: String, redBookID: String, bio: String, gender: String, birthday: String, region: String, avatarSymbol: String, avatarTint: ColorToken, backgroundImageName: String, avatarImageData: Data?, backgroundImageData: Data?) {
        guard let index = users.firstIndex(where: { $0.id == currentUserID }) else { return }
        var rejectedNicknameChange = false
        let trimmedNickname = nickname.trimmed
        if !trimmedNickname.isEmpty && trimmedNickname != users[index].nickname {
            if canChangeNickname(for: users[index]) {
                users[index].nickname = trimmedNickname
                users[index].lastNicknameChangedAt = Date()
            } else {
                rejectedNicknameChange = true
            }
        }
        users[index].redBookID = redBookID.trimmed
        users[index].bio = bio.trimmed.isEmpty ? "点击这里，填写简介" : bio.trimmed
        users[index].gender = gender.trimmed
        users[index].birthday = birthday.trimmed
        users[index].region = region.trimmed
        users[index].avatarSymbol = avatarSymbol.trimmed.isEmpty ? users[index].avatarSymbol : String(avatarSymbol.trimmed.prefix(1))
        users[index].avatarTint = avatarTint
        users[index].backgroundImageName = backgroundImageName
        users[index].avatarImageData = avatarImageData
        users[index].backgroundImageData = backgroundImageData
        showToast(rejectedNicknameChange ? "资料已保存，昵称四个月内只能修改一次" : "资料已保存")
        let updatedUser = users[index]
        let avatarUploadData = avatarImageData
        let backgroundUploadData = backgroundImageData
        runBackendMutation(refreshAfterSuccess: true) { token in
            var avatarObjectKey: String?
            if let avatarUploadData {
                avatarObjectKey = try await self.backendClient.uploadProfileImage(token: token, data: avatarUploadData, kind: "avatar")
            }
            var backgroundObjectKey: String?
            if let backgroundUploadData {
                backgroundObjectKey = try await self.backendClient.uploadProfileImage(token: token, data: backgroundUploadData, kind: "background")
            }
            try await self.backendClient.updateProfile(
                token: token,
                user: updatedUser,
                avatarObjectKey: avatarObjectKey,
                backgroundObjectKey: backgroundObjectKey
            )
        }
    }

    func setLoginState(_ loggedIn: Bool) {
        if loggedIn {
            logInDemoAccount(provider: "账号")
        } else {
            logOut()
        }
    }

    func logOut() {
        isLoggedIn = false
        isAuthPromptPresented = false
        backendToken = nil
        likedPostIDs.removeAll()
        favoritePostIDs.removeAll()
        followedUserIDs.removeAll()
        authSessionVersion = UUID()
        showToast("已退出当前账号")
    }

    func logInDemoAccount(provider: String) {
        switchCurrentUser(to: Self.demoUserID)
        showToast("已通过\(provider)登录")
    }

    @discardableResult
    func requestEmailCode(email: String, purpose: String) async -> Bool {
        let trimmedEmail = email.trimmed
        guard isBackendEnabled else {
            showToast("当前模式不需要邮箱验证码")
            return false
        }
        guard trimmedEmail.contains("@") else {
            showToast("请填写有效邮箱")
            return false
        }
        do {
            try await backendClient.sendEmailCode(email: trimmedEmail, purpose: purpose)
            showToast("验证码已发送，请查看邮箱")
            return true
        } catch {
            showToast(error.localizedDescription)
            return false
        }
    }

    @discardableResult
    func registerAccount(nickname: String, email: String, password: String, code: String = "") async -> Bool {
        let trimmedNickname = nickname.trimmed
        let trimmedEmail = email.trimmed
        let trimmedPassword = password.trimmed
        let trimmedCode = code.trimmed

        if isBackendEnabled {
            guard !trimmedNickname.isEmpty else {
                showToast("请填写昵称")
                return false
            }
            guard trimmedEmail.contains("@") else {
                showToast("请填写有效邮箱")
                return false
            }
            guard trimmedPassword.count >= 6 else {
                showToast("密码至少 6 位")
                return false
            }
            guard trimmedCode.count == 6 else {
                showToast("请填写 6 位验证码")
                return false
            }
            do {
                let payload = try await backendClient.registerWithEmailCode(email: trimmedEmail, password: trimmedPassword, nickname: trimmedNickname, code: trimmedCode)
                applyBackendPayload(payload)
                showToast("注册成功，已登录云端账号")
                return true
            } catch {
                showToast(error.localizedDescription)
                return false
            }
        }

        guard !trimmedNickname.isEmpty else {
            showToast("请填写昵称")
            return false
        }
        guard trimmedEmail.count >= 6 else {
            showToast("请填写有效手机号")
            return false
        }
        guard trimmedPassword.count >= 6 else {
            showToast("密码至少 6 位")
            return false
        }
        guard !users.contains(where: { $0.phoneNumber == trimmedEmail }) else {
            showToast("该手机号已注册")
            return false
        }

        let userID = "u-\(UUID().uuidString)"
        let avatarSymbol = String(trimmedNickname.prefix(1))
        let user = User(
            id: userID,
            nickname: trimmedNickname,
            bio: "点击这里，填写简介",
            followingCount: 0,
            followersCount: 0,
            postCount: 0,
            isRestricted: false,
            canShowContact: true,
            avatarSymbol: avatarSymbol.isEmpty ? "新" : avatarSymbol,
            avatarTint: .rose,
            redBookID: String(trimmedEmail.suffix(8)),
            gender: "未设置",
            birthday: "选择生日",
            region: "未设置",
            backgroundImageName: "merch_magazine",
            phoneNumber: trimmedEmail,
            password: trimmedPassword
        )

        users.append(user)
        followingIDsByUserID[userID] = []
        switchCurrentUser(to: userID)
        showToast("注册成功，已登录")
        return true
    }

    @discardableResult
    func loginWithEmail(email: String, password: String) async -> Bool {
        let trimmedEmail = email.trimmed
        let trimmedPassword = password.trimmed
        if isBackendEnabled {
            do {
                let payload = try await backendClient.login(email: trimmedEmail, password: trimmedPassword)
                applyBackendPayload(payload)
                showToast("云端登录成功")
                return true
            } catch {
                let message = error.localizedDescription == "邮箱或密码不正确" ? "密码和邮箱不匹配" : error.localizedDescription
                showToast(message)
                return false
            }
        }
        guard let user = users.first(where: { $0.phoneNumber == trimmedEmail && $0.password == trimmedPassword }) else {
            showToast("手机号或密码不正确")
            return false
        }
        switchCurrentUser(to: user.id)
        showToast("登录成功")
        return true
    }

    @discardableResult
    func loginWithEmailCode(email: String, code: String) async -> Bool {
        let trimmedEmail = email.trimmed
        let trimmedCode = code.trimmed
        guard isBackendEnabled else {
            showToast("本地模式不支持验证码登录")
            return false
        }
        guard trimmedEmail.contains("@") else {
            showToast("请填写有效邮箱")
            return false
        }
        guard trimmedCode.count == 6 else {
            showToast("请填写 6 位验证码")
            return false
        }
        do {
            let payload = try await backendClient.loginWithEmailCode(email: trimmedEmail, code: trimmedCode)
            applyBackendPayload(payload)
            showToast("验证码登录成功")
            return true
        } catch {
            showToast(error.localizedDescription)
            return false
        }
    }

    private func switchCurrentUser(to userID: String) {
        guard users.contains(where: { $0.id == userID }) else { return }
        UserDefaults.standard.set(browsingHistoryIDs, forKey: Self.browsingHistoryDefaultsKey(for: currentUserID))
        currentUserID = userID
        browsingHistoryIDs = UserDefaults.standard.stringArray(forKey: Self.browsingHistoryDefaultsKey(for: userID)) ?? []
        followedUserIDs = followingIDsByUserID[userID] ?? []
        followingIDsByUserID[userID] = followedUserIDs
        likedPostIDs = userID == Self.demoUserID ? Self.demoLikedPostIDs : []
        favoritePostIDs = userID == Self.demoUserID ? Self.demoFavoritePostIDs : []
        isLoggedIn = true
        isAuthPromptPresented = false
        authSessionVersion = UUID()
    }

    func sharePostToThread(postID: String, threadID: String) {
        guard requireLogin(prompt: "登录后才能私信分享") else { return }
        guard let post = post(id: postID),
              let index = threads.firstIndex(where: { $0.id == threadID && isCurrentUserThread($0) }) else { return }
        threads[index].messages.append(
            DirectMessage(
                id: "m-\(UUID().uuidString)",
                senderID: currentUserID,
                body: "分享了制品：\(post.title)",
                createdAt: Date(),
                sharedPostID: postID
            )
        )
        threads[index].updatedAt = Date()
        persistThreads()
        showToast("已分享给站内好友")
    }

    func sharePostToUser(postID: String, userID: String) {
        guard requireLogin(prompt: "登录后才能私信分享") else { return }
        guard let threadID = threadID(forRecipient: userID, relatedPostID: postID) else { return }
        sharePostToThread(postID: postID, threadID: threadID)
    }

    func shareProfileToThread(userID: String, threadID: String) {
        guard requireLogin(prompt: "登录后才能私信分享") else { return }
        guard let user = users.first(where: { $0.id == userID }),
              let index = threads.firstIndex(where: { $0.id == threadID && isCurrentUserThread($0) }) else { return }
        threads[index].messages.append(
            DirectMessage(
                id: "m-\(UUID().uuidString)",
                senderID: currentUserID,
                body: "分享了主页：\(user.nickname)",
                createdAt: Date(),
                sharedProfileUserID: userID
            )
        )
        threads[index].updatedAt = Date()
        persistThreads()
        showToast("已分享给站内好友")
    }

    func shareProfileToUser(profileUserID: String, recipientUserID: String) {
        guard requireLogin(prompt: "登录后才能私信分享") else { return }
        guard let threadID = threadID(forRecipient: recipientUserID, relatedPostID: profileUserID) else { return }
        shareProfileToThread(userID: profileUserID, threadID: threadID)
    }

    func consultationThreadID(for postID: String) -> String? {
        guard requireLogin(prompt: "登录后才能发私信") else { return nil }
        guard let post = post(id: postID) else { return nil }
        return threadID(forRecipient: post.authorID, relatedPostID: postID)
    }

    func directMessageThreadID(for userID: String) -> String? {
        guard requireLogin(prompt: "登录后才能发私信") else { return nil }
        return threadID(forRecipient: userID, relatedPostID: nil)
    }

    func ensureMutualFriendThreads() {
        for friend in mutualFriendUsers() where !threads.contains(where: { isCurrentUserThread($0) && peerUserID(for: $0) == friend.id && $0.relatedPostID == nil }) {
            let threadID = "t-\(UUID().uuidString)"
            let thread = MessageThread(
                id: threadID,
                buyerUserID: currentUserID,
                publisherUserID: friend.id,
                relatedPostID: nil,
                messages: [],
                unreadCount: 0,
                updatedAt: Date.distantPast
            )
            threads.append(thread)
        }
        persistThreads()
    }

    private func threadID(forRecipient userID: String, relatedPostID: String?) -> String? {
        guard requireLogin(prompt: "登录后才能发私信") else { return nil }
        guard userID != currentUserID else { return nil }
        if let existing = threads.first(where: { isCurrentUserThread($0) && peerUserID(for: $0) == userID && $0.relatedPostID == relatedPostID }) {
            return existing.id
        }
        if let existing = threads.first(where: { isCurrentUserThread($0) && peerUserID(for: $0) == userID }) {
            return existing.id
        }
        let threadID = "t-\(UUID().uuidString)"
        let thread = MessageThread(
            id: threadID,
            buyerUserID: currentUserID,
            publisherUserID: userID,
            relatedPostID: relatedPostID,
            messages: [],
            unreadCount: 0,
            updatedAt: Date()
        )
        threads.insert(thread, at: 0)
        persistThreads()
        return threadID
    }

    func sendMessage(threadID: String, body: String) -> Bool {
        guard requireLogin(prompt: "登录后才能发私信") else { return false }
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let index = threads.firstIndex(where: { $0.id == threadID && isCurrentUserThread($0) }) else { return false }
        guard canSendMessage(in: threads[index]) else {
            showToast("对方未关注你时，回复前最多发送两条消息")
            return false
        }
        threads[index].messages.append(DirectMessage(id: "m-\(UUID().uuidString)", senderID: currentUserID, body: trimmed, createdAt: Date()))
        threads[index].updatedAt = Date()
        threads[index].unreadCount = 0
        persistThreads()
        return true
    }

    func sendImageMessage(threadID: String, imageData: Data) -> Bool {
        guard requireLogin(prompt: "登录后才能发私信") else { return false }
        guard let index = threads.firstIndex(where: { $0.id == threadID && isCurrentUserThread($0) }) else { return false }
        guard canSendMessage(in: threads[index]) else {
            showToast("对方未关注你时，回复前最多发送两条消息")
            return false
        }
        let storedImageData = Self.normalizedMessageImageData(imageData)
        threads[index].messages.append(
            DirectMessage(
                id: "m-\(UUID().uuidString)",
                senderID: currentUserID,
                body: "[图片]",
                createdAt: Date(),
                imageData: storedImageData
            )
        )
        threads[index].updatedAt = Date()
        threads[index].unreadCount = 0
        persistThreads()
        return true
    }

    private func canSendMessage(in thread: MessageThread) -> Bool {
        guard limitsUnrepliedMessages else { return true }
        let peerFollowsCurrentUser = followingIDs(for: peerUserID(for: thread)).contains(currentUserID)
        guard !peerFollowsCurrentUser else { return true }
        let trailingOwnMessages = thread.messages.reversed().prefix { $0.senderID == currentUserID }.count
        return trailingOwnMessages < 2
    }

    func markThreadRead(threadID: String) {
        guard let index = threads.firstIndex(where: { $0.id == threadID && isCurrentUserThread($0) }),
              threads[index].unreadCount > 0 else { return }
        threads[index].unreadCount = 0
        persistThreads()
    }

    @discardableResult
    func createCollection(name: String, wechat: String, qq: String, groupInfo: String, deadline: Date, defaultNote: String) -> String? {
        let trimmedName = name.trimmed
        guard !trimmedName.isEmpty else {
            showToast("请先填写合集名称")
            return nil
        }
        let collection = GroupCollection(
            id: "col-\(UUID().uuidString)",
            ownerID: currentUserID,
            name: trimmedName,
            contactWechat: wechat.trimmed,
            contactQQ: qq.trimmed,
            groupInfo: groupInfo.trimmed,
            deadline: deadline,
            defaultNote: defaultNote.trimmed.isEmpty ? "该合集内帖子共享联系方式、截团时间和默认说明。" : defaultNote.trimmed,
            postIDs: [],
            createdAt: Date()
        )
        collections.insert(collection, at: 0)
        showToast("已创建拼团合集")
        runBackendMutation { token in
            try await self.backendClient.createCollection(token: token, collection: collection)
        }
        return collection.id
    }

    func deleteCollections(ids: Set<String>) {
        let ownedIDs = Set(collections.filter { ids.contains($0.id) && $0.ownerID == currentUserID }.map(\.id))
        guard !ownedIDs.isEmpty else {
            showToast("请选择要删除的合集")
            return
        }
        collections.removeAll { ownedIDs.contains($0.id) }
        for index in posts.indices {
            if let collectionID = posts[index].collectionID, ownedIDs.contains(collectionID) {
                posts[index].collectionID = nil
            }
        }
        showToast("已删除 \(ownedIDs.count) 个拼团合集")
        runBackendMutation(refreshAfterFailure: true) { token in
            for collectionID in ownedIDs {
                try await self.backendClient.deleteCollection(token: token, collectionID: collectionID)
            }
        }
    }

    func addPost(_ postID: String, to collectionID: String) {
        guard let collectionIndex = collections.firstIndex(where: { $0.id == collectionID }),
              let postIndex = posts.firstIndex(where: { $0.id == postID }) else { return }
        for index in collections.indices where collections[index].id != collectionID {
            collections[index].postIDs.removeAll { $0 == postID }
        }
        if !collections[collectionIndex].postIDs.contains(postID) {
            collections[collectionIndex].postIDs.append(postID)
        }
        posts[postIndex].collectionID = collectionID
        showToast("已加入合集")
    }

    func removePost(_ postID: String, from collectionID: String) {
        guard let collectionIndex = collections.firstIndex(where: { $0.id == collectionID }),
              let postIndex = posts.firstIndex(where: { $0.id == postID }) else { return }
        if posts[postIndex].collectionID == collectionID {
            showToast("帖子必须保留在一个合集里")
            return
        }
        collections[collectionIndex].postIDs.removeAll { $0 == postID }
        showToast("已移出合集")
    }

    func deleteOwnPost(postID: String) {
        guard let postIndex = posts.firstIndex(where: { $0.id == postID }),
              posts[postIndex].authorID == currentUserID else { return }
        posts[postIndex].status = .deleted
        likedPostIDs.remove(postID)
        favoritePostIDs.remove(postID)
        reminders.removeAll { $0.postID == postID }
        browsingHistoryIDs.removeAll { $0 == postID }
        for collectionIndex in collections.indices {
            collections[collectionIndex].postIDs.removeAll { $0 == postID }
        }
        showToast("帖子已删除")
        runBackendMutation { token in
            try await self.backendClient.deletePost(token: token, postID: postID)
        }
    }

    func addUnsoldRole(postID: String, name: String, quantity: Int, priceAdjustment: Double = 0) {
        let trimmed = name.trimmed
        guard !trimmed.isEmpty,
              quantity > 0,
              let index = posts.firstIndex(where: { $0.id == postID }) else { return }
        posts[index].unsoldRoles.append(UnsoldRole(name: trimmed, quantity: quantity, priceAdjustment: priceAdjustment))
        showToast("已更新角色余量")
    }

    func updateUnsoldRole(postID: String, roleID: String, name: String, quantity: Int, priceAdjustment: Double) {
        guard let postIndex = posts.firstIndex(where: { $0.id == postID }),
              let roleIndex = posts[postIndex].unsoldRoles.firstIndex(where: { $0.id == roleID }) else { return }
        posts[postIndex].unsoldRoles[roleIndex].name = name.trimmed
        posts[postIndex].unsoldRoles[roleIndex].quantity = max(0, quantity)
        posts[postIndex].unsoldRoles[roleIndex].priceAdjustment = priceAdjustment
    }

    func removeUnsoldRole(postID: String, roleID: String) {
        guard let postIndex = posts.firstIndex(where: { $0.id == postID }) else { return }
        posts[postIndex].unsoldRoles.removeAll { $0.id == roleID }
        showToast("已删除角色")
    }

    func createPost(title: String, groupType: GroupBuyType, collectionID: String, imageNames: [String], uploadedImageData: [Data], tags: [String], price: String, deposit: String, deadline: Date, condition: String, wechat: String, qq: String, groupInfo: String, description: String, pingguAveragePrice: String, pingguNote: String, unsoldRoles: [UnsoldRole]) {
        guard let inherited = collection(id: collectionID) else {
            showToast("请先选择拼团合集")
            return
        }
        let postID = "p-\(UUID().uuidString)"
        let post = GroupBuyPost(
            id: postID,
            title: title,
            imageNames: imageNames.isEmpty ? ["merch_photocards"] : imageNames,
            uploadedImageData: uploadedImageData,
            authorID: currentUserID,
            groupType: groupType,
            collectionID: inherited.id,
            categoryTags: tags,
            fandomTags: [],
            price: price,
            deposit: deposit,
            deadline: inherited.deadline,
            condition: condition,
            isFormed: false,
            description: description,
            wechat: inherited.contactWechat,
            qq: inherited.contactQQ,
            groupInfo: inherited.groupInfo,
            externalLink: "",
            createdAt: Date(),
            likedCount: 0,
            favoriteCount: 0,
            commentCount: 0,
            reportCount: 0,
            status: .active,
            imageAspect: 1.08,
            pingguAveragePrice: groupType == .splitGoods ? pingguAveragePrice : "",
            pingguNote: groupType == .splitGoods ? pingguNote : "",
            unsoldRoles: groupType == .splitGoods ? unsoldRoles.filter(\.isAvailable) : []
        )
        posts.insert(post, at: 0)
        if let index = collections.firstIndex(where: { $0.id == inherited.id }) {
            collections[index].postIDs.insert(postID, at: 0)
        }
        showToast("发布成功，已进入\(groupType.moduleTitle)模块")
        if isBackendEnabled {
            Task {
                guard let backendToken else { return }
                do {
                    let objectKeys = try await backendClient.uploadPostImages(token: backendToken, images: uploadedImageData)
                    var remotePost = post
                    remotePost.imageObjectKeys = objectKeys
                    try await backendClient.createPost(token: backendToken, post: remotePost, imageObjectKeys: objectKeys)
                    await refreshFromBackend(silent: true)
                    showToast("发布成功，已同步到云端")
                } catch {
                    showToast(error.localizedDescription)
                }
            }
        }
    }

    func showToast(_ message: String) {
        toastMessage = message
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            if self?.toastMessage == message {
                self?.toastMessage = nil
            }
        }
    }

    private static func date(days: Int, hour: Int) -> Date {
        let base = Calendar.current.date(byAdding: .day, value: days, to: Date()) ?? Date()
        return Calendar.current.date(bySettingHour: hour, minute: 0, second: 0, of: base) ?? base
    }
}

struct HomeView: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var feed: HomeFeed = .followGroup

    var posts: [GroupBuyPost] {
        switch feed {
        case .followGroup:
            store.sortedFeedPosts(store.activePosts.filter { $0.groupType == .followGroup })
        case .splitGoods:
            store.sortedFeedPosts(store.activePosts.filter { $0.groupType == .splitGoods })
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HomeHeader(feed: $feed, onSelect: selectFeed)
            ScrollView(showsIndicators: false) {
                WaterfallGrid(posts: posts)
                    .padding(.horizontal, 12)
                    .padding(.top, 12)
                    .padding(.bottom, 28)
                    .id(feed)
                    .transition(.opacity.combined(with: .move(edge: feed == .splitGoods ? .trailing : .leading)))
                    .animation(.spring(response: 0.28, dampingFraction: 0.86), value: feed)
            }
        }
        .contentShape(Rectangle())
        .simultaneousGesture(
            DragGesture(minimumDistance: 28)
                .onEnded(handleFeedSwipe)
        )
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

    private func handleFeedSwipe(_ value: DragGesture.Value) {
        guard abs(value.translation.width) > 88,
              abs(value.translation.height) < 70 else { return }
        if value.translation.width < 0 {
            selectFeed(.splitGoods)
        } else {
            selectFeed(.followGroup)
        }
    }
}

enum HomeFeed: String, CaseIterable, Identifiable {
    case followGroup = "跟团"
    case splitGoods = "拼谷"

    var id: String { rawValue }
}

struct HomeHeader: View {
    @Binding var feed: HomeFeed
    let onSelect: (HomeFeed) -> Void

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
                                    .font(.system(size: 22, weight: feed == item ? .bold : .semibold))
                                    .foregroundStyle(feed == item ? Theme.text : Theme.subtext)
                                Capsule()
                                    .fill(feed == item ? Theme.hotPink : Color.clear)
                                    .frame(width: 40, height: 4)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                Spacer()
                NavigationLink(value: Route.search) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .frame(width: 44, height: 44)
                }
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
                                    .font(.system(size: 15, weight: .medium))
                                    .foregroundStyle(Theme.text.opacity(0.88))
                                    .lineLimit(1)
                                    .frame(width: 92)
                            }
                        }
                        .buttonStyle(.plain)
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
    private let spacing: CGFloat = FeedCardMetrics.columnSpacing

    private var columnWidth: CGFloat {
        FeedCardMetrics.columnWidth(screenWidth: UIScreen.main.bounds.width)
    }

    private var leftPosts: [GroupBuyPost] {
        posts.enumerated().filter { $0.offset.isMultiple(of: 2) }.map(\.element)
    }

    private var rightPosts: [GroupBuyPost] {
        posts.enumerated().filter { !$0.offset.isMultiple(of: 2) }.map(\.element)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            LazyVStack(spacing: 14) {
                ForEach(leftPosts) { post in
                    PostCard(post: post, cardWidth: columnWidth)
                }
            }
            LazyVStack(spacing: 14) {
                ForEach(rightPosts) { post in
                    PostCard(post: post, cardWidth: columnWidth)
                }
            }
        }
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
                        PostImageView(post: livePost)
                            .scaledToFill()
                            .frame(width: cardWidth, height: FeedCardMetrics.imageHeight(for: cardWidth))
                            .clipped()
                    }
                    .frame(width: cardWidth, height: FeedCardMetrics.imageHeight(for: cardWidth))
                    .overlay(alignment: .topLeading) {
                        PostCardTypeBadge(post: livePost)
                            .padding(8)
                    }
                    .overlay(alignment: .topTrailing) {
                        PostCardDeadlineBadge(text: livePost.deadline.shortDeadlineText)
                            .padding(8)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text(livePost.title)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(Theme.text)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)

                        if livePost.groupType == .splitGoods {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(livePost.pingguAveragePrice.isEmpty ? livePost.price : livePost.pingguAveragePrice)
                                    .font(.system(size: 14, weight: .black))
                                    .foregroundStyle(livePost.groupType.accent)
                                if !livePost.pingguNote.isEmpty {
                                    Text(livePost.pingguNote)
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundStyle(Theme.subtext)
                                        .lineLimit(2)
                                }
                            }
                            .padding(9)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(livePost.groupType.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                        }

                        HStack(spacing: 6) {
                            AvatarView(user: author, size: 24)
                            Text(author.nickname)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(Theme.subtext)
                                .lineLimit(1)
                            Spacer(minLength: 4)
                            Color.clear
                                .frame(width: 72, height: 32)
                        }

                        HStack(spacing: 5) {
                            ForEach(livePost.categoryTags.prefix(2), id: \.self) { tag in
                                Text(tag)
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(Theme.softPink)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 4)
                                    .background(Theme.hotPink.opacity(0.13), in: Capsule())
                            }
                        }
                    }
                    .padding(10)
                }
                .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(Theme.hairline, lineWidth: 0.5)
                }
                .frame(width: cardWidth)
            }
            .buttonStyle(.plain)
            .saturation(isEnded ? 0 : 1)
            .opacity(isEnded ? 0.58 : 1)
            .overlay(alignment: .topLeading) {
                if isEnded {
                    Text("已结团")
                        .font(.system(size: 11, weight: .black))
                        .foregroundStyle(Theme.subtext)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(Theme.panelRaised.opacity(0.92), in: Capsule())
                        .padding(8)
                }
            }

            if !isEnded {
                PostLikeCountButton(postID: livePost.id)
                    .padding(.trailing, 8)
                    .padding(.bottom, 42)
            }
        }
        .frame(width: cardWidth)
    }
}

struct PostCardTypeBadge: View {
    let post: GroupBuyPost

    var body: some View {
        Label(post.groupType.rawValue, systemImage: post.groupType.icon)
            .font(.system(size: 11, weight: .black))
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.82)
            .frame(width: 64, height: 28)
            .background(post.groupType.accent.opacity(0.94), in: Capsule())
    }
}

struct PostCardDeadlineBadge: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(Theme.floatingBadgeText)
            .lineLimit(1)
            .minimumScaleFactor(0.78)
            .frame(width: 74, height: 28)
            .background(Theme.floatingBadgeBackground, in: Capsule())
    }
}

struct PostLikeCountButton: View {
    @EnvironmentObject private var store: MockAppStore
    let postID: String

    private var post: GroupBuyPost? {
        store.post(id: postID)
    }

    private var isLiked: Bool {
        store.likedPostIDs.contains(postID)
    }

    var body: some View {
        Button {
            withAnimation(.spring(response: 0.22, dampingFraction: 0.72)) {
                store.toggleLike(postID: postID)
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: isLiked ? "heart.fill" : "heart")
                    .font(.system(size: 17, weight: .semibold))
                    .symbolEffect(.bounce, value: isLiked)
                Text((post?.likedCount ?? 0).formattedCount)
                    .font(.system(size: 13, weight: .semibold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            }
            .foregroundStyle(isLiked ? Theme.hotPink : Theme.subtext)
            .frame(minWidth: 68, minHeight: 32, alignment: .trailing)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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
                LegalSection(title: "我们收集的信息", body: "为提供账号和社区功能，我们会收集邮箱、昵称、个人资料、你主动发布的帖子、评论、私信、举报内容，以及你主动选择上传的图片。"),
                LegalSection(title: "使用目的", body: "这些信息用于注册登录、验证码发送、账号展示、内容发布、互动通知、私信沟通、内容安全、举报处理、客服支持和基础运营维护。"),
                LegalSection(title: "存储与安全", body: "账号密码以哈希形式保存，登录状态使用令牌维护。图片上传到云存储，后端服务访问数据库和对象存储时使用服务端密钥，密钥不会放入 iOS 客户端。"),
                LegalSection(title: "你的选择", body: "你可以退出登录、编辑资料、删除本地浏览记录，或通过平台提供的反馈渠道请求更正、删除账号相关信息。我们不会将上述信息用于跨 App 或跨网站追踪。")
            ]
        case .minorsPolicy:
            return [
                LegalSection(title: "监护人同意", body: "未成年人使用本服务前，应取得父母或其他监护人的同意，并在监护人指导下理解团购信息、个人信息保护和网络交易风险。"),
                LegalSection(title: "最小必要", body: "平台仅围绕账号、内容发布和沟通功能处理必要信息。未成年人不应公开发布身份证件、住址、学校、银行卡、精确定位等敏感信息。"),
                LegalSection(title: "交易提醒", body: "未成年人不应独立进行高金额或高风险交易。涉及付款、补款、退款或线下见面时，应由监护人参与判断并保留沟通凭证。"),
                LegalSection(title: "保护请求", body: "监护人如发现未成年人信息被不当展示或使用，可以通过平台反馈渠道联系我们处理。")
            ]
        case .personalInfoList:
            return [
                LegalSection(title: "账号信息", body: "邮箱用于注册、登录和验证码发送；昵称、头像、简介、地区等资料用于账号展示和社区互动。"),
                LegalSection(title: "用户内容", body: "帖子、评论、私信、举报理由和详情用于展示、沟通、内容管理和安全处理。"),
                LegalSection(title: "图片信息", body: "你主动选择的商品图片、头像或背景图会用于帖子和资料展示。App 只在你选择图片时访问相册。"),
                LegalSection(title: "本地偏好", body: "App 使用 UserDefaults 保存登录状态、深色模式、浏览记录、搜索历史、后端调试偏好等仅本 App 可访问的信息。")
            ]
        case .thirdPartySharingList:
            return [
                LegalSection(title: "云服务", body: "后端部署在云服务器，数据库和对象存储用于保存账号、内容和图片。邮件服务用于发送注册和登录验证码。"),
                LegalSection(title: "外部交易渠道", body: "帖子中可能展示微信、QQ、群聊或表单链接等外部联系方式。你离开本 App 后的信息处理和交易规则由相应第三方或团长负责。"),
                LegalSection(title: "法定披露", body: "如法律法规、监管要求、司法机关或平台安全处置需要，我们可能在必要范围内提供相关信息。"),
                LegalSection(title: "不用于追踪", body: "当前 Beta 版本不接入广告追踪 SDK，不将收集的信息用于跨 App 或跨网站追踪。")
            ]
        }
    }
}

struct LegalDocumentSheet: View {
    let document: LegalDocument

    var body: some View {
        NavigationStack {
            LegalDocumentView(document: document)
        }
        .preferredColorScheme(.dark)
    }
}

struct LegalDocumentView: View {
    @Environment(\.dismiss) private var dismiss
    let document: LegalDocument

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 20) {
                Text("Beta 版本说明")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.hotPink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Theme.hotPink.opacity(0.12), in: Capsule())

                Text("本页面用于内测阶段向用户说明周边团的服务规则和个人信息处理方式。正式公开发布前，页面内容会与 App Store Connect 隐私标签和公开隐私政策 URL 保持一致。")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.subtext)
                    .lineSpacing(6)

                ForEach(document.sections) { section in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(section.title)
                            .font(.system(size: 19, weight: .black))
                            .foregroundStyle(Theme.text)
                        Text(section.body)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Theme.subtext)
                            .lineSpacing(7)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 24)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(document.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("完成") { dismiss() }
                    .foregroundStyle(Theme.hotPink)
            }
        }
    }
}

struct LegalAgreementRow: View {
    @Binding var isAccepted: Bool
    let documents: [LegalDocument]
    var textColor: Color
    var linkColor: Color = Theme.hotPink
    var fontSize: CGFloat = 14
    var iconSize: CGFloat = 18

    @State private var selectedDocument: LegalDocument?

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Button {
                isAccepted.toggle()
            } label: {
                Image(systemName: isAccepted ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: iconSize, weight: .semibold))
                    .foregroundStyle(isAccepted ? Theme.hotPink : Color.white.opacity(0.36))
                    .padding(.top, 1)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isAccepted ? "取消同意协议" : "同意协议")

            VStack(alignment: .leading, spacing: 7) {
                Text("我已阅读并同意")
                    .font(.system(size: fontSize, weight: .semibold))
                    .foregroundStyle(textColor)

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 116), alignment: .leading)], alignment: .leading, spacing: 7) {
                    ForEach(documents) { document in
                        Button {
                            selectedDocument = document
                        } label: {
                            Text("《\(document.shortTitle)》")
                                .font(.system(size: fontSize, weight: .bold))
                                .foregroundStyle(linkColor)
                                .underline()
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .sheet(item: $selectedDocument) { document in
            LegalDocumentSheet(document: document)
        }
    }
}

struct SettingsLegalLinks: View {
    @State private var selectedDocument: LegalDocument?

    private let rows: [[LegalDocument]] = [
        [.personalInfoList, .thirdPartySharingList],
        [.userAgreement, .privacyPolicy],
        [.minorsPolicy]
    ]

    var body: some View {
        VStack(spacing: 10) {
            ForEach(rows.indices, id: \.self) { index in
                HStack(spacing: 12) {
                    ForEach(rows[index]) { document in
                        Button {
                            selectedDocument = document
                        } label: {
                            Text("《\(document.shortTitle)》")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.subtext)
                                .underline()
                                .lineLimit(1)
                                .minimumScaleFactor(0.82)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .multilineTextAlignment(.center)
        .sheet(item: $selectedDocument) { document in
            LegalDocumentSheet(document: document)
        }
    }
}

struct GuestAuthView: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var hasAcceptedTerms = false
    @State private var isRegisterPresented = false
    let onClose: (() -> Void)?

    init(onClose: (() -> Void)? = nil) {
        self.onClose = onClose
    }

    var body: some View {
        ZStack {
            Color(red: 0.015, green: 0.016, blue: 0.022)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                HStack {
                    if let onClose {
                        Button(action: onClose) {
                            Image(systemName: "xmark")
                                .font(.system(size: 20, weight: .bold))
                                .foregroundStyle(Color.white.opacity(0.72))
                                .frame(width: 44, height: 44)
                                .background(Color.white.opacity(0.08), in: Circle())
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer()
                }
                .padding(.horizontal, 22)
                .padding(.top, 34)
                .frame(height: 78)

                Spacer(minLength: 80)

                GuestBrandLogo()

                Spacer()

                VStack(spacing: 28) {
                    VStack(spacing: 18) {
                        Button {
                            isRegisterPresented = true
                        } label: {
                            Label("邮箱注册 / 登录", systemImage: "envelope.fill")
                                .font(.system(size: 22, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .frame(height: 62)
                                .padding(.horizontal, 20)
                                .background(Theme.hotPink, in: Capsule())
                        }
                        .buttonStyle(.plain)

                        Text("Beta 版本仅开放邮箱注册、密码登录和验证码登录。")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color(red: 0.76, green: 0.82, blue: 0.91))
                            .frame(maxWidth: .infinity, alignment: .leading)

                        #if DEBUG
                        VStack(alignment: .leading, spacing: 12) {
                            Text("开发调试入口")
                                .font(.system(size: 13, weight: .black))
                                .foregroundStyle(Color.white.opacity(0.46))

                            HStack(spacing: 12) {
                                Button {
                                    logIn(provider: "微信")
                                } label: {
                                    Label("微信", systemImage: "bubble.left.and.bubble.right.fill")
                                        .font(.system(size: 16, weight: .black))
                                        .foregroundStyle(.white)
                                        .frame(maxWidth: .infinity)
                                        .frame(height: 48)
                                        .background(Color(red: 0.03, green: 0.78, blue: 0.36).opacity(0.82), in: Capsule())
                                }
                                .buttonStyle(.plain)

                                Button {
                                    logIn(provider: "Apple")
                                } label: {
                                    Label("Apple", systemImage: "apple.logo")
                                        .font(.system(size: 16, weight: .black))
                                        .foregroundStyle(.white)
                                        .frame(maxWidth: .infinity)
                                        .frame(height: 48)
                                        .overlay {
                                            Capsule().stroke(Color.white.opacity(0.28), lineWidth: 1)
                                        }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        #endif
                    }

                    LegalAgreementRow(
                        isAccepted: $hasAcceptedTerms,
                        documents: [.userAgreement, .privacyPolicy, .minorsPolicy],
                        textColor: Color(red: 0.76, green: 0.82, blue: 0.91),
                        fontSize: 16,
                        iconSize: 20
                    )
                }
                .padding(.horizontal, 34)
                .padding(.bottom, 34)
            }
        }
        .navigationBarHidden(true)
        .preferredColorScheme(.dark)
        .fullScreenCover(isPresented: $isRegisterPresented) {
            AccountAuthView()
                .environmentObject(store)
                .preferredColorScheme(.dark)
        }
    }

    private func logIn(provider: String) {
        guard hasAcceptedTerms else {
            store.showToast("请先勾选并同意协议")
            return
        }
        store.logInDemoAccount(provider: provider)
    }
}

struct GuestBrandLogo: View {
    private var logoGradient: LinearGradient {
        LinearGradient(
            colors: [
                .white,
                Color(red: 1, green: 0.78, blue: 0.82),
                Theme.hotPink
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(
                    logoGradient,
                    style: StrokeStyle(lineWidth: 8, lineCap: .round, lineJoin: .round)
                )
                .frame(width: 78, height: 78)

            Text("才")
                .font(.system(size: 58, weight: .black, design: .rounded))
                .foregroundStyle(logoGradient)
                .offset(x: -1, y: 2)
        }
        .frame(width: 92, height: 92)
            .shadow(color: Theme.hotPink.opacity(0.26), radius: 14, x: 0, y: 6)
            .accessibilityLabel("团")
    }
}

enum AccountAuthMode: String, CaseIterable, Identifiable {
    case register = "注册"
    case passwordLogin = "密码登录"
    case codeLogin = "验证码登录"

    var id: String { rawValue }

    static func available(isBackendEnabled: Bool) -> [AccountAuthMode] {
        isBackendEnabled ? Self.allCases : [.register, .passwordLogin]
    }
}

struct AccountAuthView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var mode: AccountAuthMode = .register
    @State private var nickname = ""
    @State private var email = ""
    @State private var code = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var hasAcceptedTerms = false
    @State private var isSendingCode = false
    @State private var codeResendSecondsRemaining = 0

    var canSubmit: Bool {
        switch mode {
        case .register:
            !nickname.trimmed.isEmpty &&
            (store.isBackendEnabled ? email.trimmed.contains("@") : email.trimmed.count >= 6) &&
            password.trimmed.count >= 6 &&
            password == confirmPassword &&
            (!store.isBackendEnabled || code.trimmed.count == 6) &&
            hasAcceptedTerms
        case .passwordLogin:
            (store.isBackendEnabled ? email.trimmed.contains("@") : email.trimmed.count >= 6) &&
            !password.trimmed.isEmpty &&
            hasAcceptedTerms
        case .codeLogin:
            store.isBackendEnabled &&
            email.trimmed.contains("@") &&
            code.trimmed.count == 6 &&
            hasAcceptedTerms
        }
    }

    var shouldShowCodeField: Bool {
        store.isBackendEnabled && (mode == .register || mode == .codeLogin)
    }

    var canRequestCode: Bool {
        store.isBackendEnabled && email.trimmed.contains("@") && !isSendingCode && codeResendSecondsRemaining == 0
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(.white)
                        .frame(width: 48, height: 48)
                }
                .buttonStyle(.plain)

                Spacer()

                Text(mode == .register ? "注册账号" : "账号登录")
                    .font(.system(size: 22, weight: .black))
                    .foregroundStyle(.white)

                Spacer()

                Color.clear.frame(width: 48, height: 48)
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 26) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(titleText)
                            .font(.system(size: 34, weight: .black))
                            .foregroundStyle(.white)
                        Text(subtitleText)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(0.56))
                    }
                    .padding(.top, 18)

                    HStack(spacing: 8) {
                        ForEach(AccountAuthMode.available(isBackendEnabled: store.isBackendEnabled)) { item in
                            Button {
                                mode = item
                            } label: {
                                Text(item.rawValue)
                                    .font(.system(size: store.isBackendEnabled ? 14 : 16, weight: .black))
                                    .foregroundStyle(mode == item ? .white : Color.white.opacity(0.52))
                                    .frame(maxWidth: .infinity)
                                    .frame(height: 44)
                                    .background(mode == item ? Theme.hotPink : Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    VStack(spacing: 14) {
                        if mode == .register {
                            AuthTextField(title: "昵称", placeholder: "设置你的昵称", text: $nickname)
                        }
                        AuthTextField(
                            title: store.isBackendEnabled ? "邮箱" : "手机号",
                            placeholder: store.isBackendEnabled ? "输入邮箱" : "输入手机号",
                            text: $email,
                            keyboardType: store.isBackendEnabled ? .emailAddress : .phonePad,
                            textContentType: store.isBackendEnabled ? .emailAddress : .telephoneNumber
                        )
                        if shouldShowCodeField {
                            HStack(alignment: .bottom, spacing: 10) {
                                AuthTextField(title: "验证码", placeholder: "6 位数字", text: $code, keyboardType: .numberPad, textContentType: .oneTimeCode)
                                Button {
                                    Task { await requestCode() }
                                } label: {
                                    Text(codeButtonTitle)
                                        .font(.system(size: 14, weight: .black))
                                        .foregroundStyle(.white)
                                        .frame(width: 104, height: 52)
                                        .background(canRequestCode ? Theme.hotPink : Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                }
                                .buttonStyle(.plain)
                                .disabled(!canRequestCode)
                            }
                        }
                        if mode != .codeLogin {
                            AuthSecureField(title: "密码", placeholder: mode == .register ? "至少 6 位" : "输入密码", text: $password)
                        }
                        if mode == .register {
                            AuthSecureField(title: "确认密码", placeholder: "再次输入密码", text: $confirmPassword)
                        }
                    }

                    Button {
                        Task {
                            await submit()
                        }
                    } label: {
                        Text(submitText)
                            .font(.system(size: 18, weight: .black))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 54)
                            .background(canSubmit ? Theme.hotPink : Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(!canSubmit)

                    LegalAgreementRow(
                        isAccepted: $hasAcceptedTerms,
                        documents: [.userAgreement, .privacyPolicy, .minorsPolicy],
                        textColor: Color(red: 0.76, green: 0.82, blue: 0.91)
                    )
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 28)
            }
        }
        .background(Color(red: 0.015, green: 0.016, blue: 0.022).ignoresSafeArea())
    }

    private var codeButtonTitle: String {
        if isSendingCode {
            return "发送中"
        }
        if codeResendSecondsRemaining > 0 {
            return "\(codeResendSecondsRemaining)s后重发"
        }
        return "发送验证码"
    }

    private var titleText: String {
        if !store.isBackendEnabled {
            return mode == .register ? "手机号注册" : "手机号登录"
        }
        switch mode {
        case .register: return "邮箱注册"
        case .passwordLogin: return "密码登录"
        case .codeLogin: return "验证码登录"
        }
    }

    private var subtitleText: String {
        if !store.isBackendEnabled {
            return mode == .register ? "创建账号后会自动进入个人主页。" : "输入已注册手机号和密码继续。"
        }
        switch mode {
        case .register:
            return "先获取验证码，设置密码后即可创建账号。"
        case .passwordLogin:
            return "输入已注册邮箱和密码继续。"
        case .codeLogin:
            return "获取邮箱验证码后无需密码即可登录。"
        }
    }

    private var submitText: String {
        switch mode {
        case .register: return "验证并注册"
        case .passwordLogin: return "登录"
        case .codeLogin: return "验证码登录"
        }
    }

    private func requestCode() async {
        isSendingCode = true
        let purpose = mode == .register ? "register" : "login"
        let didSend = await store.requestEmailCode(email: email, purpose: purpose)
        isSendingCode = false
        if didSend {
            startCodeCooldown()
        }
    }

    private func startCodeCooldown() {
        codeResendSecondsRemaining = 60
        Task {
            while codeResendSecondsRemaining > 0 {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                await MainActor.run {
                    if codeResendSecondsRemaining > 0 {
                        codeResendSecondsRemaining -= 1
                    }
                }
            }
        }
    }

    private func submit() async {
        guard hasAcceptedTerms else {
            store.showToast("请先勾选并同意协议")
            return
        }
        switch mode {
        case .register:
            guard password == confirmPassword else {
                store.showToast("两次输入的密码不一致")
                return
            }
            if await store.registerAccount(nickname: nickname, email: email, password: password, code: code) {
                dismiss()
            }
        case .passwordLogin:
            if await store.loginWithEmail(email: email, password: password) {
                dismiss()
            }
        case .codeLogin:
            if await store.loginWithEmailCode(email: email, code: code) {
                dismiss()
            }
        }
    }
}

struct AuthTextField: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default
    var textContentType: UITextContentType? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.56))
            TextField(placeholder, text: $text)
                .keyboardType(keyboardType)
                .textContentType(textContentType)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.white)
                .tint(Theme.hotPink)
                .padding(.horizontal, 14)
                .frame(height: 52)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.white.opacity(0.10), lineWidth: 1)
                }
        }
    }
}

struct AuthSecureField: View {
    let title: String
    let placeholder: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.56))
            SecureTextField(placeholder: placeholder, text: $text)
                .padding(.horizontal, 14)
                .frame(height: 52)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.white.opacity(0.10), lineWidth: 1)
                }
        }
    }
}

struct SecureTextField: UIViewRepresentable {
    let placeholder: String
    @Binding var text: String

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text)
    }

    func makeUIView(context: Context) -> UITextField {
        let textField = UITextField()
        textField.isSecureTextEntry = true
        textField.borderStyle = .none
        textField.backgroundColor = .clear
        textField.textColor = .white
        textField.tintColor = UIColor(red: 1.0, green: 0.12, blue: 0.27, alpha: 1)
        textField.font = .systemFont(ofSize: 17, weight: .semibold)
        textField.attributedPlaceholder = NSAttributedString(
            string: placeholder,
            attributes: [.foregroundColor: UIColor.white.withAlphaComponent(0.34)]
        )
        textField.autocapitalizationType = .none
        textField.autocorrectionType = .no
        textField.spellCheckingType = .no
        textField.smartDashesType = .no
        textField.smartQuotesType = .no
        textField.smartInsertDeleteType = .no
        textField.textContentType = .oneTimeCode
        textField.passwordRules = nil
        textField.addTarget(context.coordinator, action: #selector(Coordinator.textDidChange(_:)), for: .editingChanged)
        return textField
    }

    func updateUIView(_ uiView: UITextField, context: Context) {
        if uiView.text != text {
            uiView.text = text
        }
    }

    final class Coordinator: NSObject {
        @Binding private var text: String

        init(text: Binding<String>) {
            _text = text
        }

        @objc func textDidChange(_ sender: UITextField) {
            text = sender.text ?? ""
        }
    }
}

struct MarketView: View {
    @EnvironmentObject private var store: MockAppStore

    var posts: [GroupBuyPost] {
        store.sortedFeedPosts(store.activePosts.filter { store.followedUserIDs.contains($0.authorID) })
    }

    var body: some View {
        Group {
            if store.isLoggedIn {
                VStack(spacing: 0) {
                    HStack {
                        Text("关注")
                            .font(.system(size: 28, weight: .black))
                            .foregroundStyle(Theme.text)
                        Spacer()
                        NavigationLink(value: Route.search) {
                            Image(systemName: "magnifyingglass")
                                .font(.system(size: 28, weight: .medium))
                                .foregroundStyle(Theme.text)
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .padding(.bottom, 8)
                    .overlay(alignment: .bottom) {
                        Rectangle().fill(Theme.hairline).frame(height: 0.5)
                    }

                    ScrollView(showsIndicators: false) {
                        FollowingFeedView(posts: posts)
                            .padding(.top, 2)
                    }
                }
                .background(Theme.background.ignoresSafeArea())
            } else {
                GuestAuthView()
            }
        }
        .navigationBarHidden(true)
    }
}

struct SearchView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var query = ""
    @State private var committedQuery = ""
    @State private var selectedTab = "全部"
    @State private var selectedFilter = "综合"
    @State private var isManagingHistory = false

    let tabs = ["全部", "拼谷角色", "团长", "商品"]
    let filters = ["综合", "拼谷有货", "跟团", "最新"]

    var activeQuery: String {
        committedQuery.trimmed
    }

    var typedQuery: String {
        query.trimmed
    }

    var isShowingResults: Bool {
        !activeQuery.isEmpty && activeQuery == typedQuery
    }

    var searchContentKey: String {
        if typedQuery.isEmpty {
            return "initial"
        }
        if isShowingResults {
            return "results-\(activeQuery)"
        }
        return "suggestions-\(typedQuery)"
    }

    var suggestions: [String] {
        let keyword = typedQuery
        guard !keyword.isEmpty else { return [] }
        var pool: [String] = [
            "\(keyword) 拼谷",
            "\(keyword) 跟团",
            "\(keyword) 吧唧",
            "\(keyword) 角色余量",
            "\(keyword) 自印团",
            "Bucky Barnes 拼谷",
            "Steve Rogers 角色位",
            "Tony Stark 余量",
            "Loki 挂件",
            "冬兵生日团",
            "巡演小卡",
            "吧唧拼谷",
            "亚克力立牌",
            "自印团补款"
        ]

        for post in store.activePosts {
            pool.append(post.title)
            pool.append(contentsOf: post.categoryTags)
            pool.append(contentsOf: post.fandomTags)
            pool.append(contentsOf: post.unsoldRoles.map(\.name))
        }
        for user in store.users where user.id != store.currentUserID {
            pool.append(user.nickname)
            pool.append(user.redBookID)
            pool.append(user.region)
        }

        let filtered = pool
            .map { $0.trimmed }
            .filter { !$0.isEmpty }
            .filter { SearchMatcher.matches(query: keyword, candidate: $0) }
            .sorted {
                let lhsScore = SearchMatcher.score(query: keyword, candidate: $0)
                let rhsScore = SearchMatcher.score(query: keyword, candidate: $1)
                if lhsScore != rhsScore { return lhsScore > rhsScore }
                return $0.count < $1.count
            }

        let unique = Array(NSOrderedSet(array: filtered)) as? [String] ?? filtered
        return Array((unique.isEmpty ? pool.filter { SearchMatcher.matches(query: String(keyword.prefix(1)), candidate: $0) } : unique).prefix(9))
    }

    var results: [GroupBuyPost] {
        let keyword = activeQuery
        var result = store.activePosts
        if !keyword.isEmpty {
            let roleMatches = store.splitGoodsPosts(matchingRole: keyword)
            if selectedTab == "拼谷角色" || selectedFilter == "拼谷有货" || !roleMatches.isEmpty {
                result = roleMatches
            } else {
                result = result
                    .filter { post in
                        SearchMatcher.matches(query: keyword, candidate: post.searchableText)
                    }
                    .sorted { lhs, rhs in
                        let lhsScore = SearchMatcher.score(query: keyword, candidate: lhs.searchableText)
                        let rhsScore = SearchMatcher.score(query: keyword, candidate: rhs.searchableText)
                        if lhsScore != rhsScore { return lhsScore > rhsScore }
                        return lhs.createdAt > rhs.createdAt
                    }
            }
        }
        if selectedFilter == "拼谷有货" {
            result = result.filter { $0.groupType == .splitGoods && !$0.unsoldRoles.filter(\.isAvailable).isEmpty }
        }
        if selectedFilter == "跟团" {
            result = result.filter { $0.groupType == .followGroup }
        }
        switch selectedFilter {
        case "最新":
            return store.sortedFeedPosts(result)
        default:
            return result.sorted { lhs, rhs in
                if lhs.isEnded != rhs.isEnded {
                    return !lhs.isEnded
                }
                return lhs.likedCount > rhs.likedCount
            }
        }
    }

    var leaderResults: [User] {
        store.groupLeaderUsers(matching: activeQuery)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .frame(width: 42, height: 50)
                }
                .buttonStyle(.plain)

                HStack(spacing: 10) {
                    TextField("搜索角色名 / 团长名", text: $query)
                        .font(.system(size: 20, weight: .semibold))
                        .submitLabel(.search)
                        .textInputAutocapitalization(.never)
                        .foregroundStyle(Theme.text)
                        .onSubmit {
                            submitSearch()
                        }

                    if !query.trimmed.isEmpty {
                        Button {
                            query = ""
                            committedQuery = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 20, weight: .bold))
                                .foregroundStyle(Theme.muted)
                        }
                        .buttonStyle(.plain)
                    }

                    Rectangle()
                        .fill(Theme.hairline)
                        .frame(width: 1, height: 24)

                    Button(action: submitSearch) {
                        Text("搜索")
                            .font(.system(size: 20, weight: .black))
                            .foregroundStyle(Theme.text)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 18)
                .frame(height: 62)
                .background(Theme.panelRaised, in: Capsule())
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, typedQuery.isEmpty ? 20 : 10)

            Group {
                if typedQuery.isEmpty {
                    SearchInitialContent(history: $store.searchHistory, isManaging: $isManagingHistory) { term in
                        commitSearch(term)
                    }
                    .transition(AppMotion.sideCoverTransition)
                } else if !isShowingResults {
                    SearchSuggestionsContent(query: typedQuery, suggestions: suggestions) { suggestion in
                        commitSearch(suggestion)
                    }
                    .transition(AppMotion.sideCoverTransition)
                } else {
                    SearchResultsContent(
                        query: activeQuery,
                        tabs: tabs,
                        selectedTab: $selectedTab,
                        filters: filters,
                        selectedFilter: $selectedFilter,
                        results: results,
                        users: leaderResults
                    )
                    .transition(AppMotion.sideCoverTransition)
                }
            }
            .id(searchContentKey)
        }
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .background(Theme.background.ignoresSafeArea())
        .toolbar(.hidden, for: .tabBar)
        .contentShape(Rectangle())
        .onTapGesture {
            hideKeyboard()
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 28)
                .onEnded(handleBackSwipe)
        )
    }

    private func submitSearch() {
        commitSearch(query.trimmed.isEmpty ? "Bucky" : query.trimmed)
    }

    private func commitSearch(_ term: String) {
        let trimmed = term.trimmed
        guard !trimmed.isEmpty else { return }
        hideKeyboard()
        withAnimation(AppMotion.page) {
            committedQuery = trimmed
            query = trimmed
            selectedTab = "全部"
            selectedFilter = "综合"
            store.recordSearchHistory(trimmed)
            isManagingHistory = false
        }
    }

    private func handleBackSwipe(_ value: DragGesture.Value) {
        guard value.startLocation.x < 56,
              value.translation.width > 86,
              abs(value.translation.height) < 72 else { return }
        if isShowingResults {
            withAnimation(AppMotion.page) {
                committedQuery = ""
                query = ""
                selectedTab = "全部"
                selectedFilter = "综合"
            }
            return
        }
        dismiss()
    }
}

struct SearchSuggestionsContent: View {
    let query: String
    let suggestions: [String]
    let onSelect: (String) -> Void

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                ForEach(suggestions, id: \.self) { suggestion in
                    Button {
                        onSelect(suggestion)
                    } label: {
                        HStack(spacing: 14) {
                            Image(systemName: "magnifyingglass")
                                .font(.system(size: 22, weight: .medium))
                                .foregroundStyle(Theme.muted)
                                .frame(width: 28)
                            HighlightedSuggestionText(text: suggestion, query: query)
                            Spacer()
                            Image(systemName: "arrow.up.left")
                                .font(.system(size: 22, weight: .medium))
                                .foregroundStyle(Theme.muted)
                        }
                        .padding(.horizontal, 18)
                        .padding(.vertical, 17)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Divider()
                        .overlay(Theme.hairline)
                        .padding(.leading, 60)
                }
            }
            .padding(.top, 16)
        }
        .scrollDismissesKeyboard(.interactively)
    }
}

struct HighlightedSuggestionText: View {
    let text: String
    let query: String

    var body: some View {
        Text(attributedText)
            .font(.system(size: 20, weight: .semibold))
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var attributedText: AttributedString {
        var value = AttributedString(text)
        value.foregroundColor = Theme.text.opacity(0.88)
        let trimmed = query.trimmed
        if !trimmed.isEmpty,
           let range = value.range(of: trimmed, options: [.caseInsensitive, .diacriticInsensitive]) {
            value[range].foregroundColor = Theme.hotPink
        }
        return value
    }
}

struct SearchInitialContent: View {
    @Binding var history: [String]
    @Binding var isManaging: Bool
    let onSelect: (String) -> Void

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 22) {
                HStack {
                    Text("历史记录")
                        .font(.system(size: 24, weight: .black))
                        .foregroundStyle(Theme.text)
                    Spacer()
                    if isManaging {
                        Button {
                            withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                                history.removeAll()
                                isManaging = false
                            }
                        } label: {
                            Text("全部删除")
                                .font(.system(size: 20, weight: .semibold))
                                .foregroundStyle(history.isEmpty ? Theme.muted : Theme.subtext)
                        }
                        .disabled(history.isEmpty)
                        .buttonStyle(.plain)

                        Rectangle()
                            .fill(Theme.hairline)
                            .frame(width: 1, height: 22)
                            .padding(.horizontal, 8)

                        Button {
                            withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                                isManaging = false
                            }
                        } label: {
                            Text("完成")
                                .font(.system(size: 20, weight: .semibold))
                                .foregroundStyle(Theme.subtext)
                        }
                        .buttonStyle(.plain)
                    } else {
                        Button {
                            withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                                isManaging = true
                            }
                        } label: {
                            Image(systemName: "trash")
                                .font(.system(size: 22, weight: .semibold))
                                .foregroundStyle(Theme.muted)
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)

                if history.isEmpty {
                    Text("暂无搜索历史")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                        .padding(.horizontal, 16)
                        .padding(.top, 10)
                } else {
                    SearchHistoryWrap(items: history) { item in
                        SearchHistoryChip(title: item, isManaging: isManaging) {
                            onSelect(item)
                        } deleteAction: {
                            withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                                history.removeAll { $0 == item }
                                if history.isEmpty {
                                    isManaging = false
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                }
            }
            .padding(.bottom, 36)
        }
        .scrollDismissesKeyboard(.interactively)
    }
}

struct SearchHistoryChip: View {
    let title: String
    let isManaging: Bool
    let selectAction: () -> Void
    let deleteAction: () -> Void

    private var displayTitle: String {
        title.count > 10 ? "\(title.prefix(10))..." : title
    }

    var body: some View {
        Button {
            if isManaging {
                deleteAction()
            } else {
                selectAction()
            }
        } label: {
            HStack(spacing: 8) {
                Text(displayTitle)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Theme.text.opacity(0.86))
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                if isManaging {
                    Image(systemName: "xmark")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(Theme.panel, in: Capsule())
            .overlay {
                Capsule().stroke(Theme.hairline, lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
    }
}

struct SearchHistoryWrap<Content: View>: View {
    let items: [String]
    let content: (String) -> Content

    var body: some View {
        SearchWrappingLayout(horizontalSpacing: 10, verticalSpacing: 12) {
            ForEach(items, id: \.self) { item in
                content(item)
            }
        }
    }
}

private struct SearchWrappingLayout: Layout {
    let horizontalSpacing: CGFloat
    let verticalSpacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let availableWidth = proposal.width ?? .infinity
        let result = arrangedSubviews(subviews, availableWidth: availableWidth)
        return CGSize(width: proposal.width ?? result.size.width, height: result.size.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrangedSubviews(subviews, availableWidth: bounds.width)
        for index in subviews.indices {
            subviews[index].place(
                at: CGPoint(
                    x: bounds.minX + result.positions[index].x,
                    y: bounds.minY + result.positions[index].y
                ),
                proposal: .unspecified
            )
        }
    }

    private func arrangedSubviews(_ subviews: Subviews, availableWidth: CGFloat) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = availableWidth.isFinite ? availableWidth : .greatestFiniteMagnitude
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var usedWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                y += rowHeight + verticalSpacing
                x = 0
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            x += size.width + horizontalSpacing
            rowHeight = max(rowHeight, size.height)
            usedWidth = max(usedWidth, x - horizontalSpacing)
        }

        return (CGSize(width: usedWidth, height: y + rowHeight), positions)
    }
}

struct SearchResultsContent: View {
    @Namespace private var tabIndicator
    let query: String
    let tabs: [String]
    @Binding var selectedTab: String
    let filters: [String]
    @Binding var selectedFilter: String
    let results: [GroupBuyPost]
    let users: [User]

    private var resultContentID: String {
        "\(query)-\(selectedTab)-\(selectedFilter)-\(results.map(\.id).joined(separator: ","))-\(users.map(\.id).joined(separator: ","))"
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 30) {
                    ForEach(tabs, id: \.self) { tab in
                        Button {
                            withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                                selectedTab = tab
                            }
                        } label: {
                            VStack(spacing: 8) {
                                HStack(spacing: 6) {
                                    if tab == "问一问" {
                                        Image(systemName: "sparkle")
                                            .font(.system(size: 22, weight: .bold))
                                            .foregroundStyle(Color(red: 0.38, green: 0.62, blue: 1))
                                    }
                                    Text(tab)
                                        .font(.system(size: 22, weight: selectedTab == tab ? .black : .semibold))
                                        .foregroundStyle(selectedTab == tab ? Theme.text : Theme.subtext)
                                }
                                ZStack {
                                    if selectedTab == tab {
                                        Capsule()
                                            .fill(Theme.hotPink)
                                            .matchedGeometryEffect(id: "search-tab-indicator", in: tabIndicator)
                                            .frame(width: 52, height: 4)
                                    } else {
                                        Color.clear.frame(width: 52, height: 4)
                                    }
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 10)
            }

            Rectangle().fill(Theme.hairline).frame(height: 0.5)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 14) {
                    if selectedTab != "团长" {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                ForEach(filters, id: \.self) { filter in
                                    Button {
                                        withAnimation(.spring(response: 0.26, dampingFraction: 0.86)) {
                                            selectedFilter = filter
                                        }
                                    } label: {
                                        HStack(spacing: 6) {
                                            if filter == "拼谷有货" {
                                                Image(systemName: "bag")
                                                    .font(.system(size: 16, weight: .bold))
                                            }
                                            Text(filter)
                                                .font(.system(size: 18, weight: .bold))
                                        }
                                        .foregroundStyle(selectedFilter == filter ? Theme.text : Theme.subtext)
                                        .padding(.horizontal, 16)
                                        .padding(.vertical, 12)
                                        .background(selectedFilter == filter ? Theme.panelRaised : Theme.panel, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal, 16)
                            .padding(.top, 14)
                        }
                    }

                    Group {
                        if selectedTab == "团长" {
                            if users.isEmpty {
                                SearchEmptyState(icon: "person.crop.circle", text: "没有找到和“\(query)”相关的团长")
                            } else {
                                VStack(spacing: 0) {
                                    ForEach(users) { user in
                                        SearchLeaderRow(userID: user.id)
                                        Divider()
                                            .overlay(Theme.hairline)
                                            .padding(.leading, 96)
                                    }
                                }
                                .padding(.horizontal, 16)
                                .padding(.top, 8)
                            }
                        } else if results.isEmpty {
                            SearchEmptyState(icon: "magnifyingglass", text: "没有找到和“\(query)”相关的内容")
                        } else {
                            WaterfallGrid(posts: results)
                                .padding(.horizontal, 12)
                                .padding(.bottom, 28)
                        }
                    }
                    .id(resultContentID)
                    .transition(AppMotion.sideCoverTransition)
                    .animation(AppMotion.quick, value: resultContentID)
                }
            }
        }
    }
}

struct SearchEmptyState: View {
    let icon: String
    let text: String

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 42, weight: .light))
            Text(text)
                .font(.system(size: 17, weight: .bold))
                .multilineTextAlignment(.center)
        }
        .foregroundStyle(Theme.muted)
        .frame(maxWidth: .infinity)
        .padding(.top, 80)
    }
}

struct SearchLeaderRow: View {
    @EnvironmentObject private var store: MockAppStore
    let userID: String

    private var user: User {
        store.user(id: userID)
    }

    private var isFollowing: Bool {
        store.followedUserIDs.contains(userID)
    }

    private var isMutual: Bool {
        isFollowing && store.followerUsers(for: userID).contains { $0.id == store.currentUserID }
    }

    private var followTitle: String {
        if isMutual { return "互相关注" }
        return isFollowing ? "已关注" : "关注"
    }

    var body: some View {
        HStack(spacing: 14) {
            NavigationLink(value: Route.userProfile(userID)) {
                HStack(spacing: 14) {
                    AvatarView(user: user, size: 58)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(user.nickname)
                            .font(.system(size: 21, weight: .bold))
                            .foregroundStyle(Theme.text)
                            .lineLimit(1)
                        Text("粉丝 \(user.followersCount.formattedCount)")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.subtext)
                        Text("小红书号：\(user.redBookID.isEmpty ? store.registrationID(for: user.id) : user.redBookID)")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Theme.subtext)
                            .lineLimit(1)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Spacer(minLength: 10)

            Button {
                withAnimation(.spring(response: 0.24, dampingFraction: 0.84)) {
                    store.toggleFollow(userID: userID)
                }
            } label: {
                Text(followTitle)
                    .font(.system(size: 16, weight: .black))
                    .foregroundStyle(isFollowing ? Theme.text : Theme.hotPink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
                    .frame(minWidth: 78)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .overlay {
                        Capsule()
                            .stroke(isFollowing ? Theme.hairline : Theme.hotPink, lineWidth: 1.5)
                    }
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 16)
    }
}

struct PostDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var commentDraft = ""
    @State private var replyTargetCommentID: String?
    @State private var actionCommentID: String?
    @State private var isShareSheetPresented = false
    @State private var isAuthorProfilePresented = false
    @State private var selectedImageIndex = 0
    let postID: String

    var body: some View {
        if let post = store.post(id: postID) {
            let author = store.user(id: post.authorID)
            let imageCount = max(1, max(post.remoteImageURLs.count, post.uploadedImageData.isEmpty ? post.imageNames.count : post.uploadedImageData.count))
            let detailImageHeight = imageHeight(for: post, index: 0)
            VStack(spacing: 0) {
                DetailTopBar(post: post, author: author, isShareSheetPresented: $isShareSheetPresented)
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        TabView(selection: $selectedImageIndex) {
                            ForEach(0..<imageCount, id: \.self) { index in
                                PostDetailImagePage(
                                    post: post,
                                    index: index,
                                    canvasWidth: UIScreen.main.bounds.width,
                                    canvasHeight: detailImageHeight
                                )
                                .tag(index)
                            }
                        }
                        .frame(height: detailImageHeight)
                        .tabViewStyle(.page(indexDisplayMode: .automatic))

                        VStack(alignment: .leading, spacing: 18) {
                            VStack(alignment: .leading, spacing: 10) {
                                Text(post.title)
                                    .font(.system(size: 28, weight: .bold))
                                    .foregroundStyle(Theme.text)
                                    .fixedSize(horizontal: false, vertical: true)
                                Text(post.description)
                                    .font(.system(size: 17, weight: .regular))
                                    .lineSpacing(6)
                                    .foregroundStyle(Theme.text.opacity(0.82))
                            }

                            TagCloud(tags: post.categoryTags + post.fandomTags)

                            GroupBuyInfoCard(post: post)
                            if post.groupType == .splitGoods {
                                PingguRoleAvailabilityCard(postID: post.id)
                            }
                            ContactCard(post: post)
                            CommentSection(postID: post.id, commentDraft: $commentDraft, replyTargetCommentID: $replyTargetCommentID, actionCommentID: $actionCommentID)
                        }
                        .padding(18)
                    }
                    .padding(.bottom, 20)
                }
                .scrollDismissesKeyboard(.interactively)
                .onTapGesture {
                    hideKeyboard()
                }
            }
            .background(Theme.background.ignoresSafeArea())
            .safeAreaInset(edge: .bottom) {
                DetailActionBar(post: post, commentDraft: $commentDraft, replyTargetCommentID: $replyTargetCommentID)
            }
            .overlay {
                if let actionComment = actionCommentID.flatMap(store.comment(id:)) {
                    CommentActionOverlay(
                        comment: actionComment,
                        onDismiss: {
                            withAnimation(.easeInOut(duration: 0.18)) {
                                actionCommentID = nil
                            }
                        },
                        onReply: {
                            replyTargetCommentID = actionComment.id
                            commentDraft = ""
                            withAnimation(.easeInOut(duration: 0.18)) {
                                actionCommentID = nil
                            }
                            store.showToast("正在回复 \(store.user(id: actionComment.authorID).nickname)")
                        },
                        onCopy: {
                            store.copyComment(actionComment)
                            withAnimation(.easeInOut(duration: 0.18)) {
                                actionCommentID = nil
                            }
                        },
                        onDelete: {
                            if replyTargetCommentID == actionComment.id {
                                replyTargetCommentID = nil
                            }
                            store.deleteComment(commentID: actionComment.id)
                            withAnimation(.easeInOut(duration: 0.18)) {
                                actionCommentID = nil
                            }
                        }
                    )
                    .transition(.opacity)
                }
            }
            .sheet(isPresented: $isShareSheetPresented) {
                ShareSheetView(post: post)
                    .presentationDetents([.height(440), .large])
                    .presentationDragIndicator(.hidden)
            }
            .onAppear {
                store.recordBrowse(postID: post.id)
            }
            .navigationBarBackButtonHidden(true)
            .navigationBarHidden(true)
            .toolbar(.hidden, for: .tabBar)
            .onChange(of: imageCount) {
                selectedImageIndex = min(selectedImageIndex, max(0, imageCount - 1))
            }
            .navigationDestination(isPresented: $isAuthorProfilePresented) {
                UserProfileView(userID: author.id)
            }
            .simultaneousGesture(
                DragGesture(minimumDistance: 30)
                    .onEnded { value in
                        handleDetailSwipe(value, authorID: author.id)
                    }
            )
        } else {
            ContentUnavailableView("内容不存在", systemImage: "exclamationmark.triangle", description: Text("这条团购可能已下架或被隐藏。"))
                .background(Theme.background)
        }
    }

    private func imageHeight(for post: GroupBuyPost, index: Int) -> CGFloat {
        let screenWidth = UIScreen.main.bounds.width
        let aspect = imageAspect(for: post, index: index)
        return screenWidth / max(0.28, aspect)
    }

    private func imageAspect(for post: GroupBuyPost, index: Int) -> CGFloat {
        if post.remoteImageURLs.indices.contains(index) {
            return CGFloat(max(0.28, post.imageAspect))
        }
        if post.uploadedImageData.indices.contains(index),
           let image = UIImage(data: post.uploadedImageData[index]),
           image.size.width > 0,
           image.size.height > 0 {
            return image.size.width / image.size.height
        }
        return CGFloat(max(0.28, post.imageAspect))
    }

    private func handleDetailSwipe(_ value: DragGesture.Value, authorID: String) {
        guard abs(value.translation.height) < 72 else { return }
        if value.translation.width > 92 {
            dismiss()
        } else if value.translation.width < -92 {
            hideKeyboard()
            withAnimation(AppMotion.page) {
                isAuthorProfilePresented = true
            }
        }
    }
}

struct PostDetailImagePage: View {
    let post: GroupBuyPost
    let index: Int
    let canvasWidth: CGFloat
    let canvasHeight: CGFloat

    var body: some View {
        ZStack {
            Theme.background
            PostImageView(post: post, index: index)
                .scaledToFit()
                .frame(width: canvasWidth, height: canvasHeight)
        }
        .frame(width: canvasWidth, height: canvasHeight)
        .clipped()
        .background(Theme.background)
    }
}

struct DetailTopBar: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    let post: GroupBuyPost
    let author: User
    @Binding var isShareSheetPresented: Bool

    var body: some View {
        HStack(spacing: 12) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 24, weight: .semibold))
                    .frame(width: 42, height: 42)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.text)

            NavigationLink(value: Route.userProfile(author.id)) {
                HStack(spacing: 10) {
                    AvatarView(user: author, size: 48)
                    Text(author.nickname)
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(Theme.text)
                }
            }
            .buttonStyle(.plain)

            Spacer()
            Button {
                store.toggleFollow(userID: author.id)
            } label: {
                Text(store.followedUserIDs.contains(author.id) ? "已关注" : "关注")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(store.followedUserIDs.contains(author.id) ? Theme.subtext : Theme.hotPink)
                    .padding(.horizontal, 22)
                    .padding(.vertical, 10)
                    .overlay {
                        Capsule().stroke(store.followedUserIDs.contains(author.id) ? Theme.hairline : Theme.hotPink, lineWidth: 1)
                    }
            }
            .buttonStyle(.plain)

            Button {
                if store.requireLogin(prompt: "登录后才能分享") {
                    isShareSheetPresented = true
                }
            } label: {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 24, weight: .semibold))
                    .frame(width: 42, height: 42)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.text)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Theme.background)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
        }
    }
}

struct ShareSheetView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var isRecipientPickerPresented = false
    let post: GroupBuyPost

    var stationThreads: [MessageThread] {
        Array(store.messageThreads.prefix(3))
    }

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Theme.hairline)
                .frame(width: 44, height: 5)
                .padding(.top, 10)

            HStack {
                Spacer()
                Text("分享至")
                    .font(.system(size: 24, weight: .black))
                    .foregroundStyle(Theme.text)
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(Theme.text)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 18)
            .padding(.top, 12)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 22) {
                    ForEach(stationThreads) { thread in
                        let friend = store.user(id: store.peerUserID(for: thread))
                        Button {
                            store.sharePostToThread(postID: post.id, threadID: thread.id)
                            dismiss()
                        } label: {
                            VStack(spacing: 8) {
                                AvatarView(user: friend, size: 66)
                                Text(friend.nickname)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Theme.subtext)
                                    .lineLimit(1)
                                    .frame(width: 82)
                                Text("20分钟内在线")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(Theme.muted)
                                    .lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                    }

                    Button {
                        store.showToast("已打开邀请好友占位")
                    } label: {
                        VStack(spacing: 8) {
                            Image(systemName: "person.crop.circle.badge.plus")
                                .font(.system(size: 32, weight: .semibold))
                                .foregroundStyle(Theme.text)
                                .frame(width: 66, height: 66)
                                .background(Theme.panelRaised, in: Circle())
                            Text("邀请好友")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Theme.subtext)
                                .frame(width: 82)
                            Text(" ")
                                .font(.system(size: 12))
                        }
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 24)
                .padding(.top, 10)
                .padding(.bottom, 18)
            }

            Divider().overlay(Theme.hairline)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 26) {
                    ShareOptionButton(title: "私信好友", icon: "paperplane.fill", color: Theme.hotPink) {
                        isRecipientPickerPresented = true
                    }
                    ShareOptionButton(title: "微信好友", icon: "bubble.left.and.bubble.right.fill", color: Color(red: 0.05, green: 0.76, blue: 0.32)) {
                        store.showToast("已唤起微信分享占位")
                    }
                    ShareOptionButton(title: "朋友圈", icon: "camera.aperture", color: Color(red: 0.35, green: 0.84, blue: 0.05)) {
                        store.showToast("已唤起朋友圈分享占位")
                    }
                    ShareOptionButton(title: "QQ 好友", icon: "person.crop.circle.fill", color: Color(red: 0.09, green: 0.68, blue: 0.9)) {
                        store.showToast("已唤起 QQ 分享占位")
                    }
                    ShareOptionButton(title: "QQ 空间", icon: "star.fill", color: Color(red: 1, green: 0.79, blue: 0.03)) {
                        store.showToast("已唤起 QQ 空间占位")
                    }
                    ShareOptionButton(title: "微博", icon: "eye.fill", color: Color(red: 0.93, green: 0.06, blue: 0.04)) {
                        store.showToast("已唤起微博分享占位")
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
            }

            Divider().overlay(Theme.hairline)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 26) {
                    ShareUtilityButton(title: "问点点", icon: "bubble.left") {
                        store.showToast("已打开问答占位")
                    }
                    ShareUtilityButton(title: "复制链接", icon: "link") {
                        store.copyToPasteboard("zhoubiantuan://post/\(post.id)", label: "站内链接")
                    }
                    ShareUtilityButton(title: "生成分享图", icon: "photo") {
                        store.showToast("已生成分享图占位")
                    }
                    ShareUtilityButton(title: "引用发制品", icon: "quote.bubble") {
                        store.showToast("已带引用进入发布占位")
                    }
                    ShareUtilityButton(title: "建群分享", icon: "person.2") {
                        store.showToast("已打开建群分享占位")
                    }
                    ShareUtilityButton(title: "保存图片", icon: "square.and.arrow.down") {
                        store.showToast("已保存分享图占位")
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .fullScreenCover(isPresented: $isRecipientPickerPresented) {
            ShareRecipientPickerView(primaryUserID: post.authorID) { user in
                store.sharePostToUser(postID: post.id, userID: user.id)
                dismiss()
            }
        }
    }
}

struct ShareRecipientSection: Identifiable {
    let title: String
    let users: [User]

    var id: String { title }
}

struct ShareRecipientPickerView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var query = ""
    let primaryUserID: String?
    let onSelect: (User) -> Void

    var sections: [ShareRecipientSection] {
        let following = store.followingUsers(for: store.currentUserID)
        let mutual = following.filter { user in
            store.followingUsers(for: user.id).contains { $0.id == store.currentUserID }
        }
        let recent = uniqueUsers(
            store.messageThreads
                .map { store.user(id: store.peerUserID(for: $0)) }
        )
        let allFollowed = uniqueUsers(following)
        var groups: [ShareRecipientSection] = []

        if let primaryUserID {
            let primary = uniqueUsers([store.user(id: primaryUserID)])
            groups.append(ShareRecipientSection(title: "作者", users: primary))
        }
        groups.append(ShareRecipientSection(title: "最近聊天", users: recent))
        groups.append(ShareRecipientSection(title: "互相关注", users: uniqueUsers(mutual)))
        groups.append(ShareRecipientSection(title: "全部关注", users: allFollowed))

        return groups
            .map { ShareRecipientSection(title: $0.title, users: filtered($0.users)) }
            .filter { !$0.users.isEmpty }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button {
                    dismiss()
                } label: {
                    Text("取消")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(Theme.text)
                        .frame(width: 72, alignment: .leading)
                }
                .buttonStyle(.plain)

                Spacer()
                Text("分享至")
                    .font(.system(size: 22, weight: .black))
                    .foregroundStyle(Theme.text)
                Spacer()
                Color.clear.frame(width: 72, height: 1)
            }
            .padding(.horizontal, 18)
            .padding(.top, 20)
            .padding(.bottom, 18)

            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 22, weight: .medium))
                    .foregroundStyle(Theme.muted)
                TextField("搜索", text: $query)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Theme.text)
                    .textInputAutocapitalization(.never)
            }
            .padding(.horizontal, 16)
            .frame(height: 52)
            .background(Theme.panel, in: Capsule())
            .padding(.horizontal, 18)
            .padding(.bottom, 22)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(sections) { section in
                        Text(section.title)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(Theme.muted)
                            .padding(.horizontal, 18)
                            .padding(.top, 18)
                            .padding(.bottom, 10)
                        ForEach(section.users) { user in
                            Button {
                                onSelect(user)
                                dismiss()
                            } label: {
                                ShareRecipientRow(user: user)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.bottom, 40)
            }
        }
        .background(Theme.background.ignoresSafeArea())
    }

    private func filtered(_ users: [User]) -> [User] {
        let trimmedQuery = query.trimmed
        guard !trimmedQuery.isEmpty else { return users }
        return users.filter {
            $0.nickname.localizedCaseInsensitiveContains(trimmedQuery) ||
            store.registrationID(for: $0.id).contains(trimmedQuery)
        }
    }

    private func uniqueUsers(_ users: [User]) -> [User] {
        var seen = Set<String>()
        return users.filter { user in
            guard user.id != store.currentUserID else { return false }
            return seen.insert(user.id).inserted
        }
    }
}

struct ShareRecipientRow: View {
    let user: User

    var body: some View {
        HStack(spacing: 16) {
            Circle()
                .stroke(Theme.subtext.opacity(0.5), lineWidth: 2)
                .frame(width: 32, height: 32)
            AvatarView(user: user, size: 58)
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(user.nickname)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text("20 分钟内在线")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Theme.hairline)
                .frame(height: 0.5)
                .padding(.leading, 126)
        }
    }
}

struct ProfileShareSheetView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var isRecipientPickerPresented = false
    let user: User

    var stationThreads: [MessageThread] {
        Array(store.messageThreads.prefix(3))
    }

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Theme.hairline)
                .frame(width: 44, height: 5)
                .padding(.top, 10)

            HStack {
                Spacer()
                Text("分享至")
                    .font(.system(size: 24, weight: .black))
                    .foregroundStyle(Theme.text)
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(Theme.text)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 18)
            .padding(.top, 12)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 22) {
                    ForEach(stationThreads) { thread in
                        let friend = store.user(id: store.peerUserID(for: thread))
                        Button {
                            store.shareProfileToThread(userID: user.id, threadID: thread.id)
                            dismiss()
                        } label: {
                            VStack(spacing: 8) {
                                AvatarView(user: friend, size: 66)
                                Text(friend.nickname)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Theme.subtext)
                                    .lineLimit(1)
                                    .frame(width: 82)
                                Text("20分钟内在线")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(Theme.muted)
                                    .lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                    }

                    Button {
                        store.showToast("已打开邀请好友占位")
                    } label: {
                        VStack(spacing: 8) {
                            Image(systemName: "person.crop.circle.badge.plus")
                                .font(.system(size: 32, weight: .semibold))
                                .foregroundStyle(Theme.text)
                                .frame(width: 66, height: 66)
                                .background(Theme.panelRaised, in: Circle())
                            Text("邀请好友")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(Theme.subtext)
                                .frame(width: 82)
                            Text(" ")
                                .font(.system(size: 12))
                        }
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 24)
                .padding(.top, 10)
                .padding(.bottom, 18)
            }

            Divider().overlay(Theme.hairline)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 26) {
                    ShareOptionButton(title: "私信好友", icon: "paperplane.fill", color: Theme.hotPink) {
                        isRecipientPickerPresented = true
                    }
                    ShareOptionButton(title: "微信好友", icon: "bubble.left.and.bubble.right.fill", color: Color(red: 0.05, green: 0.76, blue: 0.32)) {
                        store.showToast("已唤起微信分享占位")
                    }
                    ShareOptionButton(title: "朋友圈", icon: "camera.aperture", color: Color(red: 0.35, green: 0.84, blue: 0.05)) {
                        store.showToast("已唤起朋友圈分享占位")
                    }
                    ShareOptionButton(title: "QQ 好友", icon: "person.crop.circle.fill", color: Color(red: 0.09, green: 0.68, blue: 0.9)) {
                        store.showToast("已唤起 QQ 分享占位")
                    }
                    ShareOptionButton(title: "QQ 空间", icon: "star.fill", color: Color(red: 1, green: 0.79, blue: 0.03)) {
                        store.showToast("已唤起 QQ 空间占位")
                    }
                    ShareOptionButton(title: "微博", icon: "eye.fill", color: Color(red: 0.93, green: 0.06, blue: 0.04)) {
                        store.showToast("已唤起微博分享占位")
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
            }

            Divider().overlay(Theme.hairline)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 26) {
                    ShareUtilityButton(title: "复制链接", icon: "link") {
                        store.copyToPasteboard("zhoubiantuan://profile/\(user.id)", label: "主页链接")
                    }
                    ShareUtilityButton(title: "生成分享图", icon: "photo") {
                        store.showToast("已生成主页分享图占位")
                    }
                    ShareUtilityButton(title: "保存图片", icon: "square.and.arrow.down") {
                        store.showToast("已保存主页分享图占位")
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .fullScreenCover(isPresented: $isRecipientPickerPresented) {
            ShareRecipientPickerView(primaryUserID: user.id) { recipient in
                store.shareProfileToUser(profileUserID: user.id, recipientUserID: recipient.id)
                dismiss()
            }
        }
    }
}

struct ShareOptionButton: View {
    let title: String
    let icon: String
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 74, height: 74)
                    .background(color, in: Circle())
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.subtext)
                    .frame(width: 86)
                    .lineLimit(1)
            }
        }
        .buttonStyle(.plain)
    }
}

struct ShareUtilityButton: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 27, weight: .semibold))
                    .foregroundStyle(Theme.text)
                    .frame(width: 74, height: 74)
                    .background(Theme.panelRaised, in: Circle())
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.subtext)
                    .frame(width: 88)
                    .lineLimit(1)
            }
        }
        .buttonStyle(.plain)
    }
}

struct GroupBuyInfoCard: View {
    @EnvironmentObject private var store: MockAppStore
    let post: GroupBuyPost

    var body: some View {
        let collection = store.collection(id: post.collectionID)
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("团购信息", systemImage: "bag.badge.plus")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Theme.text)
                Spacer()
                Text(post.groupType.rawValue)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(post.groupType.accent)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(post.groupType.accent.opacity(0.12), in: Capsule())
            }
            if let collection {
                InfoRow(title: "拼团合集", value: collection.name)
                InfoRow(title: "合集说明", value: collection.defaultNote)
            }
            InfoRow(title: "成团状态", value: post.isFormed ? "已成团" : "待成团")
            InfoRow(title: "商品价格", value: post.price)
            InfoRow(title: "定金比例", value: post.deposit)
            InfoRow(title: "截团时间", value: (collection?.deadline ?? post.deadline).fullDisplay)
            InfoRow(title: "成团条件", value: post.condition)
            InfoRow(title: "外部表单", value: post.externalLink.isEmpty ? "无，联系团长登记" : post.externalLink)
        }
        .padding(16)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8).stroke(Theme.hairline, lineWidth: 0.5)
        }
    }
}

struct PingguRoleAvailabilityCard: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var isEditing = false
    @State private var newRoleName = ""
    @State private var newRoleQuantity = "1"
    @State private var newRolePriceAdjustment = ""
    let postID: String

    var body: some View {
        if let post = store.post(id: postID) {
            let isOwner = post.authorID == store.currentUserID
            let roles = isEditing ? post.unsoldRoles : store.availableRoles(for: postID)
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Label("未被购买角色", systemImage: "person.crop.rectangle.stack.fill")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(Theme.text)
                    Spacer()
                    if isOwner {
                        Button {
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.86)) {
                                isEditing.toggle()
                            }
                        } label: {
                            Text(isEditing ? "完成" : "编辑")
                                .font(.system(size: 14, weight: .black))
                                .foregroundStyle(post.groupType.accent)
                        }
                        .buttonStyle(.plain)
                    }
                }

                if !post.pingguAveragePrice.isEmpty || !post.pingguNote.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        if !post.pingguAveragePrice.isEmpty {
                            Text(post.pingguAveragePrice)
                                .font(.system(size: 17, weight: .black))
                                .foregroundStyle(post.groupType.accent)
                        }
                        if !post.pingguNote.isEmpty {
                            Text(post.pingguNote)
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.subtext)
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(post.groupType.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }

                if roles.isEmpty {
                    Text(isEditing ? "还没有录入角色，添加后会出现在拼谷搜索里。" : "当前没有可购买角色。")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 8)
                } else {
                    VStack(spacing: 8) {
                        ForEach(roles) { role in
                            if isEditing {
                                EditableRoleRow(postID: postID, role: role)
                            } else {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(role.name)
                                            .font(.system(size: 16, weight: .bold))
                                            .foregroundStyle(Theme.text)
                                        if role.priceAdjustment != 0 {
                                            Text("角色调价 \(role.priceAdjustmentText)")
                                                .font(.system(size: 12, weight: .black))
                                                .foregroundStyle(post.groupType.accent)
                                        }
                                    }
                                    Spacer()
                                    Text("(\(role.quantity))")
                                        .font(.system(size: 16, weight: .black))
                                        .foregroundStyle(post.groupType.accent)
                                }
                                .padding(12)
                                .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            }
                        }
                    }
                }

                if isOwner && isEditing {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("添加角色")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Theme.subtext)
                        HStack(spacing: 8) {
                            TextField("角色名", text: $newRoleName)
                                .foregroundStyle(Theme.text)
                                .padding(12)
                                .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8))
                            TextField("数量", text: $newRoleQuantity)
                                .keyboardType(.numberPad)
                                .foregroundStyle(Theme.text)
                                .frame(width: 66)
                                .padding(12)
                                .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8))
                            TextField("调价", text: $newRolePriceAdjustment)
                                .keyboardType(.numbersAndPunctuation)
                                .foregroundStyle(Theme.text)
                                .frame(width: 76)
                                .padding(12)
                                .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8))
                            Button {
                                store.addUnsoldRole(postID: postID, name: newRoleName, quantity: Int(newRoleQuantity) ?? 1, priceAdjustment: parsePriceAdjustment(newRolePriceAdjustment))
                                newRoleName = ""
                                newRoleQuantity = "1"
                                newRolePriceAdjustment = ""
                            } label: {
                                Image(systemName: "plus")
                                    .font(.system(size: 17, weight: .black))
                                    .foregroundStyle(.white)
                                    .frame(width: 44, height: 44)
                                    .background(post.groupType.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.top, 4)
                }

                if !isOwner {
                    Text("只有团长可维护角色余量。")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                }
            }
            .padding(16)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8).stroke(post.groupType.accent.opacity(0.28), lineWidth: 1)
            }
        }
    }
}

struct EditableRoleRow: View {
    @EnvironmentObject private var store: MockAppStore
    let postID: String
    let role: UnsoldRole

    var nameBinding: Binding<String> {
        Binding(
            get: { store.post(id: postID)?.unsoldRoles.first(where: { $0.id == role.id })?.name ?? role.name },
            set: { newValue in
                let quantity = store.post(id: postID)?.unsoldRoles.first(where: { $0.id == role.id })?.quantity ?? role.quantity
                let adjustment = store.post(id: postID)?.unsoldRoles.first(where: { $0.id == role.id })?.priceAdjustment ?? role.priceAdjustment
                store.updateUnsoldRole(postID: postID, roleID: role.id, name: newValue, quantity: quantity, priceAdjustment: adjustment)
            }
        )
    }

    var quantityBinding: Binding<Int> {
        Binding(
            get: { store.post(id: postID)?.unsoldRoles.first(where: { $0.id == role.id })?.quantity ?? role.quantity },
            set: { newValue in
                let name = store.post(id: postID)?.unsoldRoles.first(where: { $0.id == role.id })?.name ?? role.name
                let adjustment = store.post(id: postID)?.unsoldRoles.first(where: { $0.id == role.id })?.priceAdjustment ?? role.priceAdjustment
                store.updateUnsoldRole(postID: postID, roleID: role.id, name: name, quantity: newValue, priceAdjustment: adjustment)
            }
        )
    }

    var adjustmentBinding: Binding<String> {
        Binding(
            get: {
                let adjustment = store.post(id: postID)?.unsoldRoles.first(where: { $0.id == role.id })?.priceAdjustment ?? role.priceAdjustment
                return formatPlainAmount(adjustment)
            },
            set: { newValue in
                let current = store.post(id: postID)?.unsoldRoles.first(where: { $0.id == role.id }) ?? role
                store.updateUnsoldRole(
                    postID: postID,
                    roleID: role.id,
                    name: current.name,
                    quantity: current.quantity,
                    priceAdjustment: parsePriceAdjustment(newValue)
                )
            }
        )
    }

    var body: some View {
        HStack(spacing: 10) {
            TextField("角色名", text: nameBinding)
                .foregroundStyle(Theme.text)
                .padding(11)
                .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8))
            Stepper(value: quantityBinding, in: 0...99) {
                Text("\(quantityBinding.wrappedValue)")
                    .font(.system(size: 16, weight: .black))
                    .foregroundStyle(quantityBinding.wrappedValue > 0 ? Color(red: 0.25, green: 0.78, blue: 0.72) : Theme.muted)
            }
            .labelsHidden()
            .frame(width: 100)
            TextField("调价", text: adjustmentBinding)
                .keyboardType(.numbersAndPunctuation)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.text)
                .frame(width: 72)
                .padding(11)
                .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8))
            Button {
                store.removeUnsoldRole(postID: postID, roleID: role.id)
            } label: {
                Image(systemName: "trash")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Theme.hotPink)
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
        }
    }
}

struct ContactCard: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var chatThreadID: String?
    let post: GroupBuyPost

    var body: some View {
        let collection = store.collection(id: post.collectionID)
        let wechat = collection?.contactWechat ?? post.wechat
        let qq = collection?.contactQQ ?? post.qq
        let groupInfo = collection?.groupInfo ?? post.groupInfo
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("联系团长", systemImage: "person.crop.circle.badge.questionmark")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Theme.text)
                Spacer()
                Text(collection == nil ? "外部交易" : "合集共享")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.hotPink)
            }
            Text("站内仅展示信息和咨询入口，不承接支付、订单、退款、物流或售后。正式交易请在微信、QQ、群聊等外部平台完成。")
                .font(.system(size: 13))
                .lineSpacing(3)
                .foregroundStyle(Theme.subtext)

            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    ContactButton(title: "复制微信", icon: "doc.on.doc.fill") {
                        store.copyToPasteboard(wechat, label: "微信")
                    }
                    ContactButton(title: "复制 QQ", icon: "number") {
                        store.copyToPasteboard(qq, label: "QQ")
                    }
                }
                HStack(spacing: 10) {
                    ContactButton(title: "加入群聊", icon: "person.3.fill") {
                        store.copyToPasteboard(groupInfo, label: "群聊信息")
                    }
                    ContactButton(title: "私信咨询", icon: "bubble.left.and.text.bubble.right.fill") {
                        chatThreadID = store.consultationThreadID(for: post.id)
                    }
                }
            }
        }
        .padding(16)
        .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .background {
            NavigationLink(
                destination: Group {
                    if let chatThreadID {
                        ChatView(threadID: chatThreadID)
                    }
                },
                isActive: Binding(
                    get: { chatThreadID != nil },
                    set: { isActive in
                        if !isActive {
                            chatThreadID = nil
                        }
                    }
                )
            ) {
                EmptyView()
            }
            .hidden()
        }
    }
}

struct CommentSection: View {
    @EnvironmentObject private var store: MockAppStore
    let postID: String
    @Binding var commentDraft: String
    @Binding var replyTargetCommentID: String?
    @Binding var actionCommentID: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("评论区")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Theme.text)
                Spacer()
                Text("不能作为正式交易场所")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.muted)
            }
            let comments = store.comments(for: postID)
            if comments.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "bubble.left")
                        .font(.system(size: 32))
                    Text("抢首评")
                        .font(.system(size: 17, weight: .bold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 36)
                .foregroundStyle(Theme.muted)
            } else {
                ForEach(comments) { comment in
                    CommentRow(comment: comment) {
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        withAnimation(.spring(response: 0.24, dampingFraction: 0.84)) {
                            actionCommentID = comment.id
                        }
                    }
                }
            }
        }
        .padding(.bottom, 80)
    }
}

struct CommentRow: View {
    @EnvironmentObject private var store: MockAppStore
    let comment: Comment
    let onLongPress: () -> Void

    var body: some View {
        let author = store.user(id: comment.authorID)
        HStack(alignment: .top, spacing: 10) {
            AvatarView(user: author, size: 34)
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(author.nickname)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.subtext)
                    Text(comment.createdAt.relativeText)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.muted)
                }
                if let replyToID = comment.replyToID {
                    let repliedComment = store.comment(id: replyToID).flatMap { $0.status == .active ? $0 : nil }
                    let repliedAuthor = repliedComment.map { store.user(id: $0.authorID).nickname } ?? "原评论"
                    Text("回复 \(repliedAuthor)：\(repliedComment?.body ?? "原评论已删除")")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.subtext)
                        .lineLimit(2)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                Text(comment.body)
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.text.opacity(0.86))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
        }
        .padding(.vertical, 8)
        .contentShape(Rectangle())
        .onLongPressGesture(minimumDuration: 0.35) {
            onLongPress()
        }
    }
}

struct CommentActionOverlay: View {
    @EnvironmentObject private var store: MockAppStore
    let comment: Comment
    let onDismiss: () -> Void
    let onReply: () -> Void
    let onCopy: () -> Void
    let onDelete: () -> Void

    var body: some View {
        let author = store.user(id: comment.authorID)
        ZStack(alignment: .bottom) {
            Color.black.opacity(0.58)
                .ignoresSafeArea()
                .onTapGesture(perform: onDismiss)

            VStack(alignment: .leading, spacing: 16) {
                Capsule()
                    .fill(Color.white.opacity(0.2))
                    .frame(width: 52, height: 5)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 10)

                Text("\(author.nickname) · \(comment.createdAt.relativeText)")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.52))

                VStack(spacing: 0) {
                    CommentActionRow(title: "回复", systemImage: "bubble.left", action: onReply)
                    CommentActionDivider()
                    CommentActionRow(title: "复制", systemImage: "doc.on.doc", action: onCopy)
                }
                .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                if store.canDeleteComment(comment) {
                    VStack(spacing: 0) {
                        CommentActionRow(title: "删除", systemImage: "trash", isDestructive: true, action: onDelete)
                    }
                    .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }

                Button(action: onDismiss) {
                    Text("取消")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.9))
                        .frame(maxWidth: .infinity)
                        .frame(height: 62)
                        .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color(red: 0.12, green: 0.12, blue: 0.14)
                    .clipShape(TopRoundedRectangle(radius: 28))
                    .ignoresSafeArea(edges: .bottom)
            )
        }
        .zIndex(10)
    }
}

struct CommentActionRow: View {
    let title: String
    let systemImage: String
    var isDestructive = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 18) {
                Image(systemName: systemImage)
                    .font(.system(size: 26, weight: .medium))
                    .frame(width: 36)
                Text(title)
                    .font(.system(size: 24, weight: .semibold))
                Spacer(minLength: 0)
            }
            .foregroundStyle(isDestructive ? Theme.hotPink : Color.white.opacity(0.9))
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: 72)
            .padding(.horizontal, 18)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct CommentActionDivider: View {
    var body: some View {
        Rectangle()
            .fill(Color.white.opacity(0.08))
            .frame(height: 0.5)
            .padding(.leading, 72)
    }
}

struct TopRoundedRectangle: Shape {
    let radius: CGFloat

    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: [.topLeft, .topRight],
            cornerRadii: CGSize(width: radius, height: radius)
        )
        return Path(path.cgPath)
    }
}

struct DetailActionBar: View {
    @EnvironmentObject private var store: MockAppStore
    let post: GroupBuyPost
    @Binding var commentDraft: String
    @Binding var replyTargetCommentID: String?

    var body: some View {
        let livePost = store.post(id: post.id) ?? post
        let isLiked = store.likedPostIDs.contains(post.id)
        let isFavorite = store.favoritePostIDs.contains(post.id)
        let commentTitle = livePost.commentCount == 0 ? "评论" : livePost.commentCount.formattedCount
        let replyTarget = replyTargetCommentID.flatMap { store.comment(id: $0) }
        let replyAuthor = replyTarget.map { store.user(id: $0.authorID) }
        VStack(spacing: 8) {
            if let replyAuthor {
                HStack(spacing: 8) {
                    Image(systemName: "arrowshape.turn.up.left.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.hotPink)
                    Text("回复 \(replyAuthor.nickname)")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    Button {
                        replyTargetCommentID = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(Theme.muted)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 14)
            }

            HStack(spacing: 12) {
                if store.isLoggedIn {
                    HStack(spacing: 8) {
                        Image(systemName: "pencil")
                            .foregroundStyle(Theme.muted)
                        TextField(replyAuthor == nil ? "发评论" : "回复 \(replyAuthor?.nickname ?? "")", text: $commentDraft)
                            .foregroundStyle(Theme.text)
                            .submitLabel(.send)
                            .onSubmit {
                                store.addComment(postID: post.id, body: commentDraft, replyToID: replyTargetCommentID)
                                commentDraft = ""
                                replyTargetCommentID = nil
                            }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 11)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.panelRaised, in: Capsule())
                } else {
                    Button {
                        store.requireLogin(prompt: "登录后才能评论")
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "pencil")
                                .foregroundStyle(Theme.muted)
                            Text("登录后评论")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(Theme.subtext)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 11)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.panelRaised, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }

                ActionIconButton(icon: isLiked ? "heart.fill" : "heart", title: livePost.likedCount.formattedCount, tint: isLiked ? Theme.hotPink : Theme.text) {
                    withAnimation(.spring(response: 0.22, dampingFraction: 0.72)) {
                        store.toggleLike(postID: post.id)
                    }
                }
                ActionIconButton(icon: isFavorite ? "star.fill" : "star", title: livePost.favoriteCount.formattedCount, tint: isFavorite ? Theme.hotPink : Theme.text) {
                    store.toggleFavorite(postID: post.id)
                }
                ActionIconButton(icon: "bubble.left", title: commentTitle, tint: Theme.text) {
                    guard store.requireLogin(prompt: "登录后才能评论") else { return }
                    if commentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        store.showToast("输入内容后按回车发布评论")
                    } else {
                        store.addComment(postID: post.id, body: commentDraft, replyToID: replyTargetCommentID)
                        commentDraft = ""
                        replyTargetCommentID = nil
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(.ultraThinMaterial)
        .overlay(alignment: .top) {
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
        }
    }
}

struct CreatePostView: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var title = ""
    @State private var selectedGroupType: GroupBuyType?
    @State private var selectedCollectionID = "none"
    @State private var uploadedImageData: [Data] = []
    @State private var selectedTags: Set<String> = []
    @State private var priceLowerBound = ""
    @State private var priceUpperBound = ""
    @State private var depositPercent = ""
    @State private var deadline = Calendar.current.date(byAdding: .day, value: 3, to: Date()) ?? Date()
    @State private var condition = ""
    @State private var wechat = ""
    @State private var qq = ""
    @State private var groupInfo = ""
    @State private var description = ""
    @State private var pingguAveragePrice = ""
    @State private var pingguNote = ""
    @State private var newRoleName = ""
    @State private var newRoleQuantity = "1"
    @State private var newRolePriceAdjustment = ""
    @State private var roleDrafts: [UnsoldRole] = []
    @State private var isCollectionPickerPresented = false
    @State private var isCreatingCollection = false
    @State private var isPhotoLibraryPresented = false

    let allTags = ["小卡", "吧唧", "立牌", "娃娃", "专辑", "饰品", "杂志", "演唱会周边", "自印团", "预售", "现货"]
    let noCollectionID = "none"

    var selectedCollection: GroupCollection? {
        selectedCollectionID == noCollectionID ? nil : store.collection(id: selectedCollectionID)
    }

    var usesCollection: Bool {
        selectedCollection != nil
    }

    var isSplitGoods: Bool {
        selectedGroupType == .splitGoods
    }

    var canPublish: Bool {
        selectedGroupType != nil &&
        !title.trimmed.isEmpty &&
        !uploadedImageData.isEmpty &&
        !priceLowerBound.trimmed.isEmpty &&
        !priceUpperBound.trimmed.isEmpty &&
        !condition.trimmed.isEmpty &&
        usesCollection &&
        !description.trimmed.isEmpty &&
        (!isSplitGoods || (!pingguAveragePrice.trimmed.isEmpty && !pingguNote.trimmed.isEmpty && !roleDrafts.filter(\.isAvailable).isEmpty))
    }

    var priceRangeText: String {
        let lower = priceLowerBound.trimmed
        let upper = priceUpperBound.trimmed
        if lower.isEmpty && upper.isEmpty { return "" }
        if upper.isEmpty || lower == upper { return "¥\(lower)" }
        return "¥\(lower)-¥\(upper)"
    }

    var depositText: String {
        let value = finalizedDepositPercent(depositPercent)
        return value.isEmpty ? "无定金" : "定金 \(value)%"
    }

    var body: some View {
        if store.isLoggedIn {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 20) {
                    HeaderTitle(title: "发布团购帖", subtitle: "每个帖子必须归入一个拼团合集")
                VStack(alignment: .leading, spacing: 14) {
                    RequiredLabel("拼团类型")
                    HStack(spacing: 10) {
                        ForEach(GroupBuyType.allCases) { type in
                            Button {
                                selectedGroupType = type
                            } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    Label(type.rawValue, systemImage: type.icon)
                                        .font(.system(size: 17, weight: .black))
                                    Text(type.feedDescription)
                                        .font(.system(size: 12, weight: .bold))
                                        .foregroundStyle(selectedGroupType == type ? .white.opacity(0.82) : Theme.muted)
                                }
                                .foregroundStyle(selectedGroupType == type ? .white : Theme.subtext)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(14)
                                .background(selectedGroupType == type ? type.accent : Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(selectedGroupType == type ? type.accent : Theme.hairline, lineWidth: 1)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, 16)

                VStack(alignment: .leading, spacing: 10) {
                    RequiredLabel("拼团合集")
                    if store.collections(ownerID: store.currentUserID).isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Label("发布前必须先创建一个合集", systemImage: "rectangle.stack.badge.plus")
                                .font(.system(size: 16, weight: .black))
                                .foregroundStyle(Theme.text)
                            Text("合集会统一保存联系方式、截团时间和默认说明；帖子发布时只能选择已有合集。")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.subtext)
                            Button {
                                isCreatingCollection = true
                            } label: {
                                Label("创建合集", systemImage: "plus")
                                    .font(.system(size: 15, weight: .black))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 18)
                                    .padding(.vertical, 11)
                                    .background(Theme.hotPink, in: Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(14)
                        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    } else {
                        Button {
                            isCollectionPickerPresented = true
                        } label: {
                            CollectionPickerSummary(collection: selectedCollection)
                        }
                        .buttonStyle(.plain)
                    }

                    if let selectedCollection {
                        CollectionSharedInfoCard(collection: selectedCollection)
                    }
                }
                .padding(.horizontal, 16)

                VStack(alignment: .leading, spacing: 12) {
                    RequiredLabel("产品图片")
                    ImageUploadComposer(images: $uploadedImageData) {
                        isPhotoLibraryPresented = true
                    }
                    Text(uploadedImageData.isEmpty ? "点击加号从相册导入图片。" : "拖动图片调整顺序，第一张会作为信息流封面。")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.muted)
                }
                .padding(.horizontal, 16)

                VStack(spacing: 12) {
                    PrototypeTextField(title: "标题", placeholder: "例如：巡演限定小卡套组二开", text: $title, required: true)
                    TagEditor(tags: allTags, selection: $selectedTags)
                    VStack(alignment: .leading, spacing: 10) {
                        RequiredLabel("商品价格范围")
                        HStack(spacing: 10) {
                            PrototypeTextField(title: "下限", placeholder: "35", text: $priceLowerBound, required: true)
                                .keyboardType(.decimalPad)
                            PrototypeTextField(title: "上限", placeholder: "68", text: $priceUpperBound, required: true)
                                .keyboardType(.decimalPad)
                        }
                    }
                    PrototypeTextField(title: "定金比例", placeholder: "例如：30", text: $depositPercent, required: false)
                        .keyboardType(.decimalPad)
                        .onChange(of: depositPercent) {
                            let sanitized = sanitizeDepositPercentInput(depositPercent)
                            if sanitized != depositPercent {
                                depositPercent = sanitized
                            }
                        }
                    PrototypeTextField(title: "成团条件", placeholder: "满 60 套开团，未成团退定", text: $condition, required: true)
                    PrototypeTextEditor(title: "团购说明", placeholder: "写清商品内容、规格、余量、表单和周期", text: $description, required: true)
                }
                .padding(.horizontal, 16)

                if isSplitGoods {
                    VStack(alignment: .leading, spacing: 12) {
                        RequiredLabel("拼谷展示信息")
                        PrototypeTextField(title: "当前谷子均价", placeholder: "例如：均价35元/吧唧", text: $pingguAveragePrice, required: true)
                        PrototypeTextEditor(title: "团长自定义描述", placeholder: "例如：目前还缺主角团角色位", text: $pingguNote, required: true)
                        VStack(alignment: .leading, spacing: 10) {
                            RequiredLabel("未被购买角色")
                            if roleDrafts.isEmpty {
                                Text("添加后会用于详情页展示和搜索栏角色筛选。")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(Theme.muted)
                            } else {
                                ForEach(roleDrafts) { role in
                                    HStack {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(role.name)
                                                .font(.system(size: 15, weight: .bold))
                                                .foregroundStyle(Theme.text)
                                            if role.priceAdjustment != 0 {
                                                Text("角色调价 \(role.priceAdjustmentText)")
                                                    .font(.system(size: 12, weight: .black))
                                                    .foregroundStyle(GroupBuyType.splitGoods.accent)
                                            }
                                        }
                                        Spacer()
                                        Text("(\(role.quantity))")
                                            .font(.system(size: 15, weight: .black))
                                            .foregroundStyle(GroupBuyType.splitGoods.accent)
                                        Button {
                                            roleDrafts.removeAll { $0.id == role.id }
                                        } label: {
                                            Image(systemName: "xmark.circle.fill")
                                                .foregroundStyle(Theme.muted)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                    .padding(12)
                                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                }
                            }
                            HStack(spacing: 8) {
                                TextField("角色名，如 Bucky Barnes", text: $newRoleName)
                                    .foregroundStyle(Theme.text)
                                    .padding(12)
                                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                                TextField("数量", text: $newRoleQuantity)
                                    .keyboardType(.numberPad)
                                    .foregroundStyle(Theme.text)
                                    .frame(width: 72)
                                    .padding(12)
                                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                                TextField("调价", text: $newRolePriceAdjustment)
                                    .keyboardType(.numbersAndPunctuation)
                                    .foregroundStyle(Theme.text)
                                    .frame(width: 78)
                                    .padding(12)
                                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                                Button {
                                    addRoleDraft()
                                } label: {
                                    Image(systemName: "plus")
                                        .font(.system(size: 18, weight: .black))
                                        .foregroundStyle(.white)
                                        .frame(width: 44, height: 44)
                                        .background(GroupBuyType.splitGoods.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                }

                VStack(alignment: .leading, spacing: 10) {
                    ValidationRow(isValid: selectedGroupType != nil, text: "已选择拼团类型")
                    ValidationRow(isValid: usesCollection, text: "已选择拼团合集")
                    ValidationRow(isValid: !title.trimmed.isEmpty, text: "已填写标题")
                    ValidationRow(isValid: !uploadedImageData.isEmpty, text: "已上传产品图片")
                    ValidationRow(isValid: !priceLowerBound.trimmed.isEmpty && !priceUpperBound.trimmed.isEmpty, text: "已填写商品价格范围")
                    ValidationRow(isValid: !condition.trimmed.isEmpty, text: "已填写成团条件")
                    ValidationRow(isValid: !description.trimmed.isEmpty, text: "已填写团购说明")
                    if isSplitGoods {
                        ValidationRow(isValid: !pingguAveragePrice.trimmed.isEmpty && !pingguNote.trimmed.isEmpty, text: "已填写拼谷均价和描述")
                        ValidationRow(isValid: !roleDrafts.filter(\.isAvailable).isEmpty, text: "已录入可售角色和数量")
                    }
                }
                .padding(16)
                .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                .padding(.horizontal, 16)

                Button {
                    if let selectedGroupType, let selectedCollection {
                        store.createPost(title: title, groupType: selectedGroupType, collectionID: selectedCollection.id, imageNames: ["merch_photocards"], uploadedImageData: uploadedImageData, tags: Array(selectedTags), price: priceRangeText, deposit: depositText, deadline: deadline, condition: condition, wechat: wechat, qq: qq, groupInfo: groupInfo, description: description, pingguAveragePrice: pingguAveragePrice, pingguNote: pingguNote, unsoldRoles: roleDrafts)
                        reset()
                    }
                } label: {
                    Text(canPublish ? "发布到\(selectedGroupType?.moduleTitle ?? "首页")模块" : "补齐必填字段后发布")
                        .font(.system(size: 17, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                        .background(canPublish ? Theme.hotPink : Theme.panelRaised, in: Capsule())
                        .foregroundStyle(canPublish ? .white : Theme.muted)
                }
                .buttonStyle(.plain)
                .disabled(!canPublish)
                .padding(.horizontal, 16)
                .padding(.bottom, 28)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.background.ignoresSafeArea())
            .navigationBarHidden(true)
            .sheet(isPresented: $isCollectionPickerPresented) {
                CollectionPickerSheet(
                    collections: store.collections(ownerID: store.currentUserID),
                    selectedCollectionID: $selectedCollectionID
                )
                .presentationDetents([.height(390), .medium])
                .presentationDragIndicator(.hidden)
                .presentationBackground(Theme.background)
            }
            .sheet(isPresented: $isCreatingCollection) {
                CreateCollectionSheet(onCreated: { collectionID in
                    selectedCollectionID = collectionID
                })
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
            }
            .fullScreenCover(isPresented: $isPhotoLibraryPresented) {
                PhotoLibraryImportView(maxSelection: max(1, 16 - uploadedImageData.count)) { importedData in
                    uploadedImageData.append(contentsOf: importedData)
                    uploadedImageData = Array(uploadedImageData.prefix(16))
                }
            }
        } else {
            GuestAuthView()
        }
    }

    func reset() {
        title = ""
        selectedGroupType = nil
        selectedCollectionID = noCollectionID
        uploadedImageData = []
        selectedTags = []
        priceLowerBound = ""
        priceUpperBound = ""
        depositPercent = ""
        condition = ""
        wechat = ""
        qq = ""
        groupInfo = ""
        description = ""
        pingguAveragePrice = ""
        pingguNote = ""
        newRoleName = ""
        newRoleQuantity = "1"
        newRolePriceAdjustment = ""
        roleDrafts = []
    }

    func addRoleDraft() {
        let quantity = max(1, Int(newRoleQuantity) ?? 1)
        let trimmed = newRoleName.trimmed
        guard !trimmed.isEmpty else { return }
        roleDrafts.append(UnsoldRole(name: trimmed, quantity: quantity, priceAdjustment: parsePriceAdjustment(newRolePriceAdjustment)))
        newRoleName = ""
        newRoleQuantity = "1"
        newRolePriceAdjustment = ""
    }
}

struct ImageUploadComposer: View {
    @Binding var images: [Data]
    let onAdd: () -> Void
    @State private var draggingIndex: Int?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 14) {
                ForEach(Array(images.indices), id: \.self) { index in
                    UploadedImageTile(
                        data: images[index],
                        index: index,
                        isCover: index == 0,
                        images: $images,
                        draggingIndex: $draggingIndex
                    )
                }

                Button(action: onAdd) {
                    VStack(spacing: 12) {
                        Image(systemName: "plus")
                            .font(.system(size: 38, weight: .light))
                        Text(images.isEmpty ? "上传图片" : "继续添加")
                            .font(.system(size: 13, weight: .bold))
                    }
                    .foregroundStyle(Theme.subtext)
                    .frame(width: 132, height: 132)
                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Theme.hairline, lineWidth: 1)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("从相册上传产品图片")
            }
            .padding(.vertical, 2)
        }
    }
}

struct UploadedImageTile: View {
    let data: Data
    let index: Int
    let isCover: Bool
    @Binding var images: [Data]
    @Binding var draggingIndex: Int?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            UploadedImageView(data: data)
                .scaledToFill()
                .frame(width: 132, height: 132)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(alignment: .topLeading) {
                    Text(isCover ? "封面" : "\(index + 1)")
                        .font(.system(size: 12, weight: .black))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background((isCover ? Theme.hotPink : Color.black.opacity(0.58)), in: Capsule())
                        .padding(8)
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(isCover ? Theme.hotPink : Theme.hairline, lineWidth: isCover ? 2 : 1)
                }

            Button {
                guard images.indices.contains(index) else { return }
                images.remove(at: index)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .black))
                    .foregroundStyle(.white)
                    .frame(width: 26, height: 26)
                    .background(Color.black.opacity(0.68), in: Circle())
                    .padding(7)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("删除第 \(index + 1) 张图片")
        }
        .opacity(draggingIndex == index ? 0.55 : 1)
        .onDrag {
            draggingIndex = index
            return NSItemProvider(object: "\(index)" as NSString)
        }
        .onDrop(of: [UTType.text], delegate: UploadedImageDropDelegate(targetIndex: index, images: $images, draggingIndex: $draggingIndex))
    }
}

struct UploadedImageDropDelegate: DropDelegate {
    let targetIndex: Int
    @Binding var images: [Data]
    @Binding var draggingIndex: Int?

    func dropEntered(info: DropInfo) {
        guard let fromIndex = draggingIndex,
              fromIndex != targetIndex,
              images.indices.contains(fromIndex),
              images.indices.contains(targetIndex) else { return }
        withAnimation(.spring(response: 0.24, dampingFraction: 0.82)) {
            let item = images.remove(at: fromIndex)
            images.insert(item, at: targetIndex)
            draggingIndex = targetIndex
        }
    }

    func performDrop(info: DropInfo) -> Bool {
        draggingIndex = nil
        return true
    }
}

struct PhotoAssetPreview: Identifiable {
    let id: String
    let asset: PHAsset
    var thumbnail: UIImage?
}

struct PhotoLibraryImportView: View {
    @Environment(\.dismiss) private var dismiss
    let maxSelection: Int
    let onImport: ([Data]) -> Void
    @State private var authorizationStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    @State private var assets: [PhotoAssetPreview] = []
    @State private var selectedIDs: [String] = []
    @State private var isLoadingAssets = false
    @State private var isImporting = false
    @State private var importErrorMessage: String?

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 3)

    var body: some View {
        ZStack(alignment: .bottom) {
            Theme.background.ignoresSafeArea()
            VStack(spacing: 0) {
                photoPickerHeader
                photoPickerContent
            }

            if !selectedIDs.isEmpty {
                photoPickerBottomBar
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.26, dampingFraction: 0.86), value: selectedIDs)
        .onAppear(perform: requestPhotoAccess)
    }

    private var photoPickerHeader: some View {
        HStack {
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(Theme.text)
                    .frame(width: 52, height: 52)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("关闭相册选择")

            Spacer()

            HStack(spacing: 6) {
                Text("最近项目")
                    .font(.system(size: 28, weight: .bold))
                Image(systemName: "chevron.down")
                    .font(.system(size: 18, weight: .bold))
            }
            .foregroundStyle(Theme.text)

            Spacer()

            Color.clear
                .frame(width: 52, height: 52)
        }
        .padding(.horizontal, 18)
        .padding(.top, 10)
        .padding(.bottom, 22)
        .background(Theme.background)
    }

    @ViewBuilder
    private var photoPickerContent: some View {
        switch authorizationStatus {
        case .authorized, .limited:
            if isLoadingAssets && assets.isEmpty {
                VStack(spacing: 14) {
                    ProgressView()
                        .tint(Theme.hotPink)
                    Text("正在读取相册")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Theme.muted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if assets.isEmpty {
                VStack(spacing: 14) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.system(size: 44, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                    Text("相册里还没有可选图片")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(Theme.subtext)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView(showsIndicators: false) {
                    LazyVGrid(columns: columns, spacing: 2) {
                        ForEach(assets) { item in
                            PhotoLibraryGridCell(
                                item: item,
                                selectionIndex: selectionIndex(for: item.id),
                                isSelectionDisabled: selectedIDs.count >= maxSelection && selectionIndex(for: item.id) == nil
                            ) {
                                toggleSelection(item.id)
                            }
                        }
                    }
                    .padding(.bottom, selectedIDs.isEmpty ? 18 : 244)
                }
            }
        case .notDetermined:
            permissionPrompt(title: "允许访问相册", message: "发帖上传图片前，需要先允许周边团读取你的照片。", buttonTitle: "继续")
        default:
            permissionPrompt(title: "无法访问相册", message: "请在系统设置中允许周边团访问照片后再上传。", buttonTitle: "重新检查权限")
        }
    }

    private var photoPickerBottomBar: some View {
        VStack(alignment: .leading, spacing: 18) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(selectedIDs, id: \.self) { id in
                        if let item = assets.first(where: { $0.id == id }) {
                            ZStack(alignment: .topTrailing) {
                                PhotoLibraryThumbnailImage(image: item.thumbnail)
                                    .scaledToFill()
                                    .frame(width: 74, height: 74)
                                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                Button {
                                    toggleSelection(id)
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 11, weight: .black))
                                        .foregroundStyle(.white)
                                        .frame(width: 24, height: 24)
                                        .background(Color.black.opacity(0.72), in: Circle())
                                }
                                .buttonStyle(.plain)
                                .offset(x: 6, y: -6)
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
            }

            HStack {
                Text("可选择\(maxSelection)张图片")
                    .font(.system(size: 22, weight: .black))
                    .foregroundStyle(Theme.text)
                Spacer()
                Button {
                    Task { await importSelectedAssets() }
                } label: {
                    HStack(spacing: 10) {
                        if isImporting {
                            ProgressView()
                                .tint(.white)
                        }
                        Text(isImporting ? "导入中" : "下一步")
                            .font(.system(size: 20, weight: .black))
                    }
                    .foregroundStyle(.white)
                    .frame(width: 170, height: 62)
                    .background(Theme.hotPink, in: Capsule())
                    .overlay(alignment: .topLeading) {
                        Text("\(selectedIDs.count)")
                            .font(.system(size: 17, weight: .black))
                            .foregroundStyle(.white)
                            .frame(width: 38, height: 38)
                            .background(Theme.hotPink, in: Circle())
                            .overlay {
                                Circle().stroke(.white, lineWidth: 3)
                            }
                            .offset(x: -196, y: -88)
                    }
                }
                .buttonStyle(.plain)
                .disabled(isImporting)
            }
            .padding(.horizontal, 26)

            if let importErrorMessage {
                Text(importErrorMessage)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.hotPink)
                    .padding(.horizontal, 26)
            }
        }
        .padding(.top, 20)
        .padding(.bottom, 34)
        .background(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(Theme.panel)
                .ignoresSafeArea(edges: .bottom)
        )
    }

    private func permissionPrompt(title: String, message: String, buttonTitle: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "photo.badge.plus")
                .font(.system(size: 46, weight: .semibold))
                .foregroundStyle(Theme.hotPink)
            Text(title)
                .font(.system(size: 24, weight: .black))
                .foregroundStyle(Theme.text)
            Text(message)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 34)
            Button(buttonTitle) {
                requestPhotoAccess()
            }
            .font(.system(size: 17, weight: .black))
            .foregroundStyle(.white)
            .padding(.horizontal, 26)
            .padding(.vertical, 13)
            .background(Theme.hotPink, in: Capsule())
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func requestPhotoAccess() {
        let currentStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        authorizationStatus = currentStatus
        switch currentStatus {
        case .authorized, .limited:
            loadAssets()
        case .notDetermined:
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { newStatus in
                Task { @MainActor in
                    authorizationStatus = newStatus
                    if newStatus == .authorized || newStatus == .limited {
                        loadAssets()
                    }
                }
            }
        default:
            break
        }
    }

    private func loadAssets() {
        guard !isLoadingAssets else { return }
        isLoadingAssets = true
        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        let result = PHAsset.fetchAssets(with: .image, options: options)
        var loaded: [PhotoAssetPreview] = []
        result.enumerateObjects { asset, _, _ in
            loaded.append(PhotoAssetPreview(id: asset.localIdentifier, asset: asset, thumbnail: nil))
        }
        assets = loaded
        isLoadingAssets = false
        loaded.forEach { requestThumbnail(for: $0.asset, id: $0.id) }
    }

    private func requestThumbnail(for asset: PHAsset, id: String) {
        let options = PHImageRequestOptions()
        options.deliveryMode = .opportunistic
        options.resizeMode = .fast
        options.isNetworkAccessAllowed = true
        PHImageManager.default().requestImage(
            for: asset,
            targetSize: CGSize(width: 320, height: 320),
            contentMode: .aspectFill,
            options: options
        ) { image, _ in
            guard let image else { return }
            Task { @MainActor in
                if let index = assets.firstIndex(where: { $0.id == id }) {
                    assets[index].thumbnail = image
                }
            }
        }
    }

    private func toggleSelection(_ id: String) {
        importErrorMessage = nil
        if let index = selectedIDs.firstIndex(of: id) {
            selectedIDs.remove(at: index)
        } else if selectedIDs.count < maxSelection {
            selectedIDs.append(id)
        }
    }

    private func selectionIndex(for id: String) -> Int? {
        selectedIDs.firstIndex(of: id).map { $0 + 1 }
    }

    @MainActor
    private func importSelectedAssets() async {
        guard !isImporting else { return }
        isImporting = true
        importErrorMessage = nil
        var imported: [Data] = []
        for id in selectedIDs {
            guard let asset = assets.first(where: { $0.id == id })?.asset,
                  let data = await imageData(for: asset) else { continue }
            imported.append(data)
        }
        guard !imported.isEmpty else {
            isImporting = false
            importErrorMessage = "图片读取失败，请稍后重试或换一张"
            return
        }
        onImport(imported)
        isImporting = false
        dismiss()
    }

    private func imageData(for asset: PHAsset) async -> Data? {
        await withCheckedContinuation { continuation in
            let manager = PHImageManager.default()
            let options = PHImageRequestOptions()
            options.deliveryMode = .highQualityFormat
            options.isNetworkAccessAllowed = true
            options.resizeMode = .fast

            let lock = NSLock()
            var didResume = false
            var requestID = PHInvalidImageRequestID

            func resume(_ data: Data?) {
                lock.lock()
                guard !didResume else {
                    lock.unlock()
                    return
                }
                didResume = true
                lock.unlock()
                continuation.resume(returning: data.map { ImageDataNormalizer.jpegData(from: $0, maxSide: 1800, compressionQuality: 0.8) })
            }

            requestID = manager.requestImageDataAndOrientation(for: asset, options: options) { data, _, _, info in
                if info?[PHImageCancelledKey] as? Bool == true || info?[PHImageErrorKey] != nil {
                    resume(nil)
                    return
                }
                resume(data)
            }

            DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 15) {
                lock.lock()
                let shouldCancel = !didResume
                lock.unlock()
                if shouldCancel {
                    manager.cancelImageRequest(requestID)
                    resume(nil)
                }
            }
        }
    }
}

struct CameraCaptureView: UIViewControllerRepresentable {
    @Environment(\.dismiss) private var dismiss
    let onCapture: (Data) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let controller = UIImagePickerController()
        controller.sourceType = .camera
        controller.mediaTypes = ["public.image"]
        controller.allowsEditing = false
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        let parent: CameraCaptureView

        init(parent: CameraCaptureView) {
            self.parent = parent
        }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage,
               let data = ImageDataNormalizer.jpegData(from: image, maxSide: 1800, compressionQuality: 0.8) {
                parent.onCapture(data)
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}

struct PhotoLibraryGridCell: View {
    let item: PhotoAssetPreview
    let selectionIndex: Int?
    let isSelectionDisabled: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            GeometryReader { proxy in
                ZStack(alignment: .topTrailing) {
                    PhotoLibraryThumbnailImage(image: item.thumbnail)
                        .scaledToFill()
                        .frame(width: proxy.size.width, height: proxy.size.width)
                        .clipped()
                        .overlay {
                            if selectionIndex != nil {
                                Color.black.opacity(0.18)
                            } else if isSelectionDisabled {
                                Color.black.opacity(0.52)
                            }
                        }

                    selectionCircle
                        .padding(10)
                }
            }
            .aspectRatio(1, contentMode: .fit)
        }
        .buttonStyle(.plain)
        .disabled(isSelectionDisabled)
    }

    @ViewBuilder
    private var selectionCircle: some View {
        if let selectionIndex {
            Text("\(selectionIndex)")
                .font(.system(size: 15, weight: .black))
                .foregroundStyle(.white)
                .frame(width: 34, height: 34)
                .background(Theme.hotPink, in: Circle())
                .overlay {
                    Circle().stroke(.white, lineWidth: 2.5)
                }
        } else {
            Circle()
                .stroke(.white, lineWidth: 2.5)
                .frame(width: 34, height: 34)
                .background(Color.black.opacity(0.08), in: Circle())
        }
    }
}

struct PhotoLibraryThumbnailImage: View {
    let image: UIImage?

    var body: some View {
        if let image {
            Image(uiImage: image)
                .resizable()
        } else {
            Rectangle()
                .fill(Theme.panelRaised)
                .overlay {
                    ProgressView()
                        .tint(Theme.hotPink)
                }
        }
    }
}

struct CollectionPickerSummary: View {
    let collection: GroupCollection?

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(collection == nil ? Theme.panelRaised : Theme.hotPink.opacity(0.18))
                    .frame(width: 46, height: 46)
                Image(systemName: "rectangle.stack.fill")
                    .font(.system(size: 20, weight: .black))
                    .foregroundStyle(collection == nil ? Theme.subtext : Theme.hotPink)
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(collection?.name ?? "请选择合集")
                    .font(.system(size: 18, weight: .black))
                    .foregroundStyle(collection == nil ? Theme.subtext : Theme.text)
                    .lineLimit(1)
                Text(collection == nil ? "每个帖子必须归入一个拼团合集" : "自动继承合集联系方式、截团时间和默认说明")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }

            Spacer()

            Image(systemName: "chevron.up.chevron.down")
                .font(.system(size: 16, weight: .black))
                .foregroundStyle(Theme.hotPink)
        }
        .padding(14)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(collection == nil ? Theme.hairline : Theme.hotPink.opacity(0.48), lineWidth: 1)
        }
        .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct CollectionPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var isCreatingCollection = false
    let collections: [GroupCollection]
    @Binding var selectedCollectionID: String

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("选择拼团合集")
                        .font(.system(size: 24, weight: .black))
                        .foregroundStyle(Theme.text)
                    Text("发布前必须选择一个合集")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.subtext)
                }
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 17, weight: .black))
                        .foregroundStyle(Theme.text)
                        .frame(width: 38, height: 38)
                        .background(Theme.panelRaised, in: Circle())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 18)
            .padding(.top, 18)
            .padding(.bottom, 14)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 10) {
                    ForEach(collections) { collection in
                        CollectionPickerOption(
                            title: collection.name,
                            subtitle: "\(collection.deadline.fullDisplay) 截团 · \(collection.isEnded ? "已结团" : "\(collection.postIDs.count) 篇内容")",
                            icon: "rectangle.stack.fill",
                            isSelected: selectedCollectionID == collection.id,
                            isEnded: collection.isEnded
                        ) {
                            selectedCollectionID = collection.id
                            dismiss()
                        }
                    }

                    Button {
                        isCreatingCollection = true
                    } label: {
                        HStack(spacing: 14) {
                            Image(systemName: "plus")
                                .font(.system(size: 22, weight: .black))
                                .foregroundStyle(.white)
                                .frame(width: 56, height: 56)
                                .background(Theme.hotPink, in: RoundedRectangle(cornerRadius: 8, style: .continuous))

                            VStack(alignment: .leading, spacing: 4) {
                                Text("新建拼团合集")
                                    .font(.system(size: 19, weight: .black))
                                    .foregroundStyle(Theme.text)
                                Text("创建后自动选中，用于发布这篇帖子")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(Theme.subtext)
                                    .lineLimit(1)
                            }

                            Spacer()

                            Image(systemName: "chevron.right")
                                .font(.system(size: 16, weight: .black))
                                .foregroundStyle(Theme.hotPink)
                        }
                        .padding(14)
                        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(Theme.hotPink.opacity(0.42), lineWidth: 1)
                        }
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 24)
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .sheet(isPresented: $isCreatingCollection) {
            CreateCollectionSheet(onCreated: { collectionID in
                selectedCollectionID = collectionID
                dismiss()
            })
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
    }
}

struct CollectionPickerOption: View {
    let title: String
    let subtitle: String
    let icon: String
    let isSelected: Bool
    let isEnded: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .black))
                    .foregroundStyle(isSelected ? .white : Theme.hotPink)
                    .frame(width: 42, height: 42)
                    .background(isSelected ? Theme.hotPink : Theme.hotPink.opacity(0.14), in: RoundedRectangle(cornerRadius: 8, style: .continuous))

                VStack(alignment: .leading, spacing: 5) {
                    Text(title)
                        .font(.system(size: 18, weight: .black))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.subtext)
                        .lineLimit(1)
                }

                Spacer()

                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22, weight: .black))
                    .foregroundStyle(isSelected ? Theme.hotPink : Theme.muted)
            }
            .padding(14)
            .background(isSelected ? Theme.panelRaised : Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(isSelected ? Theme.hotPink.opacity(0.7) : Theme.hairline, lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .saturation(isEnded ? 0 : 1)
        .opacity(isEnded ? 0.56 : 1)
    }
}

struct MessagesView: View {
    @EnvironmentObject private var store: MockAppStore

    var body: some View {
        Group {
            if store.isLoggedIn {
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 18) {
                        HeaderTitle(title: "消息", subtitle: "站内咨询、截团提醒和治理通知")
                        VStack(spacing: 10) {
                            ForEach(store.currentUserReminders.prefix(3)) { reminder in
                                if let post = store.post(id: reminder.postID) {
                                    NavigationLink(value: Route.postDetail(post.id)) {
                                        ReminderMiniCard(post: post, reminder: reminder)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            if store.currentUserReminders.isEmpty {
                                MessagesEmptyPanel(title: "暂无截团提醒", icon: "bell")
                            }
                        }
                        .padding(.horizontal, 16)

                        Text("私信咨询")
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(Theme.text)
                            .padding(.horizontal, 16)

                        VStack(spacing: 0) {
                            if store.messageThreads.isEmpty {
                                MessagesEmptyPanel(title: "暂无私信", icon: "bubble.left.and.bubble.right")
                            } else {
                                ForEach(store.messageThreads) { thread in
                                    NavigationLink(value: Route.chat(thread.id)) {
                                        ThreadRow(thread: thread)
                                    }
                                    .buttonStyle(.plain)
                                    Divider().overlay(Theme.hairline).padding(.leading, 74)
                                }
                            }
                        }
                        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                        .padding(.horizontal, 16)
                    }
                    .padding(.bottom, 28)
                }
                .background(Theme.background.ignoresSafeArea())
                .onAppear {
                    store.ensureMutualFriendThreads()
                }
            } else {
                GuestAuthView()
            }
        }
        .navigationBarHidden(true)
    }
}

struct MessagesEmptyPanel: View {
    let title: String
    let icon: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Theme.muted)
                .frame(width: 38, height: 38)
                .background(Theme.panelRaised, in: Circle())
            Text(title)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.subtext)
            Spacer()
        }
        .padding(14)
        .frame(maxWidth: .infinity)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Theme.hairline, lineWidth: 1)
        }
    }
}

struct ThreadRow: View {
    @EnvironmentObject private var store: MockAppStore
    let thread: MessageThread

    var body: some View {
        let user = store.user(id: store.peerUserID(for: thread))
        let post = thread.relatedPostID.flatMap(store.post)
        HStack(spacing: 12) {
            AvatarView(user: user, size: 46)
            VStack(alignment: .leading, spacing: 5) {
                Text(user.nickname)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(post?.title ?? "好友私聊")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.softPink)
                    .lineLimit(1)
                Text(thread.messages.last?.body ?? "互相关注，开始聊天")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.subtext)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if thread.unreadCount > 0 {
                Text("\(thread.unreadCount)")
                    .font(.system(size: 12, weight: .black))
                    .foregroundStyle(.white)
                    .monospacedDigit()
                    .padding(.horizontal, 8)
                    .frame(minWidth: 24, minHeight: 24)
                    .background(Theme.hotPink, in: Capsule())
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }
}

struct ChatView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var draft = ""
    @State private var isAttachmentPanelOpen = false
    @State private var isMessageFieldFocused = false
    @State private var prefersEmojiKeyboard = false
    @State private var isPhotoLibraryPresented = false
    @State private var isCameraPresented = false
    let threadID: String

    var body: some View {
        if let thread = store.messageThread(id: threadID) {
            let peer = store.user(id: store.peerUserID(for: thread))
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 28, weight: .medium))
                            .foregroundStyle(Theme.text)
                            .frame(width: 42, height: 48)
                    }
                    .buttonStyle(.plain)
                    AvatarView(user: peer, size: 44)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(peer.nickname)
                            .font(.system(size: 23, weight: .bold))
                            .foregroundStyle(Theme.text)
                        Text("20分钟内在线")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.subtext)
                    }
                    Spacer()
                }
                .padding(.horizontal, 12)
                .padding(.top, 10)
                .padding(.bottom, 12)
                .background(Theme.background)

                ScrollViewReader { proxy in
                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 18) {
                            Text("05-03 23:26")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(Theme.muted)
                                .padding(.top, 18)

                            ForEach(Array(thread.messages.enumerated()), id: \.element.id) { index, message in
                                if index == 2 {
                                    Text("05-04 15:36")
                                        .font(.system(size: 18, weight: .semibold))
                                        .foregroundStyle(Theme.muted)
                                        .padding(.top, 10)
                                }
                                ChatBubble(message: message)
                                    .id(message.id)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 12)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .onChange(of: thread.messages.count) {
                        if let last = thread.messages.last {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                    .onTapGesture {
                        closeInputSurfaces()
                    }
                }

                VStack(spacing: 0) {
                    HStack(spacing: 12) {
                        EmojiMessageTextField(
                            text: $draft,
                            isFocused: $isMessageFieldFocused,
                            prefersEmojiKeyboard: $prefersEmojiKeyboard,
                            placeholder: "发消息...",
                            onTap: activateNormalKeyboard,
                            onSubmit: send
                        )
                        .frame(height: 52)
                        .padding(.horizontal, 16)
                        .background(Theme.panelRaised, in: Capsule())

                        Button {
                            isAttachmentPanelOpen = false
                            prefersEmojiKeyboard = true
                            isMessageFieldFocused = true
                        } label: {
                            Image(systemName: "face.smiling")
                                .font(.system(size: 29, weight: .medium))
                                .foregroundStyle(Theme.text)
                                .frame(width: 42, height: 42)
                        }
                        .buttonStyle(.plain)

                        Button {
                            if draft.trimmed.isEmpty {
                                toggleAttachmentPanel()
                            } else {
                                send()
                            }
                        } label: {
                            Image(systemName: draft.trimmed.isEmpty ? "plus.circle" : "paperplane.fill")
                                .font(.system(size: 31, weight: .medium))
                                .foregroundStyle(draft.trimmed.isEmpty ? Theme.text : Theme.hotPink)
                                .frame(width: 42, height: 42)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .padding(.bottom, 14)

                    if isAttachmentPanelOpen {
                        ChatAttachmentPanel { option in
                            openAttachmentPicker(option)
                        }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .background(Theme.background)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationBarBackButtonHidden(true)
            .navigationBarHidden(true)
            .toolbar(.hidden, for: .tabBar)
            .onAppear {
                store.markThreadRead(threadID: threadID)
            }
            .fullScreenCover(isPresented: $isPhotoLibraryPresented) {
                PhotoLibraryImportView(maxSelection: 9) { importedData in
                    for data in importedData {
                        _ = store.sendImageMessage(threadID: threadID, imageData: data)
                    }
                }
            }
            .sheet(isPresented: $isCameraPresented) {
                CameraCaptureView { data in
                    _ = store.sendImageMessage(threadID: threadID, imageData: data)
                }
                .ignoresSafeArea()
            }
            .simultaneousGesture(
                DragGesture(minimumDistance: 30)
                    .onEnded(handleExitSwipe)
            )
        } else {
            ContentUnavailableView("会话不存在", systemImage: "bubble.left")
        }
    }

    private func send() {
        if store.sendMessage(threadID: threadID, body: draft) {
            draft = ""
            isAttachmentPanelOpen = false
        }
    }

    private func activateNormalKeyboard() {
        isAttachmentPanelOpen = false
        prefersEmojiKeyboard = false
        isMessageFieldFocused = true
    }

    private func toggleAttachmentPanel() {
        prefersEmojiKeyboard = false
        isMessageFieldFocused = false
        hideKeyboard()
        DispatchQueue.main.async {
            hideKeyboard()
            withAnimation(.spring(response: 0.24, dampingFraction: 0.84)) {
                isAttachmentPanelOpen.toggle()
            }
        }
    }

    private func openAttachmentPicker(_ option: String) {
        prefersEmojiKeyboard = false
        isMessageFieldFocused = false
        withAnimation(AppMotion.quick) {
            isAttachmentPanelOpen = false
        }
        hideKeyboard()
        DispatchQueue.main.async {
            hideKeyboard()
            if option == "拍照" {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    isCameraPresented = true
                } else {
                    store.showToast("当前设备不可用相机")
                }
            } else {
                isPhotoLibraryPresented = true
            }
        }
    }

    private func closeInputSurfaces() {
        hideKeyboard()
        isMessageFieldFocused = false
        prefersEmojiKeyboard = false
        withAnimation(AppMotion.quick) {
            isAttachmentPanelOpen = false
        }
    }

    private func handleExitSwipe(_ value: DragGesture.Value) {
        guard value.translation.width > 86,
              abs(value.translation.height) < 72 else { return }
        closeInputSurfaces()
        dismiss()
    }
}

final class EmojiUITextField: UITextField {
    var prefersEmojiKeyboard = false

    override var textInputMode: UITextInputMode? {
        if prefersEmojiKeyboard,
           let emojiMode = UITextInputMode.activeInputModes.first(where: { $0.primaryLanguage == "emoji" }) {
            return emojiMode
        }
        return super.textInputMode
    }
}

struct EmojiMessageTextField: UIViewRepresentable {
    @Binding var text: String
    @Binding var isFocused: Bool
    @Binding var prefersEmojiKeyboard: Bool
    let placeholder: String
    let onTap: () -> Void
    let onSubmit: () -> Void

    func makeUIView(context: Context) -> EmojiUITextField {
        let textField = EmojiUITextField()
        textField.delegate = context.coordinator
        textField.borderStyle = .none
        textField.backgroundColor = .clear
        textField.textColor = Theme.primaryTextUIColor
        textField.tintColor = UIColor(red: 1, green: 0.12, blue: 0.27, alpha: 1)
        textField.font = UIFont.systemFont(ofSize: 19, weight: .semibold)
        textField.returnKeyType = .send
        textField.attributedPlaceholder = NSAttributedString(
            string: placeholder,
            attributes: [.foregroundColor: UIColor.secondaryLabel]
        )
        textField.addTarget(context.coordinator, action: #selector(Coordinator.textDidChange(_:)), for: .editingChanged)
        let tapRecognizer = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.textFieldTapped(_:)))
        tapRecognizer.cancelsTouchesInView = false
        textField.addGestureRecognizer(tapRecognizer)
        return textField
    }

    func updateUIView(_ uiView: EmojiUITextField, context: Context) {
        context.coordinator.parent = self
        if uiView.text != text {
            uiView.text = text
        }
        let shouldReloadInputViews = uiView.prefersEmojiKeyboard != prefersEmojiKeyboard
        uiView.prefersEmojiKeyboard = prefersEmojiKeyboard
        if isFocused && !uiView.isFirstResponder {
            uiView.becomeFirstResponder()
        } else if !isFocused && uiView.isFirstResponder {
            uiView.resignFirstResponder()
        }
        if shouldReloadInputViews && uiView.isFirstResponder {
            uiView.reloadInputViews()
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: EmojiMessageTextField

        init(_ parent: EmojiMessageTextField) {
            self.parent = parent
        }

        @objc func textDidChange(_ textField: UITextField) {
            parent.text = textField.text ?? ""
        }

        @objc func textFieldTapped(_ recognizer: UITapGestureRecognizer) {
            parent.onTap()
            guard let textField = recognizer.view as? EmojiUITextField else { return }
            textField.prefersEmojiKeyboard = false
            if textField.isFirstResponder {
                textField.reloadInputViews()
            } else {
                textField.becomeFirstResponder()
            }
        }

        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            parent.onSubmit()
            return false
        }

        func textFieldDidBeginEditing(_ textField: UITextField) {
            parent.isFocused = true
        }

        func textFieldDidEndEditing(_ textField: UITextField) {
            parent.isFocused = false
        }
    }
}

struct ChatAttachmentPanel: View {
    let onSelect: (String) -> Void

    var body: some View {
        HStack(spacing: 28) {
            ChatAttachmentOption(title: "拍照", icon: "camera.fill") {
                onSelect("拍照")
            }
            ChatAttachmentOption(title: "相册", icon: "photo.on.rectangle") {
                onSelect("相册")
            }
            Spacer()
        }
        .padding(.horizontal, 28)
        .padding(.top, 26)
        .padding(.bottom, 34)
        .background(Theme.panel)
    }
}

struct ChatAttachmentOption: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 31, weight: .semibold))
                    .foregroundStyle(Theme.text)
                    .frame(width: 82, height: 82)
                    .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                Text(title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Theme.subtext)
            }
        }
        .buttonStyle(.plain)
    }
}

struct ChatBubble: View {
    @EnvironmentObject private var store: MockAppStore
    let message: DirectMessage

    var isMine: Bool { message.senderID == store.currentUserID }

    var body: some View {
        if let sharedPostID = message.sharedPostID,
           let post = store.post(id: sharedPostID) {
            HStack(alignment: .top, spacing: 10) {
                if isMine { Spacer(minLength: 34) }
                if !isMine {
                    AvatarView(user: store.user(id: message.senderID), size: 36)
                }
                NavigationLink(value: Route.postDetail(post.id)) {
                    SharedPostMessageCard(post: post)
                }
                .buttonStyle(.plain)
                if isMine {
                    AvatarView(user: store.currentUser, size: 36)
                } else {
                    Spacer(minLength: 34)
                }
            }
        } else if let sharedProfileUserID = message.sharedProfileUserID,
                  let user = store.users.first(where: { $0.id == sharedProfileUserID }) {
            HStack(alignment: .top, spacing: 10) {
                if isMine { Spacer(minLength: 34) }
                if !isMine {
                    AvatarView(user: store.user(id: message.senderID), size: 36)
                }
                NavigationLink(value: Route.userProfile(user.id)) {
                    SharedProfileMessageCard(user: user)
                }
                .buttonStyle(.plain)
                if isMine {
                    AvatarView(user: store.currentUser, size: 36)
                } else {
                    Spacer(minLength: 34)
                }
            }
        } else if let imageData = message.imageData {
            HStack(alignment: .bottom, spacing: 8) {
                if isMine { Spacer(minLength: 48) }
                if !isMine {
                    AvatarView(user: store.user(id: message.senderID), size: 34)
                }
                UploadedImageView(data: imageData)
                    .scaledToFill()
                    .frame(width: 184, height: 184)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(Theme.hairline, lineWidth: 0.5)
                    }
                if isMine {
                    AvatarView(user: store.currentUser, size: 34)
                } else {
                    Spacer(minLength: 48)
                }
            }
        } else {
            HStack(alignment: .bottom, spacing: 8) {
                if isMine { Spacer(minLength: 48) }
                if !isMine {
                    AvatarView(user: store.user(id: message.senderID), size: 34)
                }
                Text(message.body)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 11)
                    .background(isMine ? Theme.hotPink : Theme.panelRaised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                if isMine {
                    AvatarView(user: store.currentUser, size: 34)
                } else {
                    Spacer(minLength: 48)
                }
            }
        }
    }
}

struct SharedPostMessageCard: View {
    @EnvironmentObject private var store: MockAppStore
    let post: GroupBuyPost

    var body: some View {
        let author = store.user(id: post.authorID)
        VStack(alignment: .leading, spacing: 0) {
            PostImageView(post: post)
                .scaledToFill()
                .frame(width: 250, height: 250)
                .clipped()
                .overlay(alignment: .topTrailing) {
                    Image(systemName: "play.fill")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 46, height: 46)
                        .background(.black.opacity(0.28), in: Circle())
                        .padding(12)
                }
            VStack(alignment: .leading, spacing: 12) {
                Text(post.title)
                    .font(.system(size: 24, weight: .black))
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    AvatarView(user: author, size: 28)
                    Text(author.nickname)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Theme.subtext)
                        .lineLimit(1)
                }
            }
            .padding(16)
            .frame(width: 250, alignment: .leading)
            .background(Theme.panel)
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .stroke(Theme.hairline, lineWidth: 0.5)
        }
    }
}

struct SharedProfileMessageCard: View {
    @EnvironmentObject private var store: MockAppStore
    let user: User

    var body: some View {
        let noteCount = store.posts.filter { $0.authorID == user.id && $0.status == .active }.count
        VStack(spacing: 0) {
            UserBackgroundImage(user: user)
                .scaledToFill()
                .frame(width: 280, height: 126)
                .clipped()
                .overlay(.black.opacity(0.16))

            VStack(spacing: 10) {
                AvatarView(user: user, size: 72)
                    .background(Theme.panel, in: Circle())
                    .padding(.top, -42)

                Text(user.nickname)
                    .font(.system(size: 24, weight: .black))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)

                Text("制品 · \(noteCount)  |  粉丝 · \(store.followerUsers(for: user.id).count)")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Theme.subtext)

                Text(user.bio == "点击这里，填写简介" ? "这个人还没有填写简介" : user.bio)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.subtext)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity)

                Text("去看看")
                    .font(.system(size: 17, weight: .black))
                    .foregroundStyle(Theme.hotPink)
                    .padding(.horizontal, 26)
                    .padding(.vertical, 9)
                    .overlay {
                        Capsule().stroke(Theme.hotPink, lineWidth: 1)
                    }
                    .padding(.top, 4)
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 18)
            .frame(width: 280)
            .background(Theme.panel)
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .stroke(Theme.hairline, lineWidth: 0.5)
        }
    }
}

struct ProfileView: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var isMenuOpen = false
    @State private var selectedTab = "制品"
    @State private var isBioEditorPresented = false
    @State private var isShareSheetPresented = false
    @State private var bioDraft = ""

    let profileTabs = ["制品", "拼团合集", "收藏", "赞过"]

    var body: some View {
        Group {
            if store.isLoggedIn {
                profileContent
            } else {
                GuestAuthView()
            }
        }
        .navigationBarHidden(true)
    }

    @ViewBuilder private var profileContent: some View {
        let user = store.currentUser
        GeometryReader { rootProxy in
            let contentWidth = rootProxy.size.width
            let headerHeight: CGFloat = 342
            let windowTopInset = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first { $0.isKeyWindow }?
                .safeAreaInsets.top ?? 0
            let topInset = max(rootProxy.safeAreaInsets.top, windowTopInset)

            ZStack(alignment: .leading) {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 0) {
                        ZStack(alignment: .top) {
                            GeometryReader { headerProxy in
                                let pullDistance = max(headerProxy.frame(in: .named("profile-scroll")).minY, 0)

                                UserBackgroundImage(user: user)
                                    .scaledToFill()
                                    .frame(width: contentWidth, height: headerHeight + topInset + pullDistance)
                                    .clipped()
                                    .overlay(.black.opacity(0.52))
                                    .overlay(
                                        LinearGradient(colors: [.black.opacity(0.08), Theme.background.opacity(0.92)], startPoint: .top, endPoint: .bottom)
                                    )
                                    .offset(y: -topInset - pullDistance)
                                    .ignoresSafeArea(.container, edges: .top)
                            }
                            .frame(width: contentWidth, height: headerHeight)

                            VStack(alignment: .leading, spacing: 18) {
                                HStack {
                                    Button {
                                        withAnimation(.spring(response: 0.34, dampingFraction: 0.86)) {
                                            isMenuOpen = true
                                        }
                                    } label: {
                                        Image(systemName: "line.3.horizontal")
                                            .font(.system(size: 30, weight: .medium))
                                            .frame(width: 48, height: 48)
                                            .background(.black.opacity(0.28), in: Circle())
                                            .overlay {
                                                Circle().stroke(.white.opacity(0.18), lineWidth: 1)
                                            }
                                            .shadow(color: .black.opacity(0.32), radius: 8, x: 0, y: 3)
                                    }
                                    .buttonStyle(.plain)
                                    .foregroundStyle(.white)

                                    Spacer()

                                    NavigationLink(value: Route.editProfile) {
                                        Label("编辑主页", systemImage: "pencil")
                                            .font(.system(size: 16, weight: .bold))
                                            .foregroundStyle(.white)
                                            .padding(.horizontal, 15)
                                            .padding(.vertical, 9)
                                            .background(.black.opacity(0.32), in: Capsule())
                                            .overlay {
                                                Capsule().stroke(.white.opacity(0.18), lineWidth: 1)
                                            }
                                            .shadow(color: .black.opacity(0.28), radius: 8, x: 0, y: 3)
                                    }
                                    .buttonStyle(.plain)

                                    Button {
                                        isShareSheetPresented = true
                                    } label: {
                                        Image(systemName: "square.and.arrow.up")
                                            .font(.system(size: 27, weight: .semibold))
                                            .frame(width: 44, height: 44)
                                            .background(.black.opacity(0.28), in: Circle())
                                            .overlay {
                                                Circle().stroke(.white.opacity(0.18), lineWidth: 1)
                                            }
                                            .shadow(color: .black.opacity(0.32), radius: 8, x: 0, y: 3)
                                    }
                                    .buttonStyle(.plain)
                                    .foregroundStyle(.white)
                                }

                                Color.clear
                                    .frame(height: 8)

                                HStack(alignment: .center, spacing: 18) {
                                    AvatarView(user: user, size: 118)
                                        .background(.white, in: Circle())
                                    VStack(alignment: .leading, spacing: 8) {
                                        HStack(spacing: 8) {
                                            Text(user.nickname)
                                                .font(.system(size: 28, weight: .black))
                                                .foregroundStyle(Theme.text)
                                            Image(systemName: "chevron.down")
                                                .font(.system(size: 18, weight: .bold))
                                                .foregroundStyle(Theme.subtext)
                                        }
                                        HStack(spacing: 8) {
                                            Text("ID：\(store.registrationID(for: user.id))")
                                            Image(systemName: "qrcode.viewfinder")
                                        }
                                        .font(.system(size: 16, weight: .semibold))
                                        .foregroundStyle(Theme.subtext)
                                        Text("IP：\(user.region)")
                                            .font(.system(size: 16, weight: .semibold))
                                            .foregroundStyle(Theme.subtext)
                                    }
                                }

                                HStack(spacing: 26) {
                                    NavigationLink(value: Route.userRelations(user.id, .following)) {
                                        StatInline(value: "\(store.followingUsers(for: user.id).count)", title: "关注")
                                    }
                                    .buttonStyle(.plain)
                                    NavigationLink(value: Route.userRelations(user.id, .followers)) {
                                        StatInline(value: "\(store.followerUsers(for: user.id).count)", title: "粉丝")
                                    }
                                    .buttonStyle(.plain)
                                    StatInline(value: "\(store.likedPostIDs.count + store.favoritePostIDs.count)", title: "获赞与收藏")
                                }

                                Button {
                                    bioDraft = user.bio == "点击这里，填写简介" ? "" : user.bio
                                    isBioEditorPresented = true
                                } label: {
                                    Text(user.bio)
                                        .font(.system(size: 18, weight: .semibold))
                                        .foregroundStyle(Theme.text.opacity(0.86))
                                        .lineLimit(2)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .buttonStyle(.plain)
                            }
                            .padding(.horizontal, 16)
                            .padding(.top, 12)
                            .frame(width: contentWidth, height: headerHeight, alignment: .top)
                        }
                        .frame(width: contentWidth, height: headerHeight)

                        VStack(spacing: 0) {
                            HStack(spacing: 0) {
                                ForEach(profileTabs, id: \.self) { tab in
                                    Button {
                                        selectedTab = tab
                                    } label: {
                                        VStack(spacing: 8) {
                                            HStack(spacing: 6) {
                                                Text(tab)
                                                    .font(.system(size: tab == "拼团合集" ? 15 : 17, weight: selectedTab == tab ? .black : .semibold))
                                                    .lineLimit(1)
                                                    .minimumScaleFactor(0.76)
                                            }
                                            .foregroundStyle(selectedTab == tab ? Theme.text : Theme.subtext)
                                            Capsule()
                                                .fill(selectedTab == tab ? Theme.hotPink : Color.clear)
                                                .frame(width: 48, height: 4)
                                        }
                                        .frame(maxWidth: .infinity)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.top, 20)
                            .padding(.bottom, 12)
                            .background(Theme.panel)

                            Group {
                                if selectedTab == "制品" {
                                    ProfileNotesPanel(userID: user.id, canManage: true)
                                } else if selectedTab == "拼团合集" {
                                    ProfileCollectionsPanel(ownerID: user.id, canManage: true)
                                } else if selectedTab == "收藏" {
                                    ProfileFavoritePostsPanel(userID: user.id)
                                } else if selectedTab == "赞过" {
                                    ProfileLikedPostsPanel(userID: user.id)
                                } else {
                                    ProfileEmptyNotesView()
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 430, alignment: .top)
                        }
                        .background(Theme.background)
                        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 18, topTrailingRadius: 18, style: .continuous))
                        .offset(y: -2)
                        .frame(width: contentWidth)
                    }
                    .padding(.bottom, 88)
                    .frame(width: contentWidth)
                }
                .coordinateSpace(name: "profile-scroll")
                .background(Theme.background.ignoresSafeArea())

                if isMenuOpen {
                    Color.black.opacity(0.46)
                        .ignoresSafeArea()
                        .onTapGesture {
                            withAnimation(.spring(response: 0.34, dampingFraction: 0.86)) {
                                isMenuOpen = false
                            }
                        }

                    ProfileSideMenu(isMenuOpen: $isMenuOpen)
                        .transition(.move(edge: .leading))
                }
            }
        }
        .navigationBarHidden(true)
        .sheet(isPresented: $isShareSheetPresented) {
            ProfileShareSheetView(user: user)
                .presentationDetents([.height(440), .large])
                .presentationDragIndicator(.hidden)
        }
        .fullScreenCover(isPresented: $isBioEditorPresented) {
            ProfileBioEditorView(bio: $bioDraft) {
                store.updateCurrentBio(bioDraft)
                isBioEditorPresented = false
            }
        }
    }
}

struct ProfileBioEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var bio: String
    let onSave: () -> Void
    private let maxLength = 160
    private var canSave: Bool { !bio.trimmed.isEmpty }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("取消") {
                    dismiss()
                }
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(Theme.subtext)
                .frame(width: 86, height: 48, alignment: .leading)

                Spacer()

                Text("编辑简介")
                    .font(.system(size: 21, weight: .bold))
                    .foregroundStyle(Theme.text)

                Spacer()

                Button("保存") {
                    onSave()
                    dismiss()
                }
                .font(.system(size: 20, weight: canSave ? .bold : .medium))
                .foregroundStyle(canSave ? Theme.hotPink : Color(red: 0.45, green: 0.08, blue: 0.13))
                .frame(width: 86, height: 48, alignment: .trailing)
                .animation(.easeInOut(duration: 0.16), value: canSave)
            }
            .padding(.horizontal, 18)
            .padding(.top, 0)
            .padding(.bottom, 14)

            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Theme.panel)

                TextEditor(text: $bio)
                    .font(.system(size: 22, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .tint(Theme.hotPink)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 14)
                    .padding(.top, 10)
                    .padding(.bottom, 46)

                if bio.trimmed.isEmpty {
                    Text("填写简介")
                        .font(.system(size: 22, weight: .medium))
                        .foregroundStyle(Theme.subtext)
                        .padding(.leading, 14)
                        .padding(.top, 18)
                        .allowsHitTesting(false)
                }

                Text("\(bio.count)/\(maxLength)")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Theme.subtext)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                    .padding(.trailing, 14)
                    .padding(.bottom, 22)
            }
            .frame(height: 160)
            .padding(.horizontal, 18)

            Spacer()
        }
        .background(Theme.background.ignoresSafeArea())
        .onChange(of: bio) { _, newValue in
            if newValue.count > maxLength {
                bio = String(newValue.prefix(maxLength))
            }
        }
    }
}

struct StatInline: View {
    let value: String
    let title: String

    var body: some View {
        HStack(spacing: 6) {
            Text(value)
                .font(.system(size: 24, weight: .black))
                .foregroundStyle(Theme.text)
            Text(title)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.text.opacity(0.86))
        }
    }
}

struct UserRelationListView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    let userID: String
    let kind: UserRelationKind

    var relatedUsers: [User] {
        store.relationUsers(for: userID, kind: kind)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 26, weight: .medium))
                        .foregroundStyle(Theme.text)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 2) {
                    Text(kind.title)
                        .font(.system(size: 25, weight: .black))
                        .foregroundStyle(Theme.text)
                    Text("\(relatedUsers.count) 位用户")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.subtext)
                }
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)
            .padding(.bottom, 12)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Theme.hairline).frame(height: 0.5)
            }

            if relatedUsers.isEmpty {
                VStack(spacing: 16) {
                    Spacer()
                    Image(systemName: kind == .following ? "person.crop.circle.badge.plus" : "person.2")
                        .font(.system(size: 52, weight: .light))
                        .foregroundStyle(Theme.muted)
                    Text(kind.emptyText)
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(Theme.subtext)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 10) {
                        ForEach(relatedUsers) { user in
                            UserRelationRow(user: user)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 14)
                    .padding(.bottom, 28)
                }
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .toolbar(.hidden, for: .tabBar)
        .simultaneousGesture(
            DragGesture(minimumDistance: 30)
                .onEnded { value in
                    guard value.translation.width > 86,
                          abs(value.translation.height) < 72 else { return }
                    dismiss()
                }
        )
    }
}

struct UserRelationRow: View {
    @EnvironmentObject private var store: MockAppStore
    let user: User

    var body: some View {
        HStack(spacing: 12) {
            NavigationLink(value: Route.userProfile(user.id)) {
                HStack(spacing: 12) {
                    AvatarView(user: user, size: 52)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(user.nickname)
                            .font(.system(size: 17, weight: .black))
                            .foregroundStyle(Theme.text)
                            .lineLimit(1)
                        Text("ID：\(store.registrationID(for: user.id))")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Theme.hotPink.opacity(0.88))
                        Text(user.bio)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.subtext)
                            .lineLimit(1)
                    }
                }
            }
            .buttonStyle(.plain)

            Spacer(minLength: 8)

            if user.id != store.currentUserID {
                Button {
                    store.toggleFollow(userID: user.id)
                } label: {
                    Text(store.followedUserIDs.contains(user.id) ? "已关注" : "关注")
                        .font(.system(size: 14, weight: .black))
                        .foregroundStyle(store.followedUserIDs.contains(user.id) ? Theme.subtext : .white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(store.followedUserIDs.contains(user.id) ? Theme.panelRaised : Theme.hotPink, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Theme.hairline, lineWidth: 1)
        }
    }
}

struct ProfileEmptyNotesView: View {
    @EnvironmentObject private var store: MockAppStore

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "photo.on.rectangle.angled")
                .font(.system(size: 70, weight: .light))
                .foregroundStyle(Theme.muted)
            Text("你还没有发布过制品")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Theme.text.opacity(0.86))
            Button {
                store.showToast("请点击底部 + 去发布")
            } label: {
                Text("去发布")
                    .font(.system(size: 20, weight: .black))
                    .foregroundStyle(Theme.text)
                    .padding(.horizontal, 32)
                    .padding(.vertical, 12)
                    .overlay {
                        Capsule().stroke(Theme.subtext, lineWidth: 1)
                    }
            }
            .buttonStyle(.plain)
            Spacer()
        }
    }
}

struct ProfileNotesPanel: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var isManaging = false
    let userID: String
    var canManage = false

    var posts: [GroupBuyPost] {
        store.sortedFeedPosts(store.activePosts.filter { $0.authorID == userID })
    }

    var body: some View {
        if posts.isEmpty {
            ProfileEmptyNotesView()
        } else {
            VStack(spacing: 12) {
                if canManage {
                    HStack {
                        Text("我的帖子")
                            .font(.system(size: 18, weight: .black))
                            .foregroundStyle(Theme.text)
                        Spacer()
                        Button {
                            withAnimation(.spring(response: 0.24, dampingFraction: 0.86)) {
                                isManaging.toggle()
                            }
                        } label: {
                            Text(isManaging ? "完成" : "管理")
                                .font(.system(size: 14, weight: .black))
                                .foregroundStyle(isManaging ? Theme.text : Theme.hotPink)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(Theme.panelRaised, in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 14)
                }

                if isManaging {
                    VStack(spacing: 10) {
                        ForEach(posts) { post in
                            ProfilePostManageRow(post: post)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 28)
                } else {
                    WaterfallGrid(posts: posts)
                        .padding(.horizontal, 12)
                        .padding(.top, canManage ? 0 : 14)
                        .padding(.bottom, 28)
                }
            }
        }
    }
}

struct ProfilePostManageRow: View {
    @EnvironmentObject private var store: MockAppStore
    let post: GroupBuyPost

    var body: some View {
        HStack(spacing: 12) {
            PostImageView(post: post)
                .scaledToFill()
                .frame(width: 58, height: 58)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .saturation(post.isEnded ? 0 : 1)
                .opacity(post.isEnded ? 0.58 : 1)

            VStack(alignment: .leading, spacing: 6) {
                Text(post.title)
                    .font(.system(size: 15, weight: .black))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(post.isEnded ? "已结团 · 可保留记录或删除" : "\(post.groupType.rawValue) · \(post.deadline.shortDeadlineText)")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(post.isEnded ? Theme.muted : post.groupType.accent)
                    .lineLimit(1)
            }

            Spacer()

            Button {
                store.deleteOwnPost(postID: post.id)
            } label: {
                Image(systemName: "trash")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(Theme.hotPink)
                    .frame(width: 42, height: 42)
                    .background(Theme.hotPink.opacity(0.12), in: Circle())
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Theme.hairline, lineWidth: 1)
        }
        .saturation(post.isEnded ? 0 : 1)
        .opacity(post.isEnded ? 0.72 : 1)
    }
}

struct ProfileLikedPostsPanel: View {
    @EnvironmentObject private var store: MockAppStore
    let userID: String

    var posts: [GroupBuyPost] {
        guard userID == store.currentUserID else { return [] }
        return store.sortedFeedPosts(store.activePosts.filter { store.likedPostIDs.contains($0.id) })
    }

    var body: some View {
        if posts.isEmpty {
            ProfileEmptyState(text: "你还没有赞过", icon: "heart")
        } else {
            WaterfallGrid(posts: posts)
                .padding(.horizontal, 12)
                .padding(.top, 14)
                .padding(.bottom, 28)
        }
    }
}

struct ProfileFavoritePostsPanel: View {
    @EnvironmentObject private var store: MockAppStore
    let userID: String

    var posts: [GroupBuyPost] {
        guard userID == store.currentUserID else { return [] }
        return store.sortedFeedPosts(store.activePosts.filter { store.favoritePostIDs.contains($0.id) })
    }

    var body: some View {
        if posts.isEmpty {
            ProfileEmptyState(text: "你还没有收藏过", icon: "star")
        } else {
            WaterfallGrid(posts: posts)
                .padding(.horizontal, 12)
                .padding(.top, 14)
                .padding(.bottom, 28)
        }
    }
}

struct ProfileEmptyState: View {
    let text: String
    let icon: String

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: icon)
                .font(.system(size: 46, weight: .light))
                .foregroundStyle(Theme.muted)
            Text(text)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.subtext)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}

struct ProfileCollectionsPanel: View {
    @EnvironmentObject private var store: MockAppStore
    @State private var isCreatingCollection = false
    @State private var isManaging = false
    @State private var selectedCollectionIDs: Set<String> = []
    let ownerID: String
    let canManage: Bool

    var body: some View {
        let collections = store.collections(ownerID: ownerID)
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("拼团合集")
                        .font(.system(size: 20, weight: .black))
                        .foregroundStyle(Theme.text)
                    Text("同一拼团的宣传、进度和余量更新放在一起")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.subtext)
                }
                Spacer()
                if canManage {
                    HStack(spacing: 10) {
                        if !collections.isEmpty {
                            Button {
                                withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                                    isManaging.toggle()
                                    selectedCollectionIDs.removeAll()
                                }
                            } label: {
                                Text(isManaging ? "完成" : "管理")
                                    .font(.system(size: 13, weight: .black))
                                    .foregroundStyle(isManaging ? .white : Theme.text)
                                    .padding(.horizontal, 13)
                                    .frame(height: 36)
                                    .background(isManaging ? Theme.hotPink : Theme.panelRaised, in: Capsule())
                            }
                            .buttonStyle(.plain)
                        }

                        if !isManaging {
                            Button {
                                isCreatingCollection = true
                            } label: {
                                Image(systemName: "plus")
                                    .font(.system(size: 18, weight: .black))
                                    .foregroundStyle(.white)
                                    .frame(width: 38, height: 38)
                                    .background(Theme.hotPink, in: Circle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            if collections.isEmpty {
                Text(canManage ? "还没有合集，点右上角创建第一个拼团合集。" : "这个团长还没有公开拼团合集。")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            } else {
                VStack(spacing: 10) {
                    ForEach(collections) { collection in
                        CollectionCard(
                            collection: collection,
                            isManaging: canManage && isManaging,
                            isSelected: selectedCollectionIDs.contains(collection.id)
                        ) {
                            toggleCollectionSelection(collection.id)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .sheet(isPresented: $isCreatingCollection) {
            CreateCollectionSheet()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .safeAreaInset(edge: .bottom) {
            if canManage && isManaging {
                Button {
                    let ids = selectedCollectionIDs
                    store.deleteCollections(ids: ids)
                    selectedCollectionIDs.removeAll()
                    isManaging = false
                } label: {
                    Text(selectedCollectionIDs.isEmpty ? "选择要删除的合集" : "删除 \(selectedCollectionIDs.count) 个合集")
                        .font(.system(size: 16, weight: .black))
                        .foregroundStyle(selectedCollectionIDs.isEmpty ? Theme.muted : .white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(selectedCollectionIDs.isEmpty ? Theme.panelRaised : Theme.hotPink, in: Capsule())
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 8)
                }
                .disabled(selectedCollectionIDs.isEmpty)
                .buttonStyle(.plain)
                .background(.ultraThinMaterial)
            }
        }
    }

    private func toggleCollectionSelection(_ id: String) {
        if selectedCollectionIDs.contains(id) {
            selectedCollectionIDs.remove(id)
        } else {
            selectedCollectionIDs.insert(id)
        }
    }
}

struct CollectionCard: View {
    @EnvironmentObject private var store: MockAppStore
    let collection: GroupCollection
    var isManaging = false
    var isSelected = false
    var onToggle: (() -> Void)? = nil

    var body: some View {
        let visibleCount = collection.postIDs.compactMap(store.post).filter { $0.status == .active }.count
        let isEnded = collection.isEnded
        Group {
            if isManaging {
                Button {
                    onToggle?()
                } label: {
                    content(visibleCount: visibleCount, isEnded: isEnded)
                }
            } else {
                NavigationLink(value: Route.collectionDetail(collection.id)) {
                    content(visibleCount: visibleCount, isEnded: isEnded)
                }
            }
        }
        .buttonStyle(.plain)
        .saturation(isEnded ? 0 : 1)
        .opacity(isEnded ? 0.58 : 1)
    }

    private func content(visibleCount: Int, isEnded: Bool) -> some View {
        ZStack(alignment: .topTrailing) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label(collection.name, systemImage: "rectangle.stack.fill")
                        .font(.system(size: 17, weight: .black))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Spacer()
                    Text(isEnded ? "已结团" : "\(visibleCount)帖")
                        .font(.system(size: 12, weight: .black))
                        .foregroundStyle(isEnded ? Theme.muted : Theme.hotPink)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background((isEnded ? Theme.panelRaised : Theme.hotPink.opacity(0.13)), in: Capsule())
                }
                Text(collection.defaultNote)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.subtext)
                    .lineLimit(2)
                HStack {
                    Label(collection.deadline.shortDeadlineText, systemImage: "clock.fill")
                    Spacer()
                    Image(systemName: "chevron.right")
                }
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.muted)
            }
            .padding(14)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Theme.hairline, lineWidth: 1)
            }

            if isManaging {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(isSelected ? Theme.hotPink : Theme.muted)
                    .padding(12)
            }
        }
    }
}

struct CreateCollectionSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    var onCreated: ((String) -> Void)? = nil
    @State private var name = ""
    @State private var wechat = ""
    @State private var qq = ""
    @State private var groupInfo = ""
    @State private var deadline = Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date()
    @State private var note = ""

    var canCreate: Bool {
        !name.trimmed.isEmpty && (!wechat.trimmed.isEmpty || !qq.trimmed.isEmpty) && !note.trimmed.isEmpty
    }

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 14) {
                    HeaderTitle(title: "创建拼团合集", subtitle: "合集内帖子会自动共享联系方式、截团时间、拼团名称和默认说明")
                    PrototypeTextField(title: "合集名称", placeholder: "例如：2026冬兵生日团", text: $name, required: true)
                    HStack(spacing: 10) {
                        PrototypeTextField(title: "微信", placeholder: "至少填微信或 QQ", text: $wechat, required: qq.trimmed.isEmpty)
                        PrototypeTextField(title: "QQ", placeholder: "至少填微信或 QQ", text: $qq, required: wechat.trimmed.isEmpty)
                    }
                    PrototypeTextField(title: "群聊信息", placeholder: "群号 / 拉群说明", text: $groupInfo, required: false)
                    DatePicker("截团时间", selection: $deadline, displayedComponents: [.date, .hourAndMinute])
                        .datePickerStyle(.compact)
                        .foregroundStyle(Theme.text)
                        .padding(14)
                        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                    PrototypeTextEditor(title: "默认说明", placeholder: "合集内所有帖子共用的说明", text: $note, required: true)
                    Button {
                        if let collectionID = store.createCollection(name: name, wechat: wechat, qq: qq, groupInfo: groupInfo, deadline: deadline, defaultNote: note) {
                            onCreated?(collectionID)
                        }
                        dismiss()
                    } label: {
                        Text(canCreate ? "创建合集" : "补齐必填字段")
                            .font(.system(size: 17, weight: .bold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 15)
                            .background(canCreate ? Theme.hotPink : Theme.panelRaised, in: Capsule())
                            .foregroundStyle(canCreate ? .white : Theme.muted)
                    }
                    .buttonStyle(.plain)
                    .disabled(!canCreate)
                    .padding(.top, 8)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 28)
            }
            .background(Theme.background.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("关闭") { dismiss() }
                }
            }
        }
    }
}

struct CollectionDetailView: View {
    @EnvironmentObject private var store: MockAppStore
    let collectionID: String

    var body: some View {
        if let collection = store.collection(id: collectionID) {
            let posts = store.posts(in: collection.id)
            let canManage = collection.ownerID == store.currentUserID
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    HeaderTitle(title: collection.name, subtitle: "合集共享信息会自动继承到新发布帖子")
                    CollectionSharedInfoCard(collection: collection)
                        .padding(.horizontal, 16)
                    if canManage {
                        CollectionPostManager(collection: collection)
                            .padding(.horizontal, 16)
                    }
                    Text("合集内帖子")
                        .font(.system(size: 20, weight: .black))
                        .foregroundStyle(Theme.text)
                        .padding(.horizontal, 16)
                    if posts.isEmpty {
                        Text("还没有帖子加入这个合集。")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.muted)
                            .padding(16)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                            .padding(.horizontal, 16)
                    } else {
                        WaterfallGrid(posts: posts)
                            .padding(.horizontal, 12)
                    }
                }
                .padding(.bottom, 28)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(collection.name)
            .navigationBarTitleDisplayMode(.inline)
        } else {
            ContentUnavailableView("合集不存在", systemImage: "rectangle.stack.badge.minus")
                .background(Theme.background)
        }
    }
}

struct CollectionPostManager: View {
    @EnvironmentObject private var store: MockAppStore
    let collection: GroupCollection

    var manageablePosts: [GroupBuyPost] {
        store.sortedFeedPosts(store.activePosts.filter { $0.authorID == collection.ownerID })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("切换帖子所属合集")
                .font(.system(size: 16, weight: .black))
                .foregroundStyle(Theme.text)
            ForEach(manageablePosts) { post in
                let isIncluded = collection.postIDs.contains(post.id)
                HStack(spacing: 10) {
                    PostImageView(post: post)
                        .scaledToFill()
                        .frame(width: 52, height: 52)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    VStack(alignment: .leading, spacing: 5) {
                        Text(post.title)
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.text)
                            .lineLimit(1)
                        Text(post.groupType.rawValue)
                            .font(.system(size: 12, weight: .black))
                            .foregroundStyle(post.groupType.accent)
                    }
                    Spacer()
                    if isIncluded {
                        Text("当前合集")
                            .font(.system(size: 13, weight: .black))
                            .foregroundStyle(Theme.subtext)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(Theme.panelRaised, in: Capsule())
                    } else {
                        Button {
                            store.addPost(post.id, to: collection.id)
                        } label: {
                            Text("移入")
                                .font(.system(size: 13, weight: .black))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(Theme.hotPink, in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(14)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct CollectionSharedInfoCard: View {
    let collection: GroupCollection

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("合集共享信息", systemImage: "link.circle.fill")
                .font(.system(size: 17, weight: .black))
                .foregroundStyle(Theme.text)
            InfoRow(title: "拼团名称", value: collection.name)
            InfoRow(title: "截团时间", value: collection.deadline.fullDisplay)
            InfoRow(title: "微信 / QQ", value: "\(collection.contactWechat.isEmpty ? "未填" : collection.contactWechat) · \(collection.contactQQ.isEmpty ? "未填" : collection.contactQQ)")
            InfoRow(title: "群聊信息", value: collection.groupInfo.isEmpty ? "未填写" : collection.groupInfo)
            InfoRow(title: "默认说明", value: collection.defaultNote)
        }
        .padding(14)
        .background(Theme.panelRaised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .stroke(Theme.hairline, lineWidth: 1)
        }
    }
}

struct DraftsView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            SimpleTopBar(title: "我的草稿", trailing: nil) {
                dismiss()
            }
            VStack(spacing: 16) {
                Image(systemName: "tray")
                    .font(.system(size: 48, weight: .light))
                    .foregroundStyle(Theme.muted)
                Text("暂无草稿")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Theme.text)
                Text("未发布的团购帖会保存在这里")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.subtext)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .toolbar(.hidden, for: .tabBar)
    }
}

struct BrowsingHistoryView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var isManaging = false
    @State private var selectedIDs: Set<String> = []

    var posts: [GroupBuyPost] {
        store.browsingHistoryPosts()
    }

    var body: some View {
        VStack(spacing: 0) {
            SimpleTopBar(title: "浏览记录", trailing: isManaging ? "完成" : "管理", trailingIcon: isManaging ? "checkmark" : "line.3.horizontal") {
                dismiss()
            } trailingAction: {
                withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                    isManaging.toggle()
                    if !isManaging {
                        selectedIDs.removeAll()
                    }
                }
            }

            HStack {
                Spacer()
                VStack(spacing: 7) {
                    Text("制品")
                        .font(.system(size: 22, weight: .black))
                        .foregroundStyle(Theme.text)
                    Capsule()
                        .fill(Theme.hotPink)
                        .frame(width: 48, height: 4)
                }
                Spacer()
            }
            .padding(.top, 14)
            .padding(.bottom, 26)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 14) {
                    Text("昨天")
                        .font(.system(size: 24, weight: .black))
                        .foregroundStyle(Theme.text)
                        .padding(.horizontal, 16)
                    if posts.isEmpty {
                        Text("还没有最近浏览记录")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 80)
                    } else {
                        HistoryWaterfallGrid(posts: posts, isManaging: isManaging, selectedIDs: $selectedIDs)
                            .padding(.horizontal, 12)
                    }
                }
                .padding(.bottom, isManaging ? 96 : 30)
            }
        }
        .safeAreaInset(edge: .bottom) {
            if isManaging {
                Button {
                    store.removeBrowsingHistory(postIDs: selectedIDs)
                    selectedIDs.removeAll()
                    if posts.isEmpty {
                        isManaging = false
                    }
                } label: {
                    Text(selectedIDs.isEmpty ? "选择要删除的记录" : "删除 \(selectedIDs.count) 条记录")
                        .font(.system(size: 16, weight: .black))
                        .foregroundStyle(selectedIDs.isEmpty ? Theme.muted : .white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(selectedIDs.isEmpty ? Theme.panelRaised : Theme.hotPink, in: Capsule())
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 8)
                }
                .disabled(selectedIDs.isEmpty)
                .buttonStyle(.plain)
                .background(.ultraThinMaterial)
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .toolbar(.hidden, for: .tabBar)
    }
}

struct HistoryWaterfallGrid: View {
    let posts: [GroupBuyPost]
    let isManaging: Bool
    @Binding var selectedIDs: Set<String>

    private var columnWidth: CGFloat {
        FeedCardMetrics.columnWidth(screenWidth: UIScreen.main.bounds.width)
    }

    private var leftPosts: [GroupBuyPost] {
        posts.enumerated().filter { $0.offset.isMultiple(of: 2) }.map(\.element)
    }

    private var rightPosts: [GroupBuyPost] {
        posts.enumerated().filter { !$0.offset.isMultiple(of: 2) }.map(\.element)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            LazyVStack(spacing: 14) {
                ForEach(leftPosts) { post in
                    HistoryCard(post: post, cardWidth: columnWidth, isManaging: isManaging, isSelected: selectedIDs.contains(post.id)) {
                        toggle(post.id)
                    }
                }
            }
            LazyVStack(spacing: 14) {
                ForEach(rightPosts) { post in
                    HistoryCard(post: post, cardWidth: columnWidth, isManaging: isManaging, isSelected: selectedIDs.contains(post.id)) {
                        toggle(post.id)
                    }
                }
            }
        }
    }

    private func toggle(_ id: String) {
        if selectedIDs.contains(id) {
            selectedIDs.remove(id)
        } else {
            selectedIDs.insert(id)
        }
    }
}

struct HistoryCard: View {
    @EnvironmentObject private var store: MockAppStore
    let post: GroupBuyPost
    let cardWidth: CGFloat
    let isManaging: Bool
    let isSelected: Bool
    let toggleSelection: () -> Void

    var author: User {
        store.user(id: post.authorID)
    }

    var body: some View {
        Group {
            if isManaging {
                Button(action: toggleSelection) {
                    cardBody
                }
                .buttonStyle(.plain)
            } else {
                NavigationLink(value: Route.postDetail(post.id)) {
                    cardBody
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var cardBody: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topTrailing) {
                PostImageView(post: post)
                    .scaledToFill()
                    .frame(width: cardWidth, height: FeedCardMetrics.imageHeight(for: cardWidth))
                    .clipped()
                if isManaging {
                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 25, weight: .bold))
                        .foregroundStyle(isSelected ? Theme.hotPink : .white)
                        .shadow(radius: 4)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .padding(8)
                }
            }
            .frame(width: cardWidth, height: FeedCardMetrics.imageHeight(for: cardWidth))

            VStack(alignment: .leading, spacing: 10) {
                Text(post.title)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 7) {
                    AvatarView(user: author, size: 24)
                    Text(author.nickname)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.subtext)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Image(systemName: "heart")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                    Text(post.favoriteCount.formattedCount)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.subtext)
                }
            }
            .padding(10)
        }
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 3, style: .continuous))
        .frame(width: cardWidth)
    }
}

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore

    var body: some View {
        VStack(spacing: 0) {
            SimpleTopBar(title: "设置", trailing: nil) {
                dismiss()
            }

            ScrollView(showsIndicators: false) {
                VStack(spacing: 22) {
                    SettingsGroup {
                        NavigationLink(destination: AccountSecuritySettingsView()) {
                            SettingsRow(icon: "person.crop.circle", title: "账号与安全")
                        }
                        .buttonStyle(.plain)
                        Divider().overlay(Theme.hairline).padding(.leading, 58)
                        NavigationLink(destination: GeneralSettingsView()) {
                            SettingsRow(icon: "gearshape", title: "通用设置")
                        }
                        .buttonStyle(.plain)
                        Divider().overlay(Theme.hairline).padding(.leading, 58)
                        NavigationLink(destination: NotificationSettingsView()) {
                            SettingsRow(icon: "bell", title: "通知设置")
                        }
                        .buttonStyle(.plain)
                    }

                    SettingsGroup {
                        Button {
                            store.showToast("已打开切换账号占位")
                        } label: {
                            SettingsPlainActionRow(title: "切换账号")
                        }
                        .buttonStyle(.plain)
                        Divider().overlay(Theme.hairline).padding(.leading, 58)
                        Button {
                            store.logOut()
                            dismiss()
                        } label: {
                            SettingsPlainActionRow(title: "退出登录")
                        }
                        .buttonStyle(.plain)
                    }

                    SettingsLegalLinks()
                    .padding(.top, 14)
                    .padding(.bottom, 60)
                }
                .padding(.horizontal, 16)
                .padding(.top, 30)
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .toolbar(.hidden, for: .tabBar)
    }
}

struct AccountSecuritySettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore

    var body: some View {
        SettingsDetailScaffold(title: "账号与安全", dismiss: dismiss) {
            SettingsDetailGroup {
                SettingsValueRow(title: "邮箱", value: store.currentUser.email.isEmpty ? "未绑定" : "已绑定")
                SettingsSeparator()
                SettingsValueRow(title: "密码登录", value: store.isBackendEnabled ? "已启用" : "已设置")
                SettingsSeparator()
                SettingsValueRow(title: "邮箱验证码", value: store.isBackendEnabled ? "可用" : "本地模式不可用")
            }

            SettingsDetailGroup {
                SettingsValueRow(title: "Apple", value: "未绑定")
                SettingsSeparator()
                SettingsValueRow(title: "微信", value: "待配置")
                SettingsSeparator()
                SettingsValueRow(title: "删除账号", value: "待接入")
            }
        }
    }
}

struct GeneralSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var browsingHistoryEnabled = true

    var body: some View {
        SettingsDetailScaffold(title: "通用设置", dismiss: dismiss) {
            Text("显示")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)

            SettingsDetailGroup {
                SettingsToggleRow(title: "深色模式", isOn: $store.isDarkModeEnabled)
            }

            Text("功能")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)

            SettingsDetailGroup {
                SettingsToggleRow(title: "浏览记录", subtitle: "关闭后，不再记录并删除历史浏览记录", isOn: $browsingHistoryEnabled)
                    .onChange(of: browsingHistoryEnabled) {
                        if !browsingHistoryEnabled {
                            store.removeBrowsingHistory(postIDs: Set(store.browsingHistoryIDs))
                        }
                    }
                SettingsSeparator()
                SettingsToggleRow(title: "未关注回复前最多两条私信", subtitle: "开启后，对方未关注你时，对方回复之前只能连续发送两条消息", isOn: $store.limitsUnrepliedMessages)
                #if DEBUG
                SettingsSeparator()
                SettingsToggleRow(title: "阿里云后端测试", subtitle: "开启后使用 ECS + RDS + OSS 测试接口", isOn: $store.isBackendEnabled)
                    .onChange(of: store.isBackendEnabled) {
                        store.backendModeChanged()
                    }
                #endif
            }
        }
    }
}

struct NotificationSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var receiveMessages = false
    @State private var likesAndFavorites = true
    @State private var newFollowers = true
    @State private var shares = true
    @State private var privateMessageMode = "接收"

    var body: some View {
        SettingsDetailScaffold(title: "通知设置", dismiss: dismiss) {
            SettingsDetailGroup {
                SettingsToggleRow(title: "接收消息通知", isOn: $receiveMessages)
            }

            Text("互动通知")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)

            SettingsDetailGroup {
                SettingsToggleRow(title: "赞和收藏", isOn: $likesAndFavorites)
                SettingsSeparator()
                SettingsToggleRow(title: "新增关注", isOn: $newFollowers)
                SettingsSeparator()
                SettingsToggleRow(title: "分享", isOn: $shares)
            }

            Text("私信通知")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)

            SettingsDetailGroup {
                Button {
                    privateMessageMode = privateMessageMode == "接收" ? "不接收" : "接收"
                } label: {
                    SettingsValueRow(title: "私信", value: privateMessageMode)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct SettingsDetailScaffold<Content: View>: View {
    let title: String
    let dismiss: DismissAction
    let content: Content

    init(title: String, dismiss: DismissAction, @ViewBuilder content: () -> Content) {
        self.title = title
        self.dismiss = dismiss
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            SimpleTopBar(title: title, trailing: nil) {
                dismiss()
            }

            ScrollView(showsIndicators: false) {
                VStack(spacing: 24) {
                    content
                }
                .padding(.horizontal, 16)
                .padding(.top, 30)
                .padding(.bottom, 60)
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .toolbar(.hidden, for: .tabBar)
    }
}

struct SettingsDetailGroup<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct SettingsValueRow: View {
    let title: String
    let value: String
    var subtitle: String? = nil

    var body: some View {
        HStack(alignment: subtitle == nil ? .center : .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(Theme.text.opacity(0.92))
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 12)
            Text(value)
                .font(.system(size: 22, weight: .regular))
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
            Image(systemName: "chevron.right")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: subtitle == nil ? 72 : 90)
        .contentShape(Rectangle())
    }
}

struct SettingsToggleRow: View {
    let title: String
    var subtitle: String? = nil
    @Binding var isOn: Bool

    var body: some View {
        HStack(alignment: subtitle == nil ? .center : .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(Theme.text.opacity(0.92))
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 12)
            Toggle("", isOn: $isOn)
                .labelsHidden()
                .tint(Theme.hotPink)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: subtitle == nil ? 72 : 96)
    }
}

struct SettingsSeparator: View {
    var body: some View {
        Divider()
            .overlay(Theme.hairline)
            .padding(.leading, 16)
    }
}

struct SettingsGroup<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        .padding(.vertical, 4)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct SettingsRow: View {
    let icon: String
    let title: String

    var body: some View {
        HStack(spacing: 18) {
            Image(systemName: icon)
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(Theme.text.opacity(0.88))
                .frame(width: 40, height: 56)
            Text(title)
                .font(.system(size: 20, weight: .regular))
                .foregroundStyle(Theme.text.opacity(0.9))
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}

struct SettingsPlainActionRow: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.system(size: 20, weight: .regular))
            .foregroundStyle(Theme.text.opacity(0.92))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
    }
}

struct SimpleTopBar: View {
    let title: String
    let trailing: String?
    var trailingIcon: String? = nil
    let backAction: () -> Void
    var trailingAction: (() -> Void)? = nil

    var body: some View {
        HStack {
            Button(action: backAction) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 27, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .frame(width: 44, height: 50)
            }
            .buttonStyle(.plain)

            Spacer()
            Text(title)
                .font(.system(size: 22, weight: .black))
                .foregroundStyle(Theme.text)
            Spacer()

            if let trailing, let trailingAction {
                Button(action: trailingAction) {
                    HStack(spacing: 6) {
                        if let trailingIcon {
                            Image(systemName: trailingIcon)
                                .font(.system(size: 16, weight: .bold))
                        }
                        Text(trailing)
                            .font(.system(size: 16, weight: .black))
                    }
                    .foregroundStyle(Theme.text)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 9)
                    .overlay {
                        Capsule().stroke(Theme.subtext, lineWidth: 1)
                    }
                }
                .buttonStyle(.plain)
            } else {
                Color.clear.frame(width: 78, height: 44)
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 8)
    }
}

struct ProfileSideMenu: View {
    @EnvironmentObject private var store: MockAppStore
    @Binding var isMenuOpen: Bool

    var body: some View {
        VStack(spacing: 18) {
            VStack(spacing: 6) {
                NavigationLink(value: Route.drafts) {
                    DrawerRowContent(icon: "tray", title: "我的草稿")
                }
                .simultaneousGesture(TapGesture().onEnded(closeMenuAfterNavigation))
                .buttonStyle(.plain)

                NavigationLink(value: Route.browsingHistory) {
                    DrawerRowContent(icon: "clock.arrow.circlepath", title: "浏览记录")
                }
                .simultaneousGesture(TapGesture().onEnded(closeMenuAfterNavigation))
                .buttonStyle(.plain)

                NavigationLink(value: Route.settings) {
                    DrawerRowContent(icon: "gearshape", title: "设置")
                }
                .simultaneousGesture(TapGesture().onEnded(closeMenuAfterNavigation))
                .buttonStyle(.plain)
            }
            .padding(.vertical, 12)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

            VStack(spacing: 6) {
                Button {
                    store.logOut()
                    closeMenu()
                } label: {
                    DrawerRowContent(icon: "rectangle.portrait.and.arrow.right", title: "退出登录")
                }
                .buttonStyle(.plain)
            }
            .padding(.vertical, 12)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

            Spacer()
        }
        .padding(.horizontal, 18)
        .padding(.top, 112)
        .frame(width: 330)
        .frame(maxHeight: .infinity)
        .background(Theme.background.ignoresSafeArea())
    }

    private func closeMenu() {
        withAnimation(.spring(response: 0.34, dampingFraction: 0.86)) {
            isMenuOpen = false
        }
    }

    private func closeMenuAfterNavigation() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            closeMenu()
        }
    }
}

struct DrawerRow: View {
    let icon: String
    let title: String
    var badge: String? = nil

    var body: some View {
        DrawerRowContent(icon: icon, title: title, badge: badge)
    }
}

struct DrawerRowContent: View {
    let icon: String
    let title: String
    var badge: String? = nil

    var body: some View {
        HStack(spacing: 18) {
            Image(systemName: icon)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Theme.text)
                .frame(width: 40, height: 40)
            Text(title)
                .font(.system(size: 19, weight: .bold))
                .foregroundStyle(Theme.text)
            Spacer()
            if let badge {
                Text(badge)
                    .font(.system(size: 13, weight: .black))
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .background(Theme.hotPink, in: Circle())
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
    }
}

struct DrawerBottomButton: View {
    let icon: String
    let title: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 25, weight: .semibold))
                .foregroundStyle(Theme.subtext)
                .frame(width: 62, height: 62)
                .background(Theme.panelRaised, in: Circle())
            Text(title)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(Theme.muted)
        }
    }
}

struct EditProfileView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var didLoad = false
    @State private var nickname = ""
    @State private var redBookID = ""
    @State private var bio = ""
    @State private var gender = ""
    @State private var birthday = ""
    @State private var region = ""
    @State private var avatarSymbol = ""
    @State private var avatarTint: ColorToken = .amber
    @State private var backgroundImageName = "merch_magazine"
    @State private var avatarImageData: Data?
    @State private var backgroundImageData: Data?
    @State private var avatarPickerItem: PhotosPickerItem?
    @State private var backgroundPickerItem: PhotosPickerItem?

    let tintChoices: [ColorToken] = [.amber, .rose, .violet, .teal, .blue]

    var body: some View {
        let currentUser = store.currentUser
        let canEditNickname = store.canChangeNickname(for: currentUser) || nickname.trimmed == currentUser.nickname
        let previewUser = User(
            id: store.currentUserID,
            nickname: nickname.isEmpty ? currentUser.nickname : nickname,
            bio: bio.isEmpty ? currentUser.bio : bio,
            followingCount: currentUser.followingCount,
            followersCount: currentUser.followersCount,
            postCount: currentUser.postCount,
            isRestricted: false,
            canShowContact: true,
            avatarSymbol: avatarSymbol.isEmpty ? currentUser.avatarSymbol : avatarSymbol,
            avatarTint: avatarTint,
            redBookID: redBookID,
            gender: gender,
            birthday: birthday,
            region: region,
            backgroundImageName: backgroundImageName,
            avatarImageData: avatarImageData,
            backgroundImageData: backgroundImageData,
            avatarURL: currentUser.avatarURL,
            backgroundURL: currentUser.backgroundURL,
            lastNicknameChangedAt: currentUser.lastNicknameChangedAt
        )

        VStack(spacing: 0) {
            HStack {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(Color.black.opacity(0.82))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                Spacer()
                Text("编辑资料")
                    .font(.system(size: 24, weight: .black))
                    .foregroundStyle(Color.black.opacity(0.82))
                Spacer()
                Button("预览") {
                    store.showToast("下方已实时预览")
                }
                .font(.system(size: 19, weight: .black))
                .foregroundStyle(Color.black.opacity(0.82))
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 28)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 28) {
                    VStack(spacing: 14) {
                        PhotosPicker(selection: $avatarPickerItem, matching: .images) {
                            ZStack(alignment: .bottomTrailing) {
                                AvatarView(user: previewUser, size: 126)
                                    .background(.white, in: Circle())
                                Image(systemName: "camera.fill")
                                    .font(.system(size: 20, weight: .bold))
                                    .foregroundStyle(.white)
                                    .frame(width: 38, height: 38)
                                    .background(Color.black.opacity(0.72), in: Circle())
                                    .overlay {
                                        Circle().stroke(.white, lineWidth: 3)
                                    }
                            }
                        }
                        .buttonStyle(.plain)

                        HStack(spacing: 10) {
                            TextField("头像字", text: $avatarSymbol)
                                .font(.system(size: 18, weight: .bold))
                                .foregroundStyle(Color.black.opacity(0.82))
                                .multilineTextAlignment(.center)
                                .frame(width: 86)
                                .padding(.vertical, 9)
                                .background(.white, in: Capsule())
                            ForEach(tintChoices, id: \.self) { tint in
                                Button {
                                    avatarTint = tint
                                } label: {
                                    Circle()
                                        .fill(tint.gradient)
                                        .frame(width: 30, height: 30)
                                        .overlay {
                                            Circle().stroke(avatarTint == tint ? Color.black.opacity(0.82) : Color.clear, lineWidth: 2)
                                        }
                                }
                                .buttonStyle(.plain)
                            }
                        }

                        Text("点击头像可从相册上传")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color.black.opacity(0.42))
                    }

                    VStack(spacing: 0) {
                        ProfileEditField(title: "名字", placeholder: "填写名字", text: $nickname, textColor: .primary, isEditable: canEditNickname)
                        Text(nicknameHint)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color.black.opacity(0.42))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16)
                            .padding(.bottom, 14)
                        ProfileReadOnlyInfoRow(title: "ID", value: store.registrationID(for: currentUser.id))
                        PhotosPicker(selection: $backgroundPickerItem, matching: .images) {
                            HStack(spacing: 18) {
                                Text("背景图")
                                    .font(.system(size: 21, weight: .semibold))
                                    .foregroundStyle(Color.black.opacity(0.45))
                                    .frame(width: 112, alignment: .leading)

                                ProfileBackgroundPreview(imageData: backgroundImageData, fallbackName: backgroundImageName)

                                Text("从相册选择")
                                    .font(.system(size: 18, weight: .semibold))
                                    .foregroundStyle(Color.black.opacity(0.72))

                                Spacer()

                                Image(systemName: "chevron.right")
                                    .font(.system(size: 19, weight: .bold))
                                    .foregroundStyle(Color.black.opacity(0.18))
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 18)
                        }
                        .buttonStyle(.plain)

                        if backgroundImageData != nil {
                            Button {
                                backgroundImageData = nil
                            } label: {
                                HStack {
                                    Text("恢复默认背景图")
                                        .font(.system(size: 16, weight: .bold))
                                        .foregroundStyle(Theme.hotPink)
                                    Spacer()
                                }
                                .padding(.horizontal, 146)
                                .padding(.bottom, 16)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .background(.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .padding(.horizontal, 16)

                    VStack(spacing: 0) {
                        ProfileEditField(title: "简介", placeholder: "介绍一下自己", text: $bio, textColor: Color.black.opacity(0.42))
                    }
                    .background(.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .padding(.horizontal, 16)

                    VStack(spacing: 0) {
                        ProfileEditField(title: "性别", placeholder: "编辑性别", text: $gender, textColor: Color.black.opacity(0.42))
                        ProfileEditField(title: "生日", placeholder: "选择生日", text: $birthday, textColor: Color.black.opacity(0.42))
                        ProfileEditField(title: "地区", placeholder: "选择所在的地区", text: $region, textColor: Color.black.opacity(0.42))
                    }
                    .background(.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .padding(.horizontal, 16)

                    Button {
                        saveProfile(shouldDismiss: true)
                    } label: {
                        Text("保存资料")
                            .font(.system(size: 20, weight: .black))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(Theme.hotPink, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 30)
                }
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Color(red: 0.95, green: 0.95, blue: 0.95).ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .toolbar(.hidden, for: .tabBar)
        .onAppear(perform: loadProfile)
        .onChange(of: avatarPickerItem) { _, item in
            loadImage(from: item) { data in
                avatarImageData = data
            }
        }
        .onChange(of: backgroundPickerItem) { _, item in
            loadImage(from: item) { data in
                backgroundImageData = data
            }
        }
    }

    private var nicknameHint: String {
        let user = store.currentUser
        guard let nextDate = store.nextNicknameChangeDate(for: user),
              !store.canChangeNickname(for: user) else {
            return "名字四个月只能修改一次"
        }
        return "名字四个月只能修改一次，下次可在 \(nextDate.shortDateOnlyText) 修改"
    }

    private func loadProfile() {
        guard !didLoad else { return }
        let user = store.currentUser
        nickname = user.nickname
        redBookID = user.redBookID
        bio = user.bio
        gender = user.gender
        birthday = user.birthday
        region = user.region
        avatarSymbol = user.avatarSymbol
        avatarTint = user.avatarTint
        backgroundImageName = user.backgroundImageName
        avatarImageData = user.avatarImageData
        backgroundImageData = user.backgroundImageData
        didLoad = true
    }

    private func saveProfile(shouldDismiss: Bool) {
        store.updateCurrentProfile(
            nickname: nickname,
            redBookID: redBookID,
            bio: bio,
            gender: gender,
            birthday: birthday,
            region: region,
            avatarSymbol: avatarSymbol,
            avatarTint: avatarTint,
            backgroundImageName: backgroundImageName,
            avatarImageData: avatarImageData,
            backgroundImageData: backgroundImageData
        )
        if shouldDismiss {
            dismiss()
        }
    }

    private func loadImage(from item: PhotosPickerItem?, assign: @escaping (Data?) -> Void) {
        guard let item else { return }
        Task {
            if let data = try? await item.loadTransferable(type: Data.self) {
                let normalizedData = ImageDataNormalizer.jpegData(from: data, maxSide: 1800, compressionQuality: 0.8)
                await MainActor.run {
                    assign(normalizedData)
                }
            }
        }
    }
}

struct ProfileBackgroundPreview: View {
    let imageData: Data?
    let fallbackName: String

    var body: some View {
        Group {
            if let imageData,
               let image = UIImage(data: imageData) {
                Image(uiImage: image)
                    .resizable()
            } else {
                BundleImage(name: fallbackName)
            }
        }
        .scaledToFill()
        .frame(width: 78, height: 54)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.black.opacity(0.08), lineWidth: 1)
        }
    }
}

struct ProfileEditField: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    let textColor: Color
    var isEditable = true

    var body: some View {
        HStack(spacing: 18) {
            Text(title)
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(Color.black.opacity(0.45))
                .frame(width: 112, alignment: .leading)
            TextField(placeholder, text: $text)
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(text.isEmpty ? Color.black.opacity(0.32) : Color.black.opacity(0.82))
                .tint(Theme.hotPink)
                .disabled(!isEditable)
                .opacity(isEditable ? 1 : 0.52)
            Image(systemName: "chevron.right")
                .font(.system(size: 19, weight: .bold))
                .foregroundStyle(Color.black.opacity(0.18))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 20)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Color.black.opacity(0.08))
                .frame(height: 0.5)
                .padding(.leading, 146)
        }
    }
}

struct ProfileReadOnlyInfoRow: View {
    let title: String
    let value: String

    var body: some View {
        HStack(spacing: 18) {
            Text(title)
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(Color.black.opacity(0.45))
                .frame(width: 112, alignment: .leading)
            Text(value)
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(Color.black.opacity(0.82))
            Spacer()
            Image(systemName: "lock.fill")
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(Color.black.opacity(0.22))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 20)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Color.black.opacity(0.08))
                .frame(height: 0.5)
                .padding(.leading, 146)
        }
    }
}

struct FavoritesView: View {
    @EnvironmentObject private var store: MockAppStore

    var favoritePosts: [GroupBuyPost] {
        store.sortedFeedPosts(store.activePosts.filter { store.favoritePostIDs.contains($0.id) })
    }

    var body: some View {
        ScrollView {
            WaterfallGrid(posts: favoritePosts)
                .padding(12)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("我的收藏")
    }
}

struct ReminderCenterView: View {
    @EnvironmentObject private var store: MockAppStore

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                ForEach(store.currentUserReminders) { reminder in
                    if let post = store.post(id: reminder.postID) {
                        NavigationLink(value: Route.postDetail(post.id)) {
                            ReminderLargeCard(post: post, reminder: reminder)
                        }
                        .buttonStyle(.plain)
                    }
                }
                if store.currentUserReminders.isEmpty {
                    ProfileEmptyState(text: "暂无截团提醒", icon: "bell")
                        .frame(height: 360)
                }
            }
            .padding(16)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("截团提醒")
    }
}

struct AdminReportView: View {
    @EnvironmentObject private var store: MockAppStore

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 18) {
                HeaderTitle(title: "管理后台", subtitle: "自由发布 + 后审治理，处理虚假、过期、诈骗和无效联系方式")
                HStack(spacing: 10) {
                    AdminMetric(title: "待处理", value: "\(store.reports.filter { $0.status == .pending }.count)")
                    AdminMetric(title: "被举报内容", value: "\(store.posts.filter { $0.reportCount > 0 }.count)")
                    AdminMetric(title: "已下架", value: "\(store.posts.filter { $0.status == .removed }.count)")
                }
                .padding(.horizontal, 16)

                VStack(spacing: 12) {
                    ForEach(store.reports) { report in
                        AdminReportCard(report: report)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 28)
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct AdminReportCard: View {
    @EnvironmentObject private var store: MockAppStore
    let report: Report

    var post: GroupBuyPost? {
        if case .post(let id) = report.target {
            return store.post(id: id)
        }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(report.reason)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Theme.text)
                Spacer()
                Text(report.status.rawValue)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(report.status == .pending ? Theme.hotPink : Theme.subtext)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background((report.status == .pending ? Theme.hotPink : Color.white).opacity(0.12), in: Capsule())
            }
            Text(report.detail)
                .font(.system(size: 14))
                .foregroundStyle(Theme.subtext)
            if let post {
                NavigationLink(value: Route.postDetail(post.id)) {
                    HStack(spacing: 10) {
                        PostImageView(post: post)
                            .scaledToFill()
                            .frame(width: 70, height: 70)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        VStack(alignment: .leading, spacing: 5) {
                            Text(post.title)
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(Theme.text)
                                .lineLimit(2)
                            Text("状态：\(post.status.rawValue) · 举报 \(post.reportCount)")
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.muted)
                        }
                        Spacer()
                    }
                }
                .buttonStyle(.plain)
            }
            if report.status == .pending {
                HStack(spacing: 8) {
                    AdminActionButton(title: "忽略") { store.handleReport(reportID: report.id, status: .ignored) }
                    AdminActionButton(title: "隐藏") { store.handleReport(reportID: report.id, status: .hidden) }
                    AdminActionButton(title: "下架") { store.handleReport(reportID: report.id, status: .removed) }
                    AdminActionButton(title: "警告") { store.handleReport(reportID: report.id, status: .warned) }
                }
            }
        }
        .padding(16)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
    }
}

struct TagContentView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var sort = "最热"
    let tag: String

    var posts: [GroupBuyPost] {
        let tagged = store.posts(tagged: tag)
        switch sort {
        case "最新":
            return store.sortedFeedPosts(tagged)
        default:
            return tagged.sorted { lhs, rhs in
                if lhs.isEnded != rhs.isEnded {
                    return !lhs.isEnded
                }
                return lhs.likedCount > rhs.likedCount
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    HStack(spacing: 8) {
                        Button {
                            dismiss()
                        } label: {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 27, weight: .medium))
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.text)

                        Text("# \(tag)")
                            .font(.system(size: 23, weight: .black))
                            .foregroundStyle(Theme.text)
                            .lineLimit(1)

                        Spacer()

                        NavigationLink(value: Route.search) {
                            Image(systemName: "magnifyingglass")
                                .font(.system(size: 27, weight: .medium))
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.text)

                        Button {
                            if store.requireLogin(prompt: "登录后才能分享") {
                                store.showToast("已打开标签分享占位")
                            }
                        } label: {
                            Image(systemName: "square.and.arrow.up")
                                .font(.system(size: 27, weight: .medium))
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.text)
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 12)
                    .padding(.bottom, 8)
                    .background(Theme.background)

                    HStack(spacing: 38) {
                        ForEach(["最热", "最新"], id: \.self) { item in
                            Button {
                                sort = item
                            } label: {
                                VStack(spacing: 8) {
                                    Text(item)
                                        .font(.system(size: 22, weight: sort == item ? .black : .semibold))
                                        .foregroundStyle(sort == item ? Theme.text : Theme.subtext)
                                    Capsule()
                                        .fill(sort == item ? Theme.hotPink : Color.clear)
                                        .frame(width: 42, height: 4)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                        Spacer()
                        Button {
                            store.showToast("筛选功能占位")
                        } label: {
                            HStack(spacing: 8) {
                                Text("筛选")
                                    .font(.system(size: 21, weight: .semibold))
                                Image(systemName: "line.3.horizontal.decrease")
                                    .font(.system(size: 19, weight: .semibold))
                            }
                            .foregroundStyle(Theme.subtext)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 18)
                    .padding(.bottom, 14)

                    WaterfallGrid(posts: posts.isEmpty ? store.sortedFeedPosts(store.activePosts) : posts)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 28)
                }
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .toolbar(.hidden, for: .tabBar)
    }
}

struct UserProfileView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: MockAppStore
    @State private var chatThreadID: String?
    @State private var isChatPresented = false
    @State private var selectedTab = "制品"
    let userID: String

    private let tabs = ["制品", "拼团合集"]

    var userPosts: [GroupBuyPost] {
        store.sortedFeedPosts(store.activePosts.filter { $0.authorID == userID })
    }

    var body: some View {
        let user = store.user(id: userID)
        GeometryReader { proxy in
            let width = proxy.size.width
            let headerHeight: CGFloat = 486
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    ZStack(alignment: .top) {
                        UserBackgroundImage(user: user)
                            .scaledToFill()
                            .frame(width: width, height: headerHeight)
                            .clipped()
                            .overlay(.black.opacity(0.52))
                            .overlay(
                                LinearGradient(
                                    colors: [.black.opacity(0.04), .black.opacity(0.28), Theme.background.opacity(0.82)],
                                    startPoint: .top,
                                    endPoint: .bottom
                                )
                            )

                        VStack(alignment: .leading, spacing: 20) {
                            HStack {
                                Button {
                                    dismiss()
                                } label: {
                                    Image(systemName: "chevron.left")
                                        .font(.system(size: 31, weight: .medium))
                                        .foregroundStyle(.white)
                                        .frame(width: 48, height: 48)
                                        .background(.black.opacity(0.22), in: Circle())
                                }
                                .buttonStyle(.plain)

                                Spacer()
                            }

                            Spacer(minLength: 20)

                            HStack(alignment: .center, spacing: 18) {
                                AvatarView(user: user, size: 108)
                                    .background(.white.opacity(0.92), in: Circle())
                                    .overlay {
                                        Circle().stroke(.white.opacity(0.72), lineWidth: 1)
                                    }
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(user.nickname)
                                        .font(.system(size: 31, weight: .black))
                                        .foregroundStyle(.white)
                                        .lineLimit(1)
                                    HStack(spacing: 8) {
                                        Text("小红书号：\(store.registrationID(for: user.id))")
                                        Image(systemName: "doc.on.doc")
                                    }
                                    .font(.system(size: 17, weight: .bold))
                                    .foregroundStyle(.white.opacity(0.68))
                                }
                            }

                            HStack(spacing: 26) {
                                NavigationLink(value: Route.userRelations(user.id, .following)) {
                                    StatInline(value: "\(store.followingUsers(for: user.id).count)", title: "关注")
                                }
                                .buttonStyle(.plain)
                                NavigationLink(value: Route.userRelations(user.id, .followers)) {
                                    StatInline(value: "\(store.followerUsers(for: user.id).count)", title: "粉丝")
                                }
                                .buttonStyle(.plain)
                                StatInline(value: "\(userPosts.reduce(0) { $0 + $1.likedCount + $1.favoriteCount })", title: "获赞与收藏")
                            }

                            Text(user.bio == "点击这里，填写简介" ? "这个人还没有填写简介" : user.bio)
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.9))
                                .lineSpacing(6)
                                .lineLimit(4)

                            HStack(spacing: 12) {
                                Button {
                                    store.toggleFollow(userID: user.id)
                                } label: {
                                    Text(user.id == store.currentUserID ? "自己的主页" : (store.followedUserIDs.contains(user.id) ? "已关注" : "关注"))
                                        .font(.system(size: 20, weight: .black))
                                        .foregroundStyle(.white)
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 15)
                                        .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                }
                                .buttonStyle(.plain)
                                .disabled(user.id == store.currentUserID)

                                Button {
                                    openChat(with: user)
                                } label: {
                                    Text("发私信")
                                        .font(.system(size: 20, weight: .black))
                                        .foregroundStyle(.white)
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 15)
                                        .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                }
                                .buttonStyle(.plain)
                                .disabled(user.id == store.currentUserID)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                        .padding(.bottom, 24)
                        .frame(width: width, height: headerHeight, alignment: .top)
                    }

                    VStack(spacing: 0) {
                        HStack(spacing: 0) {
                            ForEach(tabs, id: \.self) { tab in
                                Button {
                                    withAnimation(AppMotion.quick) {
                                        selectedTab = tab
                                    }
                                } label: {
                                    VStack(spacing: 8) {
                                        Text(tab)
                                            .font(.system(size: 22, weight: selectedTab == tab ? .black : .bold))
                                            .foregroundStyle(selectedTab == tab ? Theme.text : Theme.subtext)
                                        Capsule()
                                            .fill(selectedTab == tab ? Theme.hotPink : Color.clear)
                                            .frame(width: 48, height: 4)
                                    }
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 18)
                                }
                                .buttonStyle(.plain)
                            }
                        }

                        if selectedTab == "拼团合集" {
                            ProfileCollectionsPanel(ownerID: userID, canManage: userID == store.currentUserID)
                                .padding(.bottom, 24)
                        } else if userPosts.isEmpty {
                            ProfileEmptyNotesView()
                                .frame(minHeight: 360)
                        } else {
                            WaterfallGrid(posts: userPosts)
                                .padding(.horizontal, 12)
                                .padding(.bottom, 28)
                        }
                    }
                    .background(Theme.background)
                    .clipShape(UnevenRoundedRectangle(topLeadingRadius: 18, topTrailingRadius: 18, style: .continuous))
                    .offset(y: -10)
                }
                .padding(.bottom, 18)
            }
            .background(Theme.background.ignoresSafeArea())
        }
        .navigationBarBackButtonHidden(true)
        .navigationBarHidden(true)
        .toolbar(.hidden, for: .tabBar)
        .navigationDestination(isPresented: $isChatPresented) {
            if let chatThreadID {
                ChatView(threadID: chatThreadID)
            }
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 30)
                .onEnded { value in
                    guard value.translation.width > 86,
                          abs(value.translation.height) < 72 else { return }
                    dismiss()
                }
        )
    }

    private func openChat(with user: User) {
        guard let threadID = store.directMessageThreadID(for: user.id) else { return }
        chatThreadID = threadID
        isChatPresented = true
    }
}

struct HeaderTitle: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 30, weight: .black))
                .foregroundStyle(Theme.text)
            Text(subtitle)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Theme.subtext)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.top, 18)
    }
}

struct AvatarView: View {
    let user: User
    let size: CGFloat

    var body: some View {
        Group {
            if !user.avatarURL.isEmpty {
                RemoteImageView(urlString: user.avatarURL)
                    .scaledToFill()
            } else if let imageData = user.avatarImageData,
               let image = UIImage(data: imageData) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Text(user.avatarSymbol)
                    .font(.system(size: size * 0.42, weight: .black))
                    .foregroundStyle(.white)
                    .frame(width: size, height: size)
                    .background(user.avatarTint.gradient, in: Circle())
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay {
            Circle().stroke(Color.white.opacity(0.16), lineWidth: 1)
        }
    }
}

struct SelectChip: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(isSelected ? .white : Theme.subtext)
                .padding(.horizontal, 13)
                .padding(.vertical, 8)
                .background(isSelected ? Theme.hotPink : Theme.panelRaised, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct TagCloud: View {
    let tags: [String]

    var body: some View {
        FlowWrapStatic(items: tags) { tag in
            NavigationLink(value: Route.tag(tag)) {
                Text("#\(tag)")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color(red: 0.78, green: 0.86, blue: 1))
            }
            .buttonStyle(.plain)
        }
    }
}

struct FlowWrap: View {
    let items: [String]
    let selected: String
    let onSelect: (String) -> Void

    var body: some View {
        FlowWrapStatic(items: items) { item in
            SelectChip(title: item, isSelected: item == selected) {
                onSelect(item)
            }
        }
    }
}

struct FlowWrapStatic<Content: View>: View {
    let items: [String]
    let content: (String) -> Content

    var body: some View {
        let columns = [GridItem(.adaptive(minimum: 84), spacing: 8, alignment: .leading)]
        LazyVGrid(columns: columns, alignment: .leading, spacing: 8) {
            ForEach(items, id: \.self) { item in
                content(item)
            }
        }
    }
}

struct InfoRow: View {
    let title: String
    let value: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Text(title)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Theme.subtext)
                .frame(width: 84, alignment: .leading)
            Text(value)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.text.opacity(0.88))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
    }
}

struct ContactButton: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(Theme.hotPink, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

struct ActionIconButton: View {
    let icon: String
    let title: String
    let tint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: icon)
                    .font(.system(size: 24, weight: .semibold))
                Text(title)
                    .font(.system(size: 12, weight: .bold))
            }
            .foregroundStyle(tint)
            .frame(width: 46)
        }
        .buttonStyle(.plain)
    }
}

struct RequiredLabel: View {
    let title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        HStack(spacing: 4) {
            Text(title)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.text)
            Text("*")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.hotPink)
        }
    }
}

struct PrototypeTextField: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    let required: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                Text(title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.subtext)
                if required {
                    Text("*")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.hotPink)
                }
            }
            TextField(placeholder, text: $text)
                .foregroundStyle(Theme.text)
                .padding(13)
                .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                .overlay {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(required && text.trimmed.isEmpty ? Theme.hotPink.opacity(0.45) : Theme.hairline, lineWidth: 1)
                }
        }
    }
}

struct PrototypeTextEditor: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    let required: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                Text(title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.subtext)
                if required {
                    Text("*")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.hotPink)
                }
            }
            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text(placeholder)
                        .foregroundStyle(Theme.muted)
                        .padding(.horizontal, 17)
                        .padding(.vertical, 16)
                }
                TextEditor(text: $text)
                    .frame(minHeight: 96)
                    .foregroundStyle(Theme.text)
                    .scrollContentBackground(.hidden)
                    .padding(8)
            }
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .stroke(required && text.trimmed.isEmpty ? Theme.hotPink.opacity(0.45) : Theme.hairline, lineWidth: 1)
            }
        }
    }
}

struct TagEditor: View {
    let tags: [String]
    @Binding var selection: Set<String>
    @State private var customTag = ""

    var visibleTags: [String] {
        let customSelected = selection
            .filter { !tags.contains($0) }
            .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
        return tags + customSelected
    }

    var normalizedCustomTag: String {
        customTag.trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("品类 / 圈层标签")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.text)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 78), spacing: 8)], alignment: .leading, spacing: 8) {
                ForEach(visibleTags, id: \.self) { tag in
                    Button {
                        if selection.contains(tag) {
                            selection.remove(tag)
                        } else {
                            selection.insert(tag)
                        }
                    } label: {
                        Text(tag)
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(selection.contains(tag) ? .white : Theme.subtext)
                            .padding(.horizontal, 11)
                            .padding(.vertical, 8)
                            .background(selection.contains(tag) ? Theme.hotPink : Theme.panel, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            HStack(spacing: 8) {
                TextField("自定义标签", text: $customTag)
                    .foregroundStyle(Theme.text)
                    .padding(12)
                    .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
                    .overlay {
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Theme.hairline, lineWidth: 1)
                    }
                Button {
                    addCustomTag()
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 18, weight: .black))
                        .foregroundStyle(normalizedCustomTag.isEmpty ? Theme.muted : .white)
                        .frame(width: 44, height: 44)
                        .background(normalizedCustomTag.isEmpty ? Theme.panelRaised : Theme.hotPink, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(normalizedCustomTag.isEmpty)
            }
        }
    }

    private func addCustomTag() {
        let tag = normalizedCustomTag
        guard !tag.isEmpty else { return }
        selection.insert(tag)
        customTag = ""
    }
}

func sanitizeDepositPercentInput(_ value: String) -> String {
    var result = ""
    var hasDecimalPoint = false
    var decimalDigits = 0

    for scalar in value.unicodeScalars {
        if scalar.value >= 48 && scalar.value <= 57 {
            if hasDecimalPoint {
                guard decimalDigits < 1 else { continue }
                decimalDigits += 1
            }
            result.unicodeScalars.append(scalar)
        } else if scalar == "." && !hasDecimalPoint {
            hasDecimalPoint = true
            if result.isEmpty {
                result = "0"
            }
            result.append(".")
        }
    }

    return result
}

func finalizedDepositPercent(_ value: String) -> String {
    let sanitized = sanitizeDepositPercentInput(value)
    return sanitized.hasSuffix(".") ? String(sanitized.dropLast()) : sanitized
}

struct ValidationRow: View {
    let isValid: Bool
    let text: String

    var body: some View {
        Label(text, systemImage: isValid ? "checkmark.circle.fill" : "xmark.circle")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(isValid ? Color.green.opacity(0.9) : Theme.muted)
    }
}

struct ReminderMiniCard: View {
    let post: GroupBuyPost
    let reminder: Reminder

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: reminder.hasReminded ? "bell.badge.fill" : "bell.fill")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Theme.hotPink)
                .frame(width: 44, height: 44)
                .background(Theme.hotPink.opacity(0.14), in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(reminder.hasReminded ? "你收藏的团购即将截团" : "截团提醒已开启")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Theme.text)
                Text("《\(post.title)》\(post.deadline.shortDeadlineText)")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.subtext)
                    .lineLimit(2)
            }
            Spacer()
        }
        .padding(14)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
    }
}

struct ReminderLargeCard: View {
    let post: GroupBuyPost
    let reminder: Reminder

    var body: some View {
        HStack(spacing: 12) {
            PostImageView(post: post)
                .scaledToFill()
                .frame(width: 80, height: 80)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 7) {
                Text(post.title)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                Text("截团：\(post.deadline.fullDisplay)")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.subtext)
                Text(reminder.hasReminded ? "已模拟发送提醒" : "将在截团前提醒")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(reminder.hasReminded ? Color.green : Theme.hotPink)
            }
            Spacer()
        }
        .padding(14)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
    }
}

struct ProfileLinkRow: View {
    let title: String
    let subtitle: String
    let icon: String
    let route: Route

    var body: some View {
        NavigationLink(value: route) {
            ProfileRowContent(title: title, subtitle: subtitle, icon: icon, accessory: "chevron.right")
        }
        .buttonStyle(.plain)
    }
}

struct ProfileStaticRow: View {
    let title: String
    let subtitle: String
    let icon: String

    var body: some View {
        ProfileRowContent(title: title, subtitle: subtitle, icon: icon, accessory: "chevron.right")
    }
}

struct ProfileRowContent: View {
    let title: String
    let subtitle: String
    let icon: String
    let accessory: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.hotPink)
                .frame(width: 42, height: 42)
                .background(Theme.hotPink.opacity(0.13), in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Theme.text)
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.subtext)
            }
            Spacer()
            Image(systemName: accessory)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Theme.muted)
        }
        .padding(14)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
    }
}

struct StatItem: View {
    let value: String
    let title: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.text)
            Text(title)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.subtext)
        }
    }
}

struct AdminMetric: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(value)
                .font(.system(size: 24, weight: .black))
                .foregroundStyle(Theme.text)
            Text(title)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.subtext)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.panel, in: RoundedRectangle(cornerRadius: 8))
    }
}

struct AdminActionButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(title == "下架" ? .white : Theme.text)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 9)
                .background(title == "下架" ? Theme.hotPink : Theme.panelRaised, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct ToastHost: View {
    @EnvironmentObject private var store: MockAppStore

    var body: some View {
        if let message = store.toastMessage {
            Text(message)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .background(.black.opacity(0.82), in: Capsule())
                .padding(.top, 10)
                .transition(.move(edge: .top).combined(with: .opacity))
                .animation(.spring(response: 0.28, dampingFraction: 0.86), value: message)
        }
    }
}

extension String {
    var trimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

extension Int {
    var formattedCount: String {
        if self >= 10_000 {
            let value = Double(self) / 10_000
            return String(format: "%.1fw", value)
        }
        return "\(self)"
    }
}

extension Date {
    var shortDeadlineText: String {
        let interval = timeIntervalSinceNow
        if interval <= 0 { return "已截团" }
        let hours = Int(interval / 3600)
        if hours < 24 {
            return hours <= 6 ? "\(max(hours, 1))小时后截团" : "今晚截团"
        }
        let days = Int(ceil(interval / 86400))
        return "\(days)天后截团"
    }

    var fullDisplay: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "M月d日 HH:mm"
        return formatter.string(from: self)
    }

    var shortDateOnlyText: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "yyyy年M月d日"
        return formatter.string(from: self)
    }

    var relativeText: String {
        let interval = abs(timeIntervalSinceNow)
        if interval < 60 { return "刚刚" }
        if interval < 3600 { return "\(Int(interval / 60))分钟前" }
        if interval < 86400 { return "\(Int(interval / 3600))小时前" }
        return "\(Int(interval / 86400))天前"
    }
}

#Preview("完整 App") {
    RootView()
        .environmentObject(MockAppStore())
        .tint(Theme.hotPink)
        .preferredColorScheme(.dark)
}

#Preview("团购详情") {
    NavigationStack {
        PostDetailView(postID: "p-card")
    }
    .environmentObject(MockAppStore())
    .tint(Theme.hotPink)
    .preferredColorScheme(.dark)
}

#Preview("发布页") {
    NavigationStack {
        CreatePostView()
    }
    .environmentObject(MockAppStore())
    .tint(Theme.hotPink)
    .preferredColorScheme(.dark)
}

#Preview("我的主页") {
    NavigationStack {
        ProfileView()
    }
    .environmentObject(MockAppStore())
    .tint(Theme.hotPink)
    .preferredColorScheme(.dark)
}

#Preview("举报后台") {
    NavigationStack {
        AdminReportView()
    }
    .environmentObject(MockAppStore())
    .tint(Theme.hotPink)
    .preferredColorScheme(.dark)
}
