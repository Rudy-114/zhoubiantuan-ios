import XCTest
import UIKit
@testable import ZhouBianTuan

final class StubProtocol: URLProtocol {
    static var handler: ((StubProtocol) -> Void)?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Self.handler?(self) }
    override func stopLoading() {}

    func reply(_ body: [String: Any], status: Int = 200) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: body))
        client?.urlProtocolDidFinishLoading(self)
    }
}

// URLSession callbacks run off the main actor; the slot safely hands held requests to the test.
private final class RequestSlot: @unchecked Sendable {
    private let lock = NSLock()
    private var value: StubProtocol?
    func set(_ request: StubProtocol) { lock.lock(); value = request; lock.unlock() }
    func take() -> StubProtocol { lock.lock(); defer { lock.unlock() }; return value! }
}

private final class RequestBag: @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [StubProtocol] = []
    func add(_ request: StubProtocol) { lock.lock(); requests.append(request); lock.unlock() }
    func all() -> [StubProtocol] { lock.lock(); defer { lock.unlock() }; return requests }
}

@MainActor
final class SessionIsolationTests: XCTestCase {
    private func user(_ id: String, nickname: String? = nil) -> [String: Any] {
        ["id": id, "email": "\(id)@example.test", "nickname": nickname ?? id, "bio": "",
         "followingCount": 0, "followersCount": 0, "postCount": 0, "isRestricted": false,
         "canShowContact": true, "avatarSymbol": "T", "avatarTint": "rose", "redBookID": "",
         "gender": "", "birthday": "", "region": "", "backgroundImageName": ""]
    }

    private func payload(_ id: String, cursor: String = "20") -> [String: Any] {
        ["token": "synthetic-\(id)", "currentUser": user(id), "users": [user(id)], "syncCursor": cursor,
         "posts": [], "collections": [], "comments": [], "messageThreads": [], "reports": [],
         "likedPostIDs": [], "favoritePostIDs": [], "followedUserIDs": [], "followingByUserID": [:],
         "blockedUserIDs": [], "blockedByUserIDs": []]
    }

    private func store() -> MockAppStore {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubProtocol.self]
        let client = AliyunBackendClient(baseURLString: "http://127.0.0.1:1/api", session: URLSession(configuration: configuration))
        return MockAppStore(backendClient: client, persistsData: false, automaticallyRefresh: false)
    }

    private func login(_ id: String, store: MockAppStore) async {
        let body = payload(id)
        StubProtocol.handler = { $0.reply(body) }
        let success = await store.loginWithEmail(email: "\(id)@example.test", password: "test-password")
        XCTAssertTrue(success)
        XCTAssertEqual(store.currentUserID, id)
    }

    func testOldBootstrapCannotReplaceNewAccountOrItsCursor() async {
        let store = store()
        defer { store.logOut() }
        await login("A", store: store)
        let held = RequestSlot(), started = expectation(description: "A bootstrap in flight")
        StubProtocol.handler = { request in held.set(request); started.fulfill() }
        let old = Task { await store.refreshFromBackend() }
        await fulfillment(of: [started], timeout: 3)
        store.logOut()
        await login("B", store: store)
        let version = store.authSessionVersion
        var stale = payload("A", cursor: "999")
        stale.removeValue(forKey: "token")
        held.take().reply(stale)
        await old.value
        XCTAssertEqual(store.currentUserID, "B")
        XCTAssertEqual(store.users.map(\.id), ["B"])
        XCTAssertEqual(store.authSessionVersion, version)
        XCTAssertEqual(SyncCursorStore.cursor(for: "B"), "20")
    }

    func testOldUnauthorizedResponseCannotLogOutNewAccount() async {
        let store = store()
        defer { store.logOut() }
        await login("A", store: store)
        let held = RequestSlot(), started = expectation(description: "A request in flight")
        StubProtocol.handler = { request in held.set(request); started.fulfill() }
        let old = Task { await store.refreshFromBackend() }
        await fulfillment(of: [started], timeout: 3)
        store.logOut()
        await login("B", store: store)
        held.take().reply(["error": "Expired A token"], status: 401)
        await old.value
        XCTAssertTrue(store.isLoggedIn)
        XCTAssertEqual(store.currentUserID, "B")
        XCTAssertEqual(store.backendToken, "synthetic-B")
    }

    func testOnlyLatestLoginAttemptCanChooseTheAccount() async {
        let store = store()
        defer { store.logOut() }
        let held = RequestSlot(), started = expectation(description: "First login in flight")
        StubProtocol.handler = { request in held.set(request); started.fulfill() }
        let first = Task { await store.loginWithEmail(email: "A@example.test", password: "test-password") }
        await fulfillment(of: [started], timeout: 3)
        await login("B", store: store)
        held.take().reply(payload("A"))
        let applied = await first.value
        XCTAssertFalse(applied)
        XCTAssertEqual(store.currentUserID, "B")
    }

    func testLogoutDiscardsAnInFlightAnonymousLogin() async {
        let store = store()
        let held = RequestSlot(), started = expectation(description: "Login in flight")
        StubProtocol.handler = { request in held.set(request); started.fulfill() }
        let first = Task { await store.loginWithEmail(email: "A@example.test", password: "test-password") }
        await fulfillment(of: [started], timeout: 3)
        store.logOut()
        held.take().reply(payload("A"))
        let applied = await first.value
        XCTAssertFalse(applied)
        XCTAssertFalse(store.isLoggedIn)
        XCTAssertNil(store.backendToken)
    }

    func testOldCompletionDoesNotUnlockNewAccountsRefresh() async {
        let store = store()
        defer { store.logOut() }
        await login("A", store: store)
        let oldSlot = RequestSlot(), oldStarted = expectation(description: "A refresh")
        StubProtocol.handler = { request in oldSlot.set(request); oldStarted.fulfill() }
        let old = Task { await store.refreshFromBackend() }
        await fulfillment(of: [oldStarted], timeout: 3)
        store.logOut()
        await login("B", store: store)
        let newSlot = RequestSlot(), newStarted = expectation(description: "B refresh")
        newStarted.assertForOverFulfill = true
        StubProtocol.handler = { request in newSlot.set(request); newStarted.fulfill() }
        let fresh = Task { await store.refreshFromBackend(silent: true) }
        await fulfillment(of: [newStarted], timeout: 3)
        oldSlot.take().reply(payload("A"))
        await old.value
        // Must return without sending a second B request while the first one remains pending.
        await store.refreshFromBackend(silent: true)
        StubProtocol.handler = { $0.reply(["blockedUsers": []]) }
        var latest = payload("B", cursor: "21")
        latest.removeValue(forKey: "token")
        newSlot.take().reply(latest)
        await fresh.value
        XCTAssertEqual(store.currentUserID, "B")
        XCTAssertEqual(SyncCursorStore.cursor(for: "B"), "21")
    }

    func testPublishingWaitsForTheServerAndReturnsFailureWithoutDiscardingThePost() async {
        let store = store()
        defer { store.logOut() }
        await login("A", store: store)
        store.collections = [GroupCollection(id: "col-test", ownerID: "A", name: "Draft", contactWechat: "test",
            contactQQ: "", contactGroupNumber: "", groupInfo: "", deadline: Date().addingTimeInterval(86400),
            defaultNote: "", postIDs: [], createdAt: Date())]
        let image = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8)).image { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        }.jpegData(compressionQuality: 0.8)!
        let requests = RequestBag(), started = expectation(description: "Original and preview upload requests")
        started.expectedFulfillmentCount = 2
        StubProtocol.handler = { request in requests.add(request); started.fulfill() }
        var didReturn = false
        let publishing = Task {
            let result = await store.createPost(title: "Keep my draft", groupType: .followGroup, collectionID: "col-test",
                imageNames: [], uploadedImageData: [image], tags: [], price: "10", deposit: "", deadline: Date(),
                condition: "Test", wechat: "test", qq: "", groupInfo: "", description: "Original draft content",
                pingguAveragePrice: "", pingguNote: "", unsoldRoles: [], submissionID: "p-retry-test")
            didReturn = true
            return result
        }
        await fulfillment(of: [started], timeout: 3)
        XCTAssertFalse(didReturn)
        XCTAssertTrue(store.posts.isEmpty)
        requests.all().forEach { $0.reply(["error": "Temporary failure"], status: 503) }
        let success = await publishing.value
        XCTAssertFalse(success)
        XCTAssertTrue(store.posts.isEmpty)
        XCTAssertEqual(store.toastMessage, "Temporary failure")
    }

    func testStockIsOnlyChangedAfterServerConfirmationAndConflictReloadsTheWinner() async throws {
        let store = store()
        defer { store.logOut() }
        await login("A", store: store)
        var post: [String: Any] = [
            "id": "p-stock", "title": "Stock", "authorID": "A", "collectionID": "col-stock",
            "imageNames": [], "groupType": "splitGoods", "categoryTags": [], "fandomTags": [],
            "price": "10", "deposit": "", "deadline": "2026-12-01T00:00:00Z", "condition": "",
            "isFormed": false, "description": "", "wechat": "contact", "qq": "", "groupInfo": "",
            "externalLink": "", "createdAt": "2026-09-01T00:00:00Z", "likedCount": 0,
            "favoriteCount": 0, "commentCount": 0, "reportCount": 0, "status": "active",
            "imageAspect": 1.0, "pingguAveragePrice": "", "pingguNote": "", "revision": 1,
            "unsoldRoles": [["id": "role-a", "name": "A", "quantity": 3, "priceAdjustment": 0]]
        ]
        store.posts = [try JSONDecoder().decode(BackendPost.self, from: JSONSerialization.data(withJSONObject: post)).localPost()]
        let held = RequestSlot(), started = expectation(description: "Stock save in flight")
        StubProtocol.handler = { request in held.set(request); started.fulfill() }
        let edit = Task { await store.saveRoles(postID: "p-stock", revision: 1, roles: [UnsoldRole(id: "role-a", name: "A", quantity: 4)]) }
        await fulfillment(of: [started], timeout: 3)
        XCTAssertEqual(store.posts.first?.unsoldRoles.first?.quantity, 3)
        post["revision"] = 2
        post["unsoldRoles"] = [["id": "role-a", "name": "A", "quantity": 4, "priceAdjustment": 0]]
        held.take().reply(["post": post])
        let saved = await edit.value
        XCTAssertTrue(saved)
        XCTAssertEqual(store.posts.first?.revision, 2)
        XCTAssertEqual(store.posts.first?.unsoldRoles.first?.quantity, 4)

        var latest = payload("A")
        latest.removeValue(forKey: "token")
        latest["posts"] = [post]
        StubProtocol.handler = { request in
            if request.request.httpMethod == "PATCH" { request.reply(["error": "Version conflict"], status: 409) }
            else if request.request.url?.path.contains("blocked-users") == true { request.reply(["blockedUsers": []]) }
            else { request.reply(latest) }
        }
        let conflict = await store.saveRoles(postID: "p-stock", revision: 1, roles: [UnsoldRole(id: "role-a", name: "A", quantity: 9)])
        XCTAssertFalse(conflict)
        XCTAssertEqual(store.posts.first?.unsoldRoles.first?.quantity, 4)
        XCTAssertEqual(store.toastMessage, "Version conflict")
    }

    func testReportSubmissionWaitsForConfirmationAndNeverAddsAFailedReport() async {
        let store = store()
        defer { store.logOut() }
        await login("A", store: store)
        XCTAssertFalse(store.canModerate)
        let held = RequestSlot(), started = expectation(description: "Report in flight")
        StubProtocol.handler = { request in held.set(request); started.fulfill() }
        let submission = Task { await store.submitReport(target: .message("dm-test"), reason: "Harassment", detail: "Please review") }
        await fulfillment(of: [started], timeout: 3)
        XCTAssertTrue(store.reports.isEmpty)
        held.take().reply(["error": "Report could not be saved"], status: 503)
        let failed = await submission.value
        XCTAssertFalse(failed)
        XCTAssertTrue(store.reports.isEmpty)
        StubProtocol.handler = { $0.reply(["report": ["id": "rp-test", "target": ["type": "message", "id": "dm-test"],
            "reason": "Harassment", "detail": "Please review", "reporterID": "A", "status": "pending"]]) }
        let saved = await store.submitReport(target: .message("dm-test"), reason: "Harassment", detail: "Please review")
        XCTAssertTrue(saved)
        XCTAssertEqual(store.reports.count, 1)
        XCTAssertEqual(store.reports.first?.target, .message("dm-test"))
    }

    func testPaginationForwardsTheCursorAndMergesPagesWithoutDuplicateRows() async {
        let store = store()
        defer { store.logOut() }
        await login("A", store: store)
        let query = ContentQuery(path: "/users", parameters: ["q": "Search"])
        let first = [user("A"), user("B")], second = [user("B"), user("C")]
        StubProtocol.handler = { $0.reply(["users": first, "hasMore": true, "nextCursor": "opaque-cursor"]) }
        await store.loadContentPage(query)
        XCTAssertEqual(store.pageState(query).ids, ["A", "B"])
        XCTAssertTrue(store.pageState(query).hasMore)
        let requested = expectation(description: "Next cursor was sent")
        StubProtocol.handler = { request in
            let items = URLComponents(url: request.request.url!, resolvingAgainstBaseURL: false)?.queryItems
            XCTAssertEqual(items?.first { $0.name == "cursor" }?.value, "opaque-cursor")
            requested.fulfill()
            request.reply(["users": second, "hasMore": false])
        }
        await store.loadContentPage(query)
        await fulfillment(of: [requested], timeout: 3)
        XCTAssertEqual(store.pageState(query).ids, ["A", "B", "C"])
        XCTAssertFalse(store.pageState(query).hasMore)
        XCTAssertEqual(store.pageUsers(query).map(\.id), ["A", "B", "C"])
        store.logOut()
        XCTAssertTrue(store.contentPages.isEmpty)
    }

    func testSwitchingAccountsDoesNotCarryAnUnsentMessageInASharedConversation() async {
        let store = store()
        defer { store.logOut() }
        await login("A", store: store)
        store.threads = [MessageThread(id: "t-shared", buyerUserID: "A", publisherUserID: "B", relatedPostID: nil,
            messages: [DirectMessage(id: "m-private-draft", senderID: "A", body: "A has not sent this", createdAt: Date(), deliveryStatus: .sending)], unreadCount: 0, updatedAt: Date())]
        await login("B", store: store)
        XCTAssertTrue(store.threads.isEmpty)
    }
}
