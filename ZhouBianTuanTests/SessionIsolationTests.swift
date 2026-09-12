import XCTest
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
}
