import SwiftUI

struct ContentQuery: Hashable {
    var path = "/feed"
    var parameters: [String: String] = [:]
    var key: String {
        var components = URLComponents()
        components.queryItems = parameters.keys.sorted().map { URLQueryItem(name: $0, value: parameters[$0]) }
        return path + "?" + (components.percentEncodedQuery ?? "")
    }
    var isThreadPage: Bool { path == "/messages/threads" }
    var isMessagePage: Bool { path.hasSuffix("/messages") }
    var isUserPage: Bool { path == "/users" }
    var isCollectionPage: Bool { path == "/collections" }
    var isCommentPage: Bool { path.hasSuffix("/comments") }
    static func author(_ id: String) -> Self { .init(parameters: ["authorID": id]) }
    static func collection(_ id: String) -> Self { .init(parameters: ["collectionID": id]) }
    static func collections(_ owner: String) -> Self { .init(path: "/collections", parameters: ["ownerID": owner]) }
    static func comments(_ postID: String) -> Self { .init(path: "/posts/\(postID)/comments") }
    static let favorites = Self(parameters: ["favorites": "true"])
    static let likes = Self(parameters: ["likes": "true"])
    static let threads = Self(path: "/messages/threads")
    static func messages(_ threadID: String) -> Self { .init(path: "/messages/threads/\(threadID)/messages") }
    static let following = Self(parameters: ["following": "true"])
}

struct ContentPageState {
    var ids: [String] = []
    var nextCursor: String?
    var hasMore = true
    var isLoaded = false
    var requestID: UUID?
    var error: String?
}

struct BackendContentPage: Decodable {
    var unreadMessageCount: Int?
    var unreadCursor: String?
    var posts: [BackendPost]?
    var users: [BackendUser]?
    var collections: [BackendCollection]?
    var comments: [BackendComment]?
    var thread: BackendMessageThread?
    var messageThreads: [BackendMessageThread]?
    var post: BackendPost?
    var nextCursor: String?
    var hasMore: Bool?
    var commentsNextCursor: String?
    var commentsHasMore: Bool?
}

extension AliyunBackendClient {
    func contentPage(_ query: ContentQuery, cursor: String?, token: String?) async throws -> BackendContentPage {
        var parameters = query.parameters
        parameters["limit"] = "30"
        if let cursor { parameters["cursor"] = cursor }
        var components = URLComponents()
        components.queryItems = parameters.keys.sorted().map { URLQueryItem(name: $0, value: parameters[$0]) }
        return try await request(query.path + "?" + (components.percentEncodedQuery ?? ""), token: token)
    }
    func postDetail(_ postID: String, token: String?) async throws -> BackendContentPage {
        try await request("/posts/\(postID)", token: token)
    }
}

extension MockAppStore {
    func pageState(_ query: ContentQuery) -> ContentPageState { contentPages[query.key] ?? ContentPageState() }

    func pagePosts(_ query: ContentQuery) -> [GroupBuyPost] {
        pageState(query).ids.compactMap { post(id: $0) }.filter { post in
            if post.status != .active && query.parameters["authorID"] != currentUserID { return false }
            if let collectionID = query.parameters["collectionID"], post.collectionID != collectionID { return false }
            if query.parameters["inStock"] == "true" && !post.unsoldRoles.contains(where: \.isAvailable) { return false }
            if query.parameters["roles"] == "true", let term = query.parameters["q"] {
                return post.unsoldRoles.contains { $0.isAvailable && $0.name.localizedCaseInsensitiveContains(term) }
            }
            return true
        }
    }
    func pageUsers(_ query: ContentQuery) -> [User] {
        pageState(query).ids.compactMap { id in users.first { $0.id == id && canShowContent(from: id) } }
    }
    func invalidateContentPages() {
        homeFeedOrders.removeAll()
        contentPages.removeAll()
        postDetailRequests.removeAll()
        postDetailLastLoadedAt.removeAll()
        contentPageEpoch = UUID()
    }

    func loadContentPage(_ query: ContentQuery, reset: Bool = false) async {
        guard isBackendEnabled else { return }
        var state = pageState(query)
        guard reset || (state.requestID == nil && state.hasMore) else { return }
        let session = authSessionVersion, epoch = contentPageEpoch, requestID = UUID()
        state.requestID = requestID
        state.error = nil
        contentPages[query.key] = state
        defer {
            if contentPages[query.key]?.requestID == requestID { contentPages[query.key]?.requestID = nil }
        }
        do {
            let page = try await backendClient.contentPage(query, cursor: reset ? nil : state.nextCursor, token: backendToken)
            guard isCurrentSession(session), contentPageEpoch == epoch, contentPages[query.key]?.requestID == requestID else { return }
            if reset { homeFeedOrders[query.key] = nil }
            mergeContentPage(page)
            let ids: [String]
            if query.isThreadPage { ids = page.messageThreads?.map(\.id) ?? [] }
            else if query.isMessagePage { ids = page.thread?.messages.map(\.id) ?? [] }
            else if query.isUserPage { ids = page.users?.map(\.id) ?? [] }
            else if query.isCollectionPage { ids = page.collections?.map(\.id) ?? [] }
            else if query.isCommentPage { ids = page.comments?.map(\.id) ?? [] }
            else { ids = page.posts?.map(\.id) ?? [] }
            if reset { state.ids = ids } else { let known = Set(state.ids); state.ids += ids.filter { !known.contains($0) } }
            state.isLoaded = true
            state.hasMore = page.hasMore ?? false
            state.nextCursor = page.nextCursor
            state.requestID = nil
            contentPages[query.key] = state
        } catch {
            guard isCurrentSession(session), contentPageEpoch == epoch, contentPages[query.key]?.requestID == requestID else { return }
            contentPages[query.key]?.error = error.localizedDescription
        }
    }

    func mergeContentPage(_ page: BackendContentPage) {
        mergeUnreadSnapshot(page.unreadMessageCount, cursor: page.unreadCursor)
        mergeChangedMessageThreads(from: page.messageThreads?.map { $0.localThread() } ?? page.thread.map { [$0.localThread()] } ?? [])
        mergeUsers(page.users?.map { $0.localUser() } ?? [])
        mergePosts(page.posts?.map { $0.localPost() } ?? page.post.map { [$0.localPost()] } ?? [])
        mergeCollections(page.collections?.map { $0.localCollection() } ?? [])
        mergeComments(page.comments?.map { $0.localComment() } ?? [])
    }

    func loadPostDetail(_ id: String, forceRefresh: Bool = false) async {
        guard isBackendEnabled, postDetailRequests[id] == nil else { return }
        if !forceRefresh,
           posts.contains(where: { $0.id == id }),
           let lastLoadedAt = postDetailLastLoadedAt[id],
           Date().timeIntervalSince(lastLoadedAt) < 45 {
            return
        }
        let session = authSessionVersion, requestID = UUID()
        postDetailRequests[id] = requestID
        defer { if postDetailRequests[id] == requestID { postDetailRequests[id] = nil } }
        do {
            let page = try await backendClient.postDetail(id, token: backendToken)
            guard isCurrentSession(session), postDetailRequests[id] == requestID else { return }
            mergeContentPage(page)
            var state = ContentPageState()
            state.ids = page.comments?.map(\.id) ?? []
            state.hasMore = page.commentsHasMore ?? false
            state.nextCursor = page.commentsNextCursor
            state.isLoaded = true
            contentPages[ContentQuery.comments(id).key] = state
            postDetailErrors[id] = nil
            postDetailLastLoadedAt[id] = Date()
        } catch {
            guard isCurrentSession(session), postDetailRequests[id] == requestID else { return }
            postDetailErrors[id] = error.localizedDescription
            if (error as NSError).domain == "AliyunBackendClient", (error as NSError).code == 404 {
                posts.removeAll { $0.id == id }
                postDetailLastLoadedAt[id] = nil
            }
        }
    }
}

struct ContentPageFooter: View {
    @EnvironmentObject private var store: MockAppStore
    let query: ContentQuery
    var loadMore: (() async -> Void)? = nil
    var automaticallyLoad = false

    var body: some View {
        let state = store.pageState(query)
        Group {
            if !store.isBackendEnabled { EmptyView() }
            else if state.requestID != nil { ProgressView().padding() }
            else if let error = state.error {
                VStack(spacing: 8) {
                    Text(error).font(.footnote).foregroundStyle(Theme.subtext)
                    Button("重试加载") { Task { await load(reset: !state.isLoaded) } }
                }.padding()
            } else if state.hasMore {
                Button(state.isLoaded ? "加载更多" : "加载内容") { Task { await load() } }.padding()
            } else if state.ids.isEmpty {
                Text("暂无内容").font(.subheadline).foregroundStyle(Theme.muted).padding()
            }
        }
        .frame(maxWidth: .infinity)
        .task(id: "\(store.authSessionVersion)-\(store.contentPageEpoch)-\(query.key)") {
            if !store.pageState(query).isLoaded { await store.loadContentPage(query) }
        }
        .onAppear {
            guard automaticallyLoad, store.isBackendEnabled else { return }
            Task { await load() }
        }
    }

    private func load(reset: Bool = false) async {
        if !reset, let loadMore { await loadMore() }
        else { await store.loadContentPage(query, reset: reset) }
    }
}
