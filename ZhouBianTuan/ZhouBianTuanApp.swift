import SwiftUI
import UIKit
import Photos
import PhotosUI
import UniformTypeIdentifiers


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
    case editRejectedPost(String)
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
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selectedTab: AppTab = .home
    @State private var homePath: [Route] = []
    @State private var marketPath: [Route] = []
    @State private var createPath: [Route] = []
    @State private var messagesPath: [Route] = []
    @State private var profilePath: [Route] = []
    @State private var showsLaunchSplash = true

    private var isAuthenticated: Bool {
        store.isLoggedIn
    }

    private var unreadMessageCount: Int {
        isAuthenticated ? store.unreadMessageCount : 0
    }

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            TabView(selection: $selectedTab) {
                NavigationStack(path: $homePath) {
                    HomeView()
                        .withAppDestinations(popNavigationRoute: {
                            popHomeRoute()
                        })
                }
                .environment(\.popNavigationRoute, {
                    popHomeRoute()
                })
                .environment(\.navigationBackdrop, AnyView(HomeView()))
                .tabItem { Label(AppTab.home.title, systemImage: AppTab.home.icon) }
                .tag(AppTab.home)

                NavigationStack(path: $marketPath) {
                    AuthenticatedTabContent {
                        MarketView()
                    }
                        .withAppDestinations(popNavigationRoute: {
                            popMarketRoute()
                        })
                }
                .environment(\.popNavigationRoute, {
                    popMarketRoute()
                })
                .environment(\.navigationBackdrop, AnyView(AuthenticatedTabContent {
                    MarketView()
                }))
                .tabItem { Label(AppTab.market.title, systemImage: AppTab.market.icon) }
                .tag(AppTab.market)

                NavigationStack(path: $createPath) {
                    AuthenticatedTabContent {
                        CreatePostView()
                    }
                        .withAppDestinations(popNavigationRoute: {
                            popCreateRoute()
                        })
                }
                .environment(\.popNavigationRoute, {
                    popCreateRoute()
                })
                .environment(\.navigationBackdrop, AnyView(AuthenticatedTabContent {
                    CreatePostView()
                }))
                .tabItem { Label(AppTab.create.title, systemImage: AppTab.create.icon) }
                .tag(AppTab.create)

                NavigationStack(path: $messagesPath) {
                    AuthenticatedTabContent {
                        MessagesView()
                    }
                        .withAppDestinations(popNavigationRoute: {
                            popMessagesRoute()
                        })
                }
                .environment(\.popNavigationRoute, {
                    popMessagesRoute()
                })
                .environment(\.navigationBackdrop, AnyView(AuthenticatedTabContent {
                    MessagesView()
                }))
                .tabItem { Label(AppTab.messages.title, systemImage: AppTab.messages.icon) }
                .badge(unreadMessageCount)
                .tag(AppTab.messages)

                NavigationStack(path: $profilePath) {
                    AuthenticatedTabContent {
                        ProfileView()
                    }
                        .withAppDestinations(popNavigationRoute: {
                            popProfileRoute()
                        })
                }
                .environment(\.popNavigationRoute, {
                    popProfileRoute()
                })
                .environment(\.navigationBackdrop, AnyView(AuthenticatedTabContent {
                    ProfileView()
                }))
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
                Task { await store.loadPublicFeedIfNeeded() }
                await store.loadBackendIfNeeded()
                store.startBackendAutoRefresh()
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    store.startBackendAutoRefresh()
                    Task { await store.syncFromBackend(reason: "foreground") }
                } else {
                    store.stopBackendAutoRefresh()
                }
            }
            .onOpenURL { url in
                guard let route = Route(url: url) else {
                    store.showToast("无法打开这个周边团链接")
                    return
                }
                selectedTab = .home
                homePath.append(route)
            }

            if showsLaunchSplash {
                LaunchSplashView(isDarkMode: store.isDarkModeEnabled)
                    .transition(.opacity)
                    .zIndex(10)
                    .task {
                        if !reduceMotion { try? await Task.sleep(nanoseconds: 450_000_000) }
                        if reduceMotion { showsLaunchSplash = false }
                        else { withAnimation(.easeOut(duration: 0.35)) { showsLaunchSplash = false } }
                    }
            }
        }
    }

    private func popHomeRoute() {
        popRoute(&homePath)
    }

    private func popMarketRoute() {
        popRoute(&marketPath)
    }

    private func popCreateRoute() {
        popRoute(&createPath)
    }

    private func popMessagesRoute() {
        popRoute(&messagesPath)
    }

    private func popProfileRoute() {
        popRoute(&profilePath)
    }

    private func popRoute(_ path: inout [Route]) {
        guard !path.isEmpty else { return }
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        _ = withTransaction(transaction) {
            path.removeLast()
        }
    }
}

extension Route {
    init?(url: URL) {
        let scheme = url.scheme?.lowercased()
        let components = url.pathComponents.filter { $0 != "/" && !$0.isEmpty }
        let kind: String
        let identifier: String
        if scheme == "zhoubiantuan" {
            kind = url.host?.lowercased() ?? ""
            guard let value = components.first else { return nil }
            identifier = value
        } else if scheme == "https" || scheme == "http" {
            let host = url.host?.lowercased() ?? ""
            guard host == "zhoubiantuanmail.top" || host == "www.zhoubiantuanmail.top" else { return nil }
            guard components.count >= 2 else { return nil }
            kind = components[0].lowercased()
            identifier = components[1]
        } else {
            return nil
        }
        switch kind {
        case "post": self = .postDetail(identifier)
        case "profile", "user": self = .userProfile(identifier)
        case "collection": self = .collectionDetail(identifier)
        default: return nil
        }
    }
}

struct LaunchSplashView: View {
    let isDarkMode: Bool
    @State private var isPresented = false

    var body: some View {
        ZStack {
            (isDarkMode ? Color.black : Color.white)
                .ignoresSafeArea()

            Text("周边团")
                .font(.system(size: 48, weight: .black, design: .rounded))
                .foregroundStyle(Theme.hotPink)
                .scaleEffect(isPresented ? 1 : 0.92)
                .opacity(isPresented ? 1 : 0.2)
        }
        .onAppear {
            withAnimation(.spring(response: 0.58, dampingFraction: 0.78)) {
                isPresented = true
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
    func withAppDestinations(popNavigationRoute: (() -> Void)? = nil) -> some View {
        navigationDestination(for: Route.self) { route in
            switch route {
            case .search:
                SearchView()
            case .postDetail(let id):
                PostDetailView(postID: id, onInteractiveBack: popNavigationRoute)
            case .collectionDetail(let id):
                CollectionDetailView(collectionID: id)
            case .tag(let tag):
                TagContentView(tag: tag)
            case .chat(let id):
                ChatView(threadID: id)
            case .editRejectedPost(let id):
                CreatePostView(republishingPostID: id)
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
                AdminModerationView()
            }
        }
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

#Preview("审核后台") {
    NavigationStack {
        AdminModerationView()
    }
    .environmentObject(MockAppStore())
    .tint(Theme.hotPink)
    .preferredColorScheme(.dark)
}
