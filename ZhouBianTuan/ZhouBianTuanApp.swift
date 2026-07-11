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

enum SafetyReportResumeDecision {
    enum Action: Equatable {
        case wait
        case discard
        case present(SafetyReportFormSnapshot)
    }

    static func shouldPresent(
        snapshot: SafetyReportFormSnapshot,
        isLoggedIn: Bool,
        currentUserID: String,
        isAuthPromptPresented: Bool,
        isReportPresented: Bool
    ) -> Bool {
        isLoggedIn &&
        snapshot.reporterUserID == currentUserID &&
        !isAuthPromptPresented &&
        !isReportPresented
    }

    static func action(
        isPending: Bool,
        snapshot: SafetyReportFormSnapshot?,
        isLoggedIn: Bool,
        currentUserID: String,
        isAuthPromptPresented: Bool,
        isReportPresented: Bool
    ) -> Action {
        guard isPending, isLoggedIn else { return .wait }
        guard let snapshot, snapshot.reporterUserID == currentUserID else { return .discard }
        guard shouldPresent(
            snapshot: snapshot,
            isLoggedIn: isLoggedIn,
            currentUserID: currentUserID,
            isAuthPromptPresented: isAuthPromptPresented,
            isReportPresented: isReportPresented
        ) else {
            return .wait
        }
        return .present(snapshot)
    }
}

struct RootView: View {
    @EnvironmentObject private var store: MockAppStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab: AppTab = .home
    @State private var showsLaunchSplash = true
    @State private var shouldResumeSafetyReport = false
    @State private var resumedSafetyReport: SafetyReportFormSnapshot?
    @State private var isAuthCoverPresented = false

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
                .badge(unreadMessageCount)
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

            if showsLaunchSplash {
                LaunchSplashView(isDarkMode: store.isDarkModeEnabled)
                    .transition(.opacity)
                    .zIndex(10)
                    .task {
                        try? await Task.sleep(nanoseconds: 1_250_000_000)
                        withAnimation(.easeOut(duration: 0.35)) {
                            showsLaunchSplash = false
                        }
                    }
            }
        }
        .fullScreenCover(isPresented: $isAuthCoverPresented, onDismiss: {
            presentResumableSafetyReportWhenReady()
        }) {
            GuestAuthView(onClose: {
                store.isAuthPromptPresented = false
                isAuthCoverPresented = false
            })
            .environmentObject(store)
            .preferredColorScheme(.dark)
        }
        .sheet(item: $resumedSafetyReport) { snapshot in
            ReportSheet(source: snapshot.source, initialSnapshot: snapshot) {}
                .environmentObject(store)
        }
        .onChange(of: store.isLoggedIn) {
            if store.isLoggedIn {
                store.isAuthPromptPresented = false
                presentResumableSafetyReportWhenReady()
            } else if store.hasSafetyReportFormSnapshot {
                shouldResumeSafetyReport = true
                resumedSafetyReport = nil
            }
        }
        .onChange(of: store.currentUserID) {
            if store.isLoggedIn {
                presentResumableSafetyReportWhenReady()
            }
        }
        .onChange(of: store.isAuthPromptPresented) {
            if store.isAuthPromptPresented {
                DispatchQueue.main.async {
                    if store.isAuthPromptPresented {
                        isAuthCoverPresented = true
                    }
                }
            } else {
                isAuthCoverPresented = false
            }
        }
    }

    private func presentResumableSafetyReportWhenReady() {
        guard shouldResumeSafetyReport else { return }
        DispatchQueue.main.async {
            let action = SafetyReportResumeDecision.action(
                isPending: shouldResumeSafetyReport,
                snapshot: store.resumableSafetyReportFormSnapshot(for: store.currentUserID),
                isLoggedIn: store.isLoggedIn,
                currentUserID: store.currentUserID,
                isAuthPromptPresented: store.isAuthPromptPresented || isAuthCoverPresented,
                isReportPresented: resumedSafetyReport != nil
            )
            switch action {
            case .wait:
                break
            case .discard:
                shouldResumeSafetyReport = false
                resumedSafetyReport = nil
            case .present(let snapshot):
                shouldResumeSafetyReport = false
                resumedSafetyReport = snapshot
            }
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
