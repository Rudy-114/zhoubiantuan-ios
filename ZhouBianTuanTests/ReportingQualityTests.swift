import Foundation
import XCTest
@testable import ZhouBianTuan

private final class URLProtocolStub: URLProtocol {
    struct StubResponse {
        let statusCode: Int
        let headers: [String: String]
        let body: Data

        static func json(statusCode: Int = 200, _ json: String) -> StubResponse {
            StubResponse(
                statusCode: statusCode,
                headers: ["Content-Type": "application/json"],
                body: Data(json.utf8)
            )
        }
    }

    typealias Handler = (URLRequest) throws -> StubResponse

    private static let lock = NSLock()
    private static var requestHandler: Handler?
    private static var capturedRequests: [URLRequest] = []
    private static var capturedRequestBodies: [Data?] = []

    static func setHandler(_ handler: @escaping Handler) {
        lock.lock()
        requestHandler = handler
        capturedRequests = []
        capturedRequestBodies = []
        lock.unlock()
    }

    static func reset() {
        lock.lock()
        requestHandler = nil
        capturedRequests = []
        capturedRequestBodies = []
        lock.unlock()
    }

    static var requests: [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return capturedRequests
    }

    static var requestBodies: [Data?] {
        lock.lock()
        defer { lock.unlock() }
        return capturedRequestBodies
    }

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        let handler: Handler?
        let requestBody = Self.bodyData(for: request)
        Self.lock.lock()
        Self.capturedRequests.append(request)
        Self.capturedRequestBodies.append(requestBody)
        handler = Self.requestHandler
        Self.lock.unlock()

        guard let handler else {
            client?.urlProtocol(self, didFailWithError: NSError(domain: "URLProtocolStub", code: 1))
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let stub = try handler(self.request)
                guard let response = HTTPURLResponse(
                    url: self.request.url!,
                    statusCode: stub.statusCode,
                    httpVersion: nil,
                    headerFields: stub.headers
                ) else {
                    throw NSError(domain: "URLProtocolStub", code: 2)
                }
                self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                self.client?.urlProtocol(self, didLoad: stub.body)
                self.client?.urlProtocolDidFinishLoading(self)
            } catch {
                self.client?.urlProtocol(self, didFailWithError: error)
            }
        }
    }

    override func stopLoading() {}

    private static func bodyData(for request: URLRequest) -> Data? {
        if let body = request.httpBody {
            return body
        }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let bufferSize = 1_024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let count = stream.read(buffer, maxLength: bufferSize)
            guard count > 0 else { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

private final class LockedCounter {
    private let lock = NSLock()
    private var value = 0

    func next() -> Int {
        lock.lock()
        defer { lock.unlock() }
        value += 1
        return value
    }
}

private final class LockedArray<Element> {
    private let lock = NSLock()
    private var storage: [Element] = []

    func append(_ value: Element) {
        lock.lock()
        storage.append(value)
        lock.unlock()
    }

    var values: [Element] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

final class ReportingQualityTests: XCTestCase {
    private let defaultsKeys = [
        "zhoubiantuan.isLoggedIn",
        "zhoubiantuan.isDarkModeEnabled",
        "zhoubiantuan.limitsUnrepliedMessages",
        "zhoubiantuan.limitsUnrepliedMessages.defaultDisabled.v1",
        "zhoubiantuan.limitsUnrepliedMessages.defaultRestored.v1",
        "zhoubiantuan.isBackendEnabled",
        "zhoubiantuan.backendToken",
        "zhoubiantuan.backendToken.fallback",
        "zhoubiantuan.browsingHistory.u-me",
        "zhoubiantuan.messageThreads",
        "zhoubiantuan.searchHistory",
        "zhoubiantuan.localDataResetVersion",
        "zhoubiantuan.syncCursor.u-me"
    ]
    private var savedDefaults: [String: Any] = [:]
    private var absentDefaults: Set<String> = []
    private var savedKeychainToken: String?
    private var savedThreadsData: Data?

    override func setUp() {
        super.setUp()
        URLProtocolStub.reset()

        let defaults = UserDefaults.standard
        for key in defaultsKeys {
            if let value = defaults.object(forKey: key) {
                savedDefaults[key] = value
            } else {
                absentDefaults.insert(key)
            }
            defaults.removeObject(forKey: key)
        }
        defaults.set(1, forKey: "zhoubiantuan.localDataResetVersion")

        savedKeychainToken = KeychainStore.string(forKey: "zhoubiantuan.backendToken")
        KeychainStore.delete(forKey: "zhoubiantuan.backendToken")
        savedThreadsData = messageThreadsStorageURL.flatMap { try? Data(contentsOf: $0) }
        if let url = messageThreadsStorageURL {
            try? FileManager.default.removeItem(at: url)
        }
    }

    override func tearDown() {
        URLProtocolStub.reset()
        KeychainStore.delete(forKey: "zhoubiantuan.backendToken")
        if let savedKeychainToken {
            _ = KeychainStore.set(savedKeychainToken, forKey: "zhoubiantuan.backendToken")
        }

        let defaults = UserDefaults.standard
        for key in defaultsKeys {
            defaults.removeObject(forKey: key)
        }
        for (key, value) in savedDefaults {
            defaults.set(value, forKey: key)
        }
        for key in absentDefaults {
            defaults.removeObject(forKey: key)
        }

        if let url = messageThreadsStorageURL {
            try? FileManager.default.removeItem(at: url)
            if let savedThreadsData {
                try? FileManager.default.createDirectory(
                    at: url.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                try? savedThreadsData.write(to: url, options: .atomic)
            }
        }
        super.tearDown()
    }

    func testSubmitReportUsesExpectedRequestAndWireBody() async throws {
        URLProtocolStub.setHandler { _ in
            .json(Self.reportEnvelope(reportID: "rp-submit"))
        }
        let client = makeClient()
        let draft = makeDraft(clientRequestID: "request-submit")

        _ = try await client.submitReport(token: "session-value", draft: draft)

        let request = try XCTUnwrap(URLProtocolStub.requests.first)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/reports")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer session-value")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/json")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try XCTUnwrap(URLProtocolStub.requestBodies.first ?? nil)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["clientRequestID"] as? String, "request-submit")
        XCTAssertEqual(json["sourceType"] as? String, "post")
        XCTAssertEqual(json["sourceID"] as? String, "post-1")
        XCTAssertEqual(json["reasonCode"] as? String, "other")
        XCTAssertEqual(json["reportedField"] as? String, "content")
        XCTAssertEqual(json["detail"] as? String, "details")
        XCTAssertEqual(json["objectKeys"] as? [String], [])
    }

    func testAPI401PreservesCodeAndMessage() async {
        URLProtocolStub.setHandler { _ in
            .json(statusCode: 401, #"{"error":"登录状态已失效","code":"auth_expired"}"#)
        }
        let client = makeClient()

        do {
            _ = try await client.submitReport(token: "session-value", draft: makeDraft())
            XCTFail("Expected a 401 error")
        } catch {
            let error = error as NSError
            XCTAssertEqual(error.domain, "AliyunBackendClient")
            XCTAssertEqual(error.code, 401)
            XCTAssertEqual(error.localizedDescription, "登录状态已失效")
            XCTAssertEqual(error.userInfo[AliyunBackendClient.errorCodeUserInfoKey] as? String, "auth_expired")
        }
    }

    func testAppendEvidenceAllowsSafeLegacyReportIDsAsSinglePathSegments() async throws {
        let client = makeClient()
        for reportID in ["rp-1", "rp-legacy-pending"] {
            URLProtocolStub.setHandler { _ in
                .json(Self.reportEnvelope(reportID: reportID))
            }

            _ = try await client.appendReportEvidence(
                token: "session-value",
                reportID: reportID,
                clientRequestID: "evidence-request",
                objectKeys: [],
                detail: "more"
            )

            XCTAssertEqual(URLProtocolStub.requests.first?.url?.path, "/api/reports/\(reportID)/evidence")
        }
    }

    func testAppendEvidenceRejectsUnsafeReportIDWithoutRequest() async {
        URLProtocolStub.setHandler { _ in
            .json(Self.reportEnvelope(reportID: "rp-unused"))
        }
        let client = makeClient()

        for reportID in [
            "rp-legacy.pending",
            "rp-legacy/pending",
            "rp-legacy?pending",
            "rp-legacy#pending",
            "rp-legacy%2Fpending",
            "rp-legacy pending",
            "rp-待处理"
        ] {
            do {
                _ = try await client.appendReportEvidence(
                    token: "session-value",
                    reportID: reportID,
                    clientRequestID: "evidence-request",
                    objectKeys: [],
                    detail: "more"
                )
                XCTFail("Expected local report ID validation for \(reportID)")
            } catch {
                XCTAssertEqual(error.localizedDescription, "举报记录 ID 无效")
            }
        }
        XCTAssertTrue(URLProtocolStub.requests.isEmpty)
    }

    func testUploadReportImagesUsesExpectedPresignAndPutRequests() async throws {
        URLProtocolStub.setHandler { request in
            if request.url?.path == "/api/uploads/presign" {
                return .json(#"{"objectKey":"report/object.jpg","uploadUrl":"https://upload.invalid/object"}"#)
            }
            return URLProtocolStub.StubResponse(
                statusCode: 200,
                headers: ["ETag": "uploaded"],
                body: Data()
            )
        }
        let client = makeClient()

        let objectKeys = try await client.uploadReportImages(token: "session-value", images: [Data([0x01, 0x02])])

        XCTAssertEqual(objectKeys, ["report/object.jpg"])
        XCTAssertEqual(URLProtocolStub.requests.count, 2)

        let presignRequest = try XCTUnwrap(URLProtocolStub.requests.first)
        XCTAssertEqual(presignRequest.httpMethod, "POST")
        XCTAssertEqual(presignRequest.url?.path, "/api/uploads/presign")
        XCTAssertEqual(presignRequest.value(forHTTPHeaderField: "Authorization"), "Bearer session-value")
        XCTAssertEqual(presignRequest.value(forHTTPHeaderField: "Accept"), "application/json")
        XCTAssertEqual(presignRequest.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let presignBody = try XCTUnwrap(URLProtocolStub.requestBodies.first ?? nil)
        let presignJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: presignBody) as? [String: Any])
        XCTAssertEqual(presignJSON["kind"] as? String, "report")
        XCTAssertEqual(presignJSON["filename"] as? String, "report-evidence-0.jpg")
        XCTAssertEqual(presignJSON["contentType"] as? String, "image/jpeg")

        let uploadRequest = try XCTUnwrap(URLProtocolStub.requests.last)
        XCTAssertEqual(uploadRequest.httpMethod, "PUT")
        XCTAssertEqual(uploadRequest.url?.absoluteString, "https://upload.invalid/object")
        XCTAssertEqual(uploadRequest.value(forHTTPHeaderField: "Content-Type"), "image/jpeg")
        XCTAssertNil(uploadRequest.value(forHTTPHeaderField: "Authorization"))
        XCTAssertEqual(URLProtocolStub.requestBodies.last ?? nil, Data([0x01, 0x02]))
    }

    func testMyReportsUsesExpectedHeaders() async throws {
        URLProtocolStub.setHandler { _ in
            .json(#"{"reports":[]}"#)
        }
        let client = makeClient()

        let reports = try await client.myReports(token: "session-value")

        XCTAssertTrue(reports.isEmpty)
        let request = try XCTUnwrap(URLProtocolStub.requests.first)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/me/reports")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer session-value")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/json")
        XCTAssertNil(request.value(forHTTPHeaderField: "Content-Type"))
    }

    @MainActor
    func testSubmitSafetyReportRejectsConcurrentDuplicateSubmission() async throws {
        let started = expectation(description: "first report started")
        let release = DispatchSemaphore(value: 0)
        URLProtocolStub.setHandler { _ in
            started.fulfill()
            _ = release.wait(timeout: .now() + 5)
            return .json(Self.reportEnvelope(reportID: "rp-first"))
        }
        let store = makeStore()

        let firstTask = Task { @MainActor in
            await store.submitSafetyReport(draft: makeDraft(), imageData: [], blockUserID: nil)
        }
        await fulfillment(of: [started], timeout: 2)
        let secondResult = await store.submitSafetyReport(draft: makeDraft(), imageData: [], blockUserID: nil)
        release.signal()
        let firstResult = await firstTask.value

        XCTAssertFalse(secondResult)
        XCTAssertTrue(firstResult)
        XCTAssertEqual(URLProtocolStub.requests.filter { $0.url?.path == "/api/reports" }.count, 1)
    }

    @MainActor
    func testOldResponseAfterLogoutDoesNotMergeOrFinishNewSubmission() async throws {
        let oldStarted = expectation(description: "old report started")
        let newStarted = expectation(description: "new report started")
        let oldRelease = DispatchSemaphore(value: 0)
        let newRelease = DispatchSemaphore(value: 0)
        let counter = LockedCounter()
        URLProtocolStub.setHandler { _ in
            if counter.next() == 1 {
                oldStarted.fulfill()
                _ = oldRelease.wait(timeout: .now() + 5)
                return .json(Self.reportEnvelope(reportID: "rp-old"))
            }
            newStarted.fulfill()
            _ = newRelease.wait(timeout: .now() + 5)
            return .json(Self.reportEnvelope(reportID: "rp-new"))
        }
        let store = makeStore()

        let oldTask = Task { @MainActor in
            await store.submitSafetyReport(draft: makeDraft(), imageData: [], blockUserID: nil)
        }
        await fulfillment(of: [oldStarted], timeout: 2)
        store.logOut()
        store.isLoggedIn = true
        store.backendToken = "new-session-value"
        store.toastMessage = nil

        let newTask = Task { @MainActor in
            await store.submitSafetyReport(draft: makeDraft(), imageData: [], blockUserID: nil)
        }
        await fulfillment(of: [newStarted], timeout: 2)
        oldRelease.signal()
        _ = await oldTask.value

        XCTAssertTrue(store.isSubmittingSafetyReport)
        XCTAssertFalse(store.safetyReports.contains { $0.id == "rp-old" })

        newRelease.signal()
        let newResult = await newTask.value
        XCTAssertTrue(newResult)
        XCTAssertEqual(store.safetyReports.map(\.id), ["rp-new"])
    }

    @MainActor
    func testAcceptedReportSurvivesBlockFailureAndReturnsTrue() async {
        URLProtocolStub.setHandler { request in
            if request.url?.path == "/api/reports" {
                return .json(Self.reportEnvelope(reportID: "rp-accepted"))
            }
            return .json(statusCode: 500, #"{"error":"拉黑服务暂时不可用","code":"block_failed"}"#)
        }
        let store = makeStore()

        let result = await store.submitSafetyReport(
            draft: makeDraft(),
            imageData: [],
            blockUserID: "peer-user"
        )

        XCTAssertTrue(result)
        XCTAssertEqual(store.safetyReports.map(\.id), ["rp-accepted"])
        XCTAssertTrue(store.toastMessage?.contains("举报已提交，但拉黑失败") == true)
    }

    @MainActor
    func testAcceptedReportWithCurrentBlock401ExpiresSessionButReturnsTrue() async {
        URLProtocolStub.setHandler { request in
            if request.url?.path == "/api/reports" {
                return .json(Self.reportEnvelope(reportID: "rp-accepted"))
            }
            return .json(statusCode: 401, #"{"error":"登录状态已失效","code":"auth_expired"}"#)
        }
        let store = makeStore()

        let result = await store.submitSafetyReport(
            draft: makeDraft(),
            imageData: [],
            blockUserID: "peer-user"
        )

        XCTAssertTrue(result)
        XCTAssertEqual(store.safetyReports.map(\.id), ["rp-accepted"])
        XCTAssertFalse(store.isLoggedIn)
        XCTAssertNil(store.backendToken)
        XCTAssertTrue(store.isAuthPromptPresented)
        XCTAssertTrue(store.toastMessage?.contains("举报已提交") == true)
        XCTAssertTrue(store.toastMessage?.contains("登录已失效") == true)
        XCTAssertTrue(store.toastMessage?.contains("拉黑") == true)
    }

    @MainActor
    func testAcceptedReportWithOldSessionBlock401DoesNotExpireOrOverrideNewSession() async throws {
        let started = expectation(description: "old block started")
        let release = DispatchSemaphore(value: 0)
        URLProtocolStub.setHandler { request in
            if request.url?.path == "/api/reports" {
                return .json(Self.reportEnvelope(reportID: "rp-accepted"))
            }
            started.fulfill()
            _ = release.wait(timeout: .now() + 5)
            return .json(statusCode: 401, #"{"error":"登录状态已失效","code":"auth_expired"}"#)
        }
        let store = makeStore()

        let task = Task { @MainActor in
            await store.submitSafetyReport(
                draft: makeDraft(),
                imageData: [],
                blockUserID: "peer-user"
            )
        }
        await fulfillment(of: [started], timeout: 2)
        store.logOut()
        store.isLoggedIn = true
        store.backendToken = "new-session-value"
        store.toastMessage = "new-session-toast"
        store.isAuthPromptPresented = false
        release.signal()
        let result = await task.value

        XCTAssertTrue(result)
        XCTAssertTrue(store.isLoggedIn)
        XCTAssertEqual(store.backendToken, "new-session-value")
        XCTAssertEqual(store.toastMessage, "new-session-toast")
        XCTAssertFalse(store.isAuthPromptPresented)
    }

    @MainActor
    func testCurrentSubmit401ExpiresSession() async {
        URLProtocolStub.setHandler { _ in
            .json(statusCode: 401, #"{"error":"登录状态已失效","code":"auth_expired"}"#)
        }
        let store = makeStore()

        let result = await store.submitSafetyReport(draft: makeDraft(), imageData: [], blockUserID: nil)

        XCTAssertFalse(result)
        XCTAssertFalse(store.isLoggedIn)
        XCTAssertNil(store.backendToken)
        XCTAssertFalse(store.isSubmittingSafetyReport)
        XCTAssertTrue(store.safetyReports.isEmpty)
        XCTAssertTrue(store.isAuthPromptPresented)
        XCTAssertEqual(store.toastMessage, "登录已失效，请重新注册或登录")
    }

    @MainActor
    func testSubmit401PreservesSnapshotForSameUserLogin() async {
        URLProtocolStub.setHandler { _ in
            .json(statusCode: 401, #"{"error":"登录状态已失效","code":"auth_expired"}"#)
        }
        let store = makeStore()
        let snapshot = makeSnapshot(reporterUserID: store.currentUserID)
        store.saveSafetyReportFormSnapshot(snapshot)

        let result = await store.submitSafetyReport(draft: makeDraft(), imageData: [], blockUserID: nil)

        XCTAssertFalse(result)
        XCTAssertFalse(store.isLoggedIn)
        XCTAssertEqual(store.resumableSafetyReportFormSnapshot(for: snapshot.reporterUserID), snapshot)

        store.isLoggedIn = true
        XCTAssertEqual(store.resumableSafetyReportFormSnapshot(for: store.currentUserID), snapshot)
    }

    @MainActor
    func testDifferentBackendUserLoginPurgesExpiredReporterSnapshotPermanently() async {
        let loginCounter = LockedCounter()
        URLProtocolStub.setHandler { request in
            if request.url?.path == "/api/reports" {
                return .json(statusCode: 401, #"{"error":"登录状态已失效","code":"auth_expired"}"#)
            }
            let loginUserID = loginCounter.next() == 1 ? "user-b" : "u-me"
            return .json(Self.loginPayload(userID: loginUserID))
        }
        let store = makeStore()
        let reporterAID = store.currentUserID
        let snapshot = makeSnapshot(reporterUserID: reporterAID)
        store.saveSafetyReportFormSnapshot(snapshot)

        let submitResult = await store.submitSafetyReport(draft: makeDraft(), imageData: [], blockUserID: nil)
        XCTAssertFalse(submitResult)
        XCTAssertEqual(store.resumableSafetyReportFormSnapshot(for: reporterAID), snapshot)

        let userBLoginResult = await store.loginWithEmail(email: "b@example.com", password: "password-b")
        XCTAssertTrue(userBLoginResult)
        XCTAssertEqual(store.currentUserID, "user-b")
        XCTAssertFalse(store.hasSafetyReportFormSnapshot)
        XCTAssertNil(store.resumableSafetyReportFormSnapshot(for: reporterAID))
        XCTAssertNil(store.resumableSafetyReportFormSnapshot(for: "user-b"))

        let userALoginResult = await store.loginWithEmail(email: "a@example.com", password: "password-a")
        XCTAssertTrue(userALoginResult)
        XCTAssertEqual(store.currentUserID, reporterAID)
        XCTAssertNil(store.resumableSafetyReportFormSnapshot(for: reporterAID))
        store.stopBackendAutoRefresh()
    }

    @MainActor
    func testIncrementalEvidenceCommitSurvives401AndMidBatchCancellation() async {
        URLProtocolStub.setHandler { _ in
            .json(statusCode: 401, #"{"error":"登录状态已失效","code":"auth_expired"}"#)
        }
        let firstCommitted = expectation(description: "first normalized image committed")
        let secondStarted = expectation(description: "second image load started")
        let store = makeStore()
        let initialSnapshot = makeSnapshot(reporterUserID: store.currentUserID)
        var buffer = SafetyReportEvidenceBuffer()
        let generation = buffer.beginLoading()
        store.saveSafetyReportFormSnapshot(
            snapshot(initialSnapshot, replacingEvidence: buffer)
        )

        let batchTask = Task { @MainActor in
            await SafetyReportEvidenceBatchLoader.load(
                items: [1, 2],
                load: { index in
                    if index == 1 {
                        return Data([0xAA, 0xBB])
                    }
                    secondStarted.fulfill()
                    try await Task.sleep(nanoseconds: 5_000_000_000)
                    return Data([0xCC])
                },
                didLoad: { data in
                    let isCurrentGeneration = buffer.commitLoadedData(data, generation: generation)
                    guard isCurrentGeneration else { return false }
                    store.saveSafetyReportFormSnapshot(
                        self.snapshot(initialSnapshot, replacingEvidence: buffer)
                    )
                    firstCommitted.fulfill()
                    return true
                },
                didFinish: { selectedCount, failedCount in
                    _ = buffer.finishIncrementalLoading(
                        generation: generation,
                        selectedCount: selectedCount,
                        failedCount: failedCount
                    )
                    store.saveSafetyReportFormSnapshot(
                        self.snapshot(initialSnapshot, replacingEvidence: buffer)
                    )
                }
            )
        }

        await fulfillment(of: [firstCommitted, secondStarted], timeout: 2)
        let submitResult = await store.submitSafetyReport(
            draft: makeDraft(clientRequestID: initialSnapshot.clientRequestID),
            imageData: [],
            blockUserID: nil
        )

        XCTAssertFalse(submitResult)
        XCTAssertFalse(store.isLoggedIn)
        let resumed = store.resumableSafetyReportFormSnapshot(for: initialSnapshot.reporterUserID)
        XCTAssertEqual(resumed?.source, initialSnapshot.source)
        XCTAssertEqual(resumed?.reason, initialSnapshot.reason)
        XCTAssertEqual(resumed?.reportedField, initialSnapshot.reportedField)
        XCTAssertEqual(resumed?.detail, initialSnapshot.detail)
        XCTAssertEqual(resumed?.blockReportedUser, initialSnapshot.blockReportedUser)
        XCTAssertEqual(resumed?.clientRequestID, initialSnapshot.clientRequestID)
        XCTAssertEqual(resumed?.evidence.items.map(\.data), [Data([0xAA, 0xBB])])

        batchTask.cancel()
        await batchTask.value
        XCTAssertEqual(
            store.resumableSafetyReportFormSnapshot(for: initialSnapshot.reporterUserID)?.evidence.items.map(\.data),
            [Data([0xAA, 0xBB])]
        )
    }

    @MainActor
    func testManualLogoutClearsSavedSafetyReportSnapshot() {
        let store = makeStore()
        store.saveSafetyReportFormSnapshot(makeSnapshot(reporterUserID: store.currentUserID))

        store.logOut()

        XCTAssertNil(store.resumableSafetyReportFormSnapshot(for: "u-me"))
    }

    @MainActor
    func testAcceptedSubmissionClearsSavedSafetyReportSnapshot() async {
        URLProtocolStub.setHandler { _ in
            .json(Self.reportEnvelope(reportID: "rp-accepted"))
        }
        let store = makeStore()
        store.saveSafetyReportFormSnapshot(makeSnapshot(reporterUserID: store.currentUserID))

        let result = await store.submitSafetyReport(draft: makeDraft(), imageData: [], blockUserID: nil)

        XCTAssertTrue(result)
        XCTAssertNil(store.resumableSafetyReportFormSnapshot(for: "u-me"))
    }

    func testReportResumeDecisionWaitsForAuthenticationCoverToClose() {
        let snapshot = makeSnapshot(reporterUserID: "u-me")
        let cases: [(loggedIn: Bool, userID: String, authCover: Bool, reportPresented: Bool, expected: Bool)] = [
            (false, "u-me", false, false, false),
            (true, "different-user", false, false, false),
            (true, "u-me", true, false, false),
            (true, "u-me", false, true, false),
            (true, "u-me", false, false, true)
        ]

        for testCase in cases {
            XCTAssertEqual(
                SafetyReportResumeDecision.shouldPresent(
                    snapshot: snapshot,
                    isLoggedIn: testCase.loggedIn,
                    currentUserID: testCase.userID,
                    isAuthPromptPresented: testCase.authCover,
                    isReportPresented: testCase.reportPresented
                ),
                testCase.expected
            )
        }
    }

    func testReportResumeActionDiscardsPendingStateForAuthenticatedIdentityMismatch() {
        let snapshot = makeSnapshot(reporterUserID: "user-a")

        XCTAssertEqual(
            SafetyReportResumeDecision.action(
                isPending: true,
                snapshot: snapshot,
                isLoggedIn: true,
                currentUserID: "user-b",
                isAuthPromptPresented: false,
                isReportPresented: false
            ),
            .discard
        )
        XCTAssertEqual(
            SafetyReportResumeDecision.action(
                isPending: true,
                snapshot: nil,
                isLoggedIn: true,
                currentUserID: "user-b",
                isAuthPromptPresented: false,
                isReportPresented: false
            ),
            .discard
        )
        XCTAssertEqual(
            SafetyReportResumeDecision.action(
                isPending: true,
                snapshot: snapshot,
                isLoggedIn: true,
                currentUserID: "user-a",
                isAuthPromptPresented: false,
                isReportPresented: false
            ),
            .present(snapshot)
        )
    }

    @MainActor
    func testCurrentPresign401ExpiresSession() async {
        URLProtocolStub.setHandler { _ in
            .json(statusCode: 401, #"{"error":"登录状态已失效","code":"auth_expired"}"#)
        }
        let store = makeStore()

        let result = await store.submitSafetyReport(
            draft: makeDraft(),
            imageData: [Data([0x01])],
            blockUserID: nil
        )

        XCTAssertFalse(result)
        XCTAssertFalse(store.isLoggedIn)
        XCTAssertNil(store.backendToken)
        XCTAssertTrue(store.isAuthPromptPresented)
        XCTAssertEqual(store.toastMessage, "登录已失效，请重新注册或登录")
    }

    @MainActor
    func testOldPresign401DoesNotExpireNewSession() async throws {
        let started = expectation(description: "old presign started")
        let release = DispatchSemaphore(value: 0)
        URLProtocolStub.setHandler { request in
            if request.url?.path == "/api/uploads/presign" {
                started.fulfill()
                _ = release.wait(timeout: .now() + 5)
                return .json(statusCode: 401, #"{"error":"登录状态已失效","code":"auth_expired"}"#)
            }
            return .json(#"{}"#)
        }
        let store = makeStore()

        let task = Task { @MainActor in
            await store.submitSafetyReport(
                draft: makeDraft(),
                imageData: [Data([0x01])],
                blockUserID: nil
            )
        }
        await fulfillment(of: [started], timeout: 2)
        store.logOut()
        store.isLoggedIn = true
        store.backendToken = "new-session-value"
        store.toastMessage = nil
        release.signal()
        let result = await task.value

        XCTAssertFalse(result)
        XCTAssertTrue(store.isLoggedIn)
        XCTAssertEqual(store.backendToken, "new-session-value")
        XCTAssertNil(store.toastMessage)
    }

    @MainActor
    func testCurrentUpload401ExpiresSession() async {
        URLProtocolStub.setHandler { request in
            if request.url?.path == "/api/uploads/presign" {
                return .json(#"{"objectKey":"report/object.jpg","uploadUrl":"https://upload.invalid/object"}"#)
            }
            return .json(statusCode: 401, #"{"error":"登录状态已失效","code":"auth_expired"}"#)
        }
        let store = makeStore()

        let result = await store.submitSafetyReport(
            draft: makeDraft(),
            imageData: [Data([0x01])],
            blockUserID: nil
        )

        XCTAssertFalse(result)
        XCTAssertFalse(store.isLoggedIn)
        XCTAssertNil(store.backendToken)
        XCTAssertTrue(store.isAuthPromptPresented)
        XCTAssertEqual(store.toastMessage, "登录已失效，请重新注册或登录")
    }

    @MainActor
    func testOldUpload401DoesNotExpireNewSession() async throws {
        let started = expectation(description: "old upload started")
        let release = DispatchSemaphore(value: 0)
        URLProtocolStub.setHandler { request in
            if request.url?.path == "/api/uploads/presign" {
                return .json(#"{"objectKey":"report/object.jpg","uploadUrl":"https://upload.invalid/object"}"#)
            }
            if request.url?.absoluteString == "https://upload.invalid/object" {
                started.fulfill()
                _ = release.wait(timeout: .now() + 5)
                return .json(statusCode: 401, #"{"error":"登录状态已失效","code":"auth_expired"}"#)
            }
            return .json(#"{}"#)
        }
        let store = makeStore()

        let task = Task { @MainActor in
            await store.submitSafetyReport(
                draft: makeDraft(),
                imageData: [Data([0x01])],
                blockUserID: nil
            )
        }
        await fulfillment(of: [started], timeout: 2)
        store.logOut()
        store.isLoggedIn = true
        store.backendToken = "new-session-value"
        store.toastMessage = nil
        release.signal()
        let result = await task.value

        XCTAssertFalse(result)
        XCTAssertTrue(store.isLoggedIn)
        XCTAssertEqual(store.backendToken, "new-session-value")
        XCTAssertNil(store.toastMessage)
    }

    @MainActor
    func testOldSubmit401DoesNotExpireNewSession() async throws {
        let started = expectation(description: "old submit started")
        let release = DispatchSemaphore(value: 0)
        URLProtocolStub.setHandler { _ in
            started.fulfill()
            _ = release.wait(timeout: .now() + 5)
            return .json(statusCode: 401, #"{"error":"登录状态已失效","code":"auth_expired"}"#)
        }
        let store = makeStore()

        let task = Task { @MainActor in
            await store.submitSafetyReport(draft: makeDraft(), imageData: [], blockUserID: nil)
        }
        await fulfillment(of: [started], timeout: 2)
        store.logOut()
        store.isLoggedIn = true
        store.backendToken = "new-session-value"
        store.toastMessage = nil
        release.signal()
        _ = await task.value

        XCTAssertTrue(store.isLoggedIn)
        XCTAssertNotNil(store.backendToken)
        XCTAssertNil(store.toastMessage)
    }

    @MainActor
    func testCurrentMyReports401MakesSyncFailAndExpiresSessionSilently() async {
        URLProtocolStub.setHandler { request in
            if request.url?.path == "/api/sync" {
                return .json(Self.safetySyncPayload)
            }
            return .json(statusCode: 401, #"{"error":"登录状态已失效","code":"auth_expired"}"#)
        }
        let store = makeStore()
        SyncCursorStore.set("cursor-before", for: store.currentUserID)

        let result = await store.syncFromBackend(reason: "quality-test")

        XCTAssertFalse(result)
        XCTAssertFalse(store.isLoggedIn)
        XCTAssertNil(store.backendToken)
        XCTAssertFalse(store.isAuthPromptPresented)
        XCTAssertNil(store.toastMessage)
    }

    @MainActor
    func testSilentRefresh401ExpiresSessionWithoutPromptOrToast() async {
        URLProtocolStub.setHandler { _ in
            .json(statusCode: 401, #"{"error":"登录状态已失效","code":"auth_expired"}"#)
        }
        let store = makeStore()

        let result = await store.refreshFromBackend(silent: true)

        XCTAssertFalse(result)
        XCTAssertFalse(store.isLoggedIn)
        XCTAssertNil(store.backendToken)
        XCTAssertFalse(store.isAuthPromptPresented)
        XCTAssertNil(store.toastMessage)
    }

    @MainActor
    func testSilentSync401DuringSuppressionDoesNotExpireCurrentSession() async {
        URLProtocolStub.setHandler { request in
            if request.url?.path == "/api/users/peer-user/block" {
                return .json(statusCode: 500, #"{"error":"拉黑失败","code":"block_failed"}"#)
            }
            if request.url?.path == "/api/sync" {
                return .json(statusCode: 401, #"{"error":"登录状态已失效","code":"auth_expired"}"#)
            }
            return .json(#"{}"#)
        }
        let store = makeStore()
        SyncCursorStore.set("cursor-before", for: store.currentUserID)

        await store.blockUser("peer-user")
        store.toastMessage = nil
        store.isAuthPromptPresented = false

        let result = await store.syncFromBackend(reason: "quality-test")

        XCTAssertFalse(result)
        XCTAssertTrue(store.isLoggedIn)
        XCTAssertEqual(store.backendToken, "current-session-value")
        XCTAssertFalse(store.isAuthPromptPresented)
        XCTAssertNil(store.toastMessage)
    }

    @MainActor
    func testSafetyReportUpdatedRetryKeepsCursorUntilRefreshSucceeds() async {
        let syncQueries = LockedArray<String>()
        let reportCalls = LockedCounter()
        URLProtocolStub.setHandler { request in
            switch request.url?.path {
            case "/api/sync":
                let cursor = URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?
                    .queryItems?
                    .first(where: { $0.name == "cursor" })?
                    .value ?? ""
                syncQueries.append(cursor)
                if cursor == "cursor-before" {
                    return .json(Self.safetySyncPayload)
                }
                return .json(
                    """
                    {
                      "nextCursor": "cursor-final",
                      "hasMore": false,
                      "events": [],
                      "messageThreads": [],
                      "unreadMessageCount": 0
                    }
                    """
                )
            case "/api/me/reports":
                if reportCalls.next() == 1 {
                    return .json(statusCode: 500, #"{"error":"举报列表暂时不可用","code":"reports_unavailable"}"#)
                }
                return .json(
                    """
                    {
                      "reports": [
                        {
                          "id": "rp-123e4567-e89b-12d3-a456-426614174000",
                          "caseID": "case-1",
                          "sourceType": "post",
                          "sourceID": "post-1",
                          "subjectType": "post",
                          "subjectID": "post-1",
                          "reasonCode": "other",
                          "reportedField": "content",
                          "detail": "details",
                          "status": "reviewing",
                          "createdAt": "2026-07-11T01:00:00.000Z",
                          "updatedAt": "2026-07-11T02:00:00.000Z"
                        }
                      ]
                    }
                    """
                )
            default:
                return .json(#"{}"#)
            }
        }
        let store = makeStore()
        SyncCursorStore.set("cursor-before", for: store.currentUserID)

        let firstResult = await store.syncFromBackend(reason: "quality-test")
        XCTAssertFalse(firstResult)
        XCTAssertEqual(SyncCursorStore.cursor(for: store.currentUserID), "cursor-before")

        let secondResult = await store.syncFromBackend(reason: "quality-test.retry")
        XCTAssertTrue(secondResult)
        XCTAssertEqual(syncQueries.values, ["cursor-before", "cursor-before"])
        XCTAssertEqual(SyncCursorStore.cursor(for: store.currentUserID), "cursor-after")
        XCTAssertEqual(
            store.safetyReports.map(\.id),
            ["rp-123e4567-e89b-12d3-a456-426614174000"]
        )
    }

    @MainActor
    func testOldMyReports401MakesOldSyncFailWithoutExpiringNewSession() async throws {
        let reportsStarted = expectation(description: "my reports started")
        let release = DispatchSemaphore(value: 0)
        URLProtocolStub.setHandler { request in
            if request.url?.path == "/api/sync" {
                return .json(Self.safetySyncPayload)
            }
            reportsStarted.fulfill()
            _ = release.wait(timeout: .now() + 5)
            return .json(statusCode: 401, #"{"error":"登录状态已失效","code":"auth_expired"}"#)
        }
        let store = makeStore()
        SyncCursorStore.set("cursor-before", for: store.currentUserID)

        let task = Task { @MainActor in
            await store.syncFromBackend(reason: "quality-test")
        }
        await fulfillment(of: [reportsStarted], timeout: 2)
        store.logOut()
        store.isLoggedIn = true
        store.backendToken = "new-session-value"
        store.toastMessage = nil
        release.signal()
        let result = await task.value

        XCTAssertFalse(result)
        XCTAssertTrue(store.isLoggedIn)
        XCTAssertNotNil(store.backendToken)
        XCTAssertNil(store.toastMessage)
    }

    @MainActor
    func testMergeRejectsOlderMalformedAndEqualTimestampUpdatesDeterministically() {
        let store = makeStore()
        let local = makeReport(
            id: "rp-merge",
            status: .handled,
            createdAt: "2026-07-11T01:00:00.000Z",
            updatedAt: "2026-07-11T02:00:00.000Z"
        )
        store.mergeSafetyReports([local])

        store.mergeSafetyReports([
            makeReport(id: "rp-merge", status: .reviewing, updatedAt: "2026-07-11T01:30:00.000Z"),
            makeReport(id: "rp-merge", status: .received, updatedAt: "not-a-date"),
            makeReport(id: "rp-merge", status: .noViolation, updatedAt: local.updatedAt)
        ])

        XCTAssertEqual(store.safetyReports.first?.status, .handled)

        let firstEqual = makeReport(id: "rp-equal-a", status: .received, updatedAt: local.updatedAt)
        let secondEqual = makeReport(id: "rp-equal-b", status: .received, updatedAt: local.updatedAt)
        let malformed = makeReport(id: "rp-malformed", status: .received, updatedAt: "invalid")
        store.mergeSafetyReports([firstEqual, secondEqual, malformed])

        XCTAssertEqual(
            store.safetyReports.map(\.id),
            ["rp-merge", "rp-equal-a", "rp-equal-b", "rp-malformed"]
        )
    }

    private func makeClient() -> AliyunBackendClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        return AliyunBackendClient(
            baseURLString: "https://unit-test.invalid/api",
            session: URLSession(configuration: configuration)
        )
    }

    @MainActor
    private func makeStore() -> MockAppStore {
        let store = MockAppStore(backendClient: makeClient())
        store.isLoggedIn = true
        store.backendToken = "current-session-value"
        store.toastMessage = nil
        return store
    }

    private func makeDraft(clientRequestID: String = UUID().uuidString) -> SafetyReportDraft {
        SafetyReportDraft(
            clientRequestID: clientRequestID,
            sourceType: .post,
            sourceID: "post-1",
            reasonCode: .other,
            reportedField: .content,
            detail: "details",
            objectKeys: []
        )
    }

    private func makeSnapshot(reporterUserID: String) -> SafetyReportFormSnapshot {
        SafetyReportFormSnapshot(
            reporterUserID: reporterUserID,
            source: SafetyReportSource(
                type: .post,
                id: "post-1",
                title: "需要恢复的举报",
                ownerUserID: "peer-user",
                collectionID: nil,
                peerUserID: nil
            ),
            reason: .other,
            reportedField: .content,
            detail: "已编辑详情",
            evidence: SafetyReportEvidenceBuffer(items: [SafetyReportEvidenceItem(data: Data([0x01, 0x02, 0x03]))]),
            blockReportedUser: false,
            clientRequestID: "request-resume-quality"
        )
    }

    private func snapshot(
        _ snapshot: SafetyReportFormSnapshot,
        replacingEvidence evidence: SafetyReportEvidenceBuffer
    ) -> SafetyReportFormSnapshot {
        SafetyReportFormSnapshot(
            reporterUserID: snapshot.reporterUserID,
            source: snapshot.source,
            reason: snapshot.reason,
            reportedField: snapshot.reportedField,
            detail: snapshot.detail,
            evidence: evidence,
            blockReportedUser: snapshot.blockReportedUser,
            clientRequestID: snapshot.clientRequestID
        )
    }

    private func makeReport(
        id: String,
        status: SafetyReportStatus,
        createdAt: String = "2026-07-11T01:00:00.000Z",
        updatedAt: String
    ) -> SafetyReport {
        SafetyReport(
            id: id,
            caseID: "case-1",
            sourceType: .post,
            sourceID: "post-1",
            subjectType: .post,
            subjectID: "post-1",
            reasonCode: .other,
            reportedField: .content,
            detail: "details",
            status: status,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }

    private var messageThreadsStorageURL: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("zhoubiantuan-message-threads.json")
    }

    private static func reportEnvelope(reportID: String) -> String {
        """
        {
          "report": {
            "id": "\(reportID)",
            "caseID": "case-1",
            "sourceType": "post",
            "sourceID": "post-1",
            "subjectType": "post",
            "subjectID": "post-1",
            "reasonCode": "other",
            "reportedField": "content",
            "detail": "details",
            "status": "received",
            "createdAt": "2026-07-11T01:00:00.000Z",
            "updatedAt": "2026-07-11T01:00:00.000Z"
          },
          "duplicate": false
        }
        """
    }

    private static func loginPayload(userID: String) -> String {
        """
        {
          "token": "token-\(userID)",
          "currentUser": {
            "id": "\(userID)",
            "email": "\(userID)@example.com",
            "nickname": "\(userID)",
            "bio": "",
            "followingCount": 0,
            "followersCount": 0,
            "postCount": 0,
            "isRestricted": false,
            "canShowContact": true,
            "avatarSymbol": "person.circle.fill",
            "avatarTint": "rose",
            "redBookID": "",
            "gender": "未设置",
            "birthday": "选择生日",
            "region": "未设置",
            "backgroundImageName": "merch_magazine"
          }
        }
        """
    }

    private static let safetySyncPayload = """
    {
      "nextCursor": "cursor-after",
      "hasMore": false,
      "events": [
        {
          "id": "event-1",
          "userID": "u-me",
          "eventType": "safety.report.updated",
          "entityType": "report",
          "entityID": "rp-sync",
          "threadID": null,
          "createdAt": "2026-07-11T01:00:00.000Z"
        }
      ],
      "messageThreads": [],
      "unreadMessageCount": 0
    }
    """
}
