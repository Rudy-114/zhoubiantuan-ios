# iOS Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give iOS users one consistent, production-backed report flow for posts, comments, users, direct messages, and collections, with collection-scope confirmation, optional evidence, default personal blocking for user/message reports, and a My Reports status view.

**Architecture:** Keep safety wire models and validation-free presentation data in `SafetyModels.swift`, networking in `BackendClient`, orchestration in `MockAppStore`, and UI in focused safety views. A single `ReportSheet` receives a typed source and generates one persistent `clientRequestID`; every entry point presents that sheet rather than duplicating forms.

**Tech Stack:** SwiftUI, PhotosUI, Foundation, existing `AliyunBackendClient`, Swift Package tests for pure Codable contracts, iOS 17 deployment target.

## Global Constraints

- The five target raw values are exactly `post`, `comment`, `user`, `direct_message`, and `collection`.
- A report retry reuses the same UUID until the server accepts it.
- `invalid_contact` requires a concrete shared field and detail.
- `other` requires detail.
- Post reports that select a collection field show a confirmation that the whole collection is the case subject.
- User and incoming-message reports default “同时屏蔽此用户” to on; blocking remains a separate immediate personal action.
- A user cannot report their own post, comment, profile, collection, or outgoing message.
- Report submission closes the sheet only on server acceptance; errors preserve the draft and attachments.
- No admin route, password, evidence body, internal risk score, or other reporter count appears in the consumer app.

---

### Task 1: Add Codable Safety Models and Wire Contract Tests

**Files:**
- Modify: `ZhouBianTuan/SafetyModels.swift`
- Create: `ZhouBianTuanCoreTests/SafetyModelsTests.swift`
- Modify: `ZhouBianTuan/Models.swift:293-355,400-415`

**Interfaces:**
- Produces: `SafetyTargetType`, `SafetyReasonCode`, `SafetyReportedField`, `SafetyReportDraft`, `SafetyReport`, and `SafetyReportStatus`.
- Consumes: `Package.swift` source list created in Phase 1.

- [ ] **Step 1: Write failing encode/decode tests**

```swift
import XCTest
@testable import ZhouBianTuanCore

final class SafetyModelsTests: XCTestCase {
    func testDraftUsesBackendFieldNames() throws {
        let draft = SafetyReportDraft(
            clientRequestID: "request-1",
            sourceType: .post,
            sourceID: "p-1",
            reasonCode: .invalidContact,
            reportedField: .contactWechat,
            detail: "无法搜索",
            objectKeys: []
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(draft)) as? [String: Any])
        XCTAssertEqual(object["clientRequestID"] as? String, "request-1")
        XCTAssertEqual(object["sourceType"] as? String, "post")
        XCTAssertEqual(object["reasonCode"] as? String, "invalid_contact")
        XCTAssertEqual(object["reportedField"] as? String, "contact_wechat")
    }

    func testReportDecodesUserVisibleStatusOnly() throws {
        let data = Data(#"{"id":"rp-1","caseID":"sc-1","sourceType":"post","sourceID":"p-1","subjectType":"collection","subjectID":"col-1","reasonCode":"invalid_contact","reportedField":"contact_wechat","detail":"无法搜索","status":"reviewing","createdAt":"2026-07-10T10:00:00.000Z","updatedAt":"2026-07-10T10:01:00.000Z"}"#.utf8)
        let report = try JSONDecoder().decode(SafetyReport.self, from: data)
        XCTAssertEqual(report.subjectType, .collection)
        XCTAssertEqual(report.status, .reviewing)
    }
}
```

- [ ] **Step 2: Run and verify compile failure**

```bash
swift test --package-path .
```

Expected: FAIL because the safety types do not exist.

- [ ] **Step 3: Implement the closed wire enums**

```swift
import Foundation

public enum SafetyTargetType: String, Codable, CaseIterable, Sendable {
    case post
    case comment
    case user
    case directMessage = "direct_message"
    case collection
}

public enum SafetyReasonCode: String, Codable, CaseIterable, Sendable {
    case suspectedScam = "suspected_scam"
    case falseOrExpiredGroupBuy = "false_or_expired_group_buy"
    case invalidContact = "invalid_contact"
    case copyrightOrStolenMedia = "copyright_or_stolen_media"
    case harassmentOrAbuse = "harassment_or_abuse"
    case sexualOrIllegal = "sexual_or_illegal"
    case spamOrAdvertising = "spam_or_advertising"
    case directMessageRisk = "direct_message_risk"
    case other
}

public enum SafetyReportedField: String, Codable, CaseIterable, Sendable {
    case content
    case contactWechat = "contact_wechat"
    case contactQQ = "contact_qq"
    case contactGroupNumber = "contact_group_number"
    case collectionDeadline = "collection_deadline"
    case collectionDescription = "collection_description"
    case collectionDefaultNote = "collection_default_note"
}

public enum SafetyReportStatus: String, Codable, Sendable {
    case received
    case reviewing
    case handled
    case noViolation = "no_violation"
}
```

Add localized computed labels in an app-only extension in `Models.swift`, not to the wire raw values.

- [ ] **Step 4: Implement exact request and response structs**

```swift
public struct SafetyReportDraft: Codable, Equatable, Sendable {
    public let clientRequestID: String
    public let sourceType: SafetyTargetType
    public let sourceID: String
    public let reasonCode: SafetyReasonCode
    public let reportedField: SafetyReportedField
    public let detail: String
    public let objectKeys: [String]

    public init(clientRequestID: String = UUID().uuidString, sourceType: SafetyTargetType, sourceID: String, reasonCode: SafetyReasonCode, reportedField: SafetyReportedField = .content, detail: String, objectKeys: [String]) {
        self.clientRequestID = clientRequestID
        self.sourceType = sourceType
        self.sourceID = sourceID
        self.reasonCode = reasonCode
        self.reportedField = reportedField
        self.detail = detail
        self.objectKeys = objectKeys
    }
}

public struct SafetyReport: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let caseID: String
    public let sourceType: SafetyTargetType
    public let sourceID: String
    public let subjectType: SafetyTargetType
    public let subjectID: String
    public let reasonCode: SafetyReasonCode
    public let reportedField: SafetyReportedField
    public let detail: String
    public let status: SafetyReportStatus
    public let createdAt: String
    public let updatedAt: String
}

public struct SafetyReportResponse: Codable, Sendable {
    public let report: SafetyReport
    public let duplicate: Bool
}

public struct SafetyReportsResponse: Codable, Sendable {
    public let reports: [SafetyReport]
}
```

- [ ] **Step 5: Remove the obsolete two-target `ReportTarget` assumptions**

Keep existing prototype `Report` only while old bootstrap compatibility is needed. Add adapters from a `SafetyReport` to display data, and stop adding new entries to the local prototype array when the backend is enabled. Do not make `SafetyReportStatus` reuse admin action statuses such as hidden or warned. Add backward-compatible app model fields: `GroupBuyPost.contactVisibility`, `GroupCollection.contactVisibility`, and `DirectMessage.isSafetyHidden`; defaults are `active`, `active`, and `false` when old local data lacks them.

- [ ] **Step 6: Run tests and commit**

```bash
swift test --package-path .
git add ZhouBianTuan/SafetyModels.swift ZhouBianTuanCoreTests/SafetyModelsTests.swift ZhouBianTuan/Models.swift
git commit -m "Add iOS safety report contracts"
```

### Task 2: Add Report Networking and Store Orchestration

**Files:**
- Modify: `ZhouBianTuan/BackendClient.swift:1-925`
- Modify: `ZhouBianTuan/MockAppStore.swift:1-30,470-490,1104-1190,1310-1370,1450-1470`
- Create: `ZhouBianTuanCoreTests/SafetyDraftLifecycleTests.swift`

**Interfaces:**
- Produces: `submitReport(token:draft:)`, `appendReportEvidence(token:reportID:clientRequestID:objectKeys:detail:)`, `myReports(token:)`, `uploadReportImages(token:images:)`, and store `submitSafetyReport`.

- [ ] **Step 1: Add a failing draft-lifecycle test**

Create a pure `SafetyReportDraftState` in `SafetyModels.swift` and test that retry preserves ID while reset creates a new ID:

```swift
func testRetryKeepsClientRequestIDUntilAccepted() {
    var state = SafetyReportDraftState(sourceType: .post, sourceID: "p-1")
    let first = state.clientRequestID
    state.markFailed()
    XCTAssertEqual(state.clientRequestID, first)
    state.markAccepted()
    XCTAssertNotEqual(state.clientRequestID, first)
}
```

- [ ] **Step 2: Implement request methods using the existing injected session**

Add an Encodable request overload to `AliyunBackendClient` so safety payloads do not round-trip through `[String: Any]`:

```swift
func submitReport(token: String, draft: SafetyReportDraft) async throws -> SafetyReportResponse {
    try await encodedRequest("/reports", method: "POST", token: token, body: draft)
}

func appendReportEvidence(token: String, reportID: String, clientRequestID: String, objectKeys: [String], detail: String) async throws -> SafetyReportResponse {
    try await encodedRequest("/reports/\(reportID)/evidence", method: "POST", token: token, body: SafetyEvidenceSupplement(clientRequestID: clientRequestID, detail: detail, objectKeys: objectKeys))
}

func myReports(token: String) async throws -> [SafetyReport] {
    let response: SafetyReportsResponse = try await request("/me/reports", token: token)
    return response.reports
}

func uploadReportImages(token: String, images: [Data]) async throws -> [String] {
    try await uploadImages(token: token, images: images, kind: "report", filenamePrefix: "report-evidence")
}
```

The generic encoder must preserve existing status/error parsing and set `Content-Type: application/json`.

Decode backend `safetyStatus`, `contactVisibility`, and `isSafetyHidden` fields. Map safety-hidden posts/collections into owner-visible attention state without overwriting their local IDs or interaction data; preserve the separate contact/message flags so the UI can explain a safety restriction instead of pretending data is empty or revoked.

- [ ] **Step 3: Add store state and submission orchestration**

```swift
@Published var safetyReports: [SafetyReport] = []
@Published var isSubmittingSafetyReport = false

func submitSafetyReport(draft: SafetyReportDraft, imageData: [Data], blockUserID: String?) async -> Bool {
    guard requireLogin(prompt: "登录后才能举报"), let backendToken else { return false }
    guard !isSubmittingSafetyReport else { return false }
    isSubmittingSafetyReport = true
    defer { isSubmittingSafetyReport = false }
    do {
        let objectKeys = try await backendClient.uploadReportImages(token: backendToken, images: imageData)
        let wireDraft = SafetyReportDraft(clientRequestID: draft.clientRequestID, sourceType: draft.sourceType, sourceID: draft.sourceID, reasonCode: draft.reasonCode, reportedField: draft.reportedField, detail: draft.detail, objectKeys: objectKeys)
        let response = try await backendClient.submitReport(token: backendToken, draft: wireDraft)
        mergeSafetyReports([response.report])
        if let blockUserID, !isBlocked(blockUserID) { await blockUserAndWait(blockUserID) }
        showToast(response.duplicate ? "该问题已在处理中" : "举报已提交")
        return true
    } catch {
        showToast(error.localizedDescription)
        return false
    }
}
```

Implement `blockUserAndWait` with the existing backend block endpoint and local state, without treating block failure as report failure after the report was accepted.

- [ ] **Step 4: Refresh My Reports on bootstrap and safety sync events**

Decode the new report shape from bootstrap when present. On `safety.report.updated`, call `myReports`; on foreground bootstrap, merge rather than replace a newer in-flight accepted report.

- [ ] **Step 5: Run tests, build, and commit**

```bash
swift test --package-path .
xcodebuild -project ZhouBianTuan.xcodeproj -scheme ZhouBianTuan -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO build
git add ZhouBianTuan/BackendClient.swift ZhouBianTuan/MockAppStore.swift ZhouBianTuan/SafetyModels.swift ZhouBianTuanCoreTests/SafetyDraftLifecycleTests.swift
git commit -m "Connect iOS safety report APIs"
```

### Task 3: Build One Complete Report Sheet

**Files:**
- Create: `ZhouBianTuan/ReportViews.swift`
- Modify: `ZhouBianTuan.xcodeproj/project.pbxproj`
- Modify: `ZhouBianTuan/CommonComponents.swift`

**Interfaces:**
- Produces: `SafetyReportSource` and `ReportSheet(source:onAccepted:)`.
- Consumes: store `submitSafetyReport` and the safety model enums.

- [ ] **Step 1: Define typed presentation context**

```swift
struct SafetyReportSource: Identifiable, Equatable {
    let type: SafetyTargetType
    let id: String
    let title: String
    let ownerUserID: String
    let collectionID: String?
    let peerUserID: String?

    var canOfferBlock: Bool { type == .user || type == .directMessage }
}
```

- [ ] **Step 2: Implement reason filtering and field selection**

Reason choices:

```swift
extension SafetyReportSource {
    var allowedReasons: [SafetyReasonCode] {
        switch type {
        case .directMessage: [.suspectedScam, .harassmentOrAbuse, .sexualOrIllegal, .spamOrAdvertising, .directMessageRisk, .other]
        case .comment: [.suspectedScam, .harassmentOrAbuse, .sexualOrIllegal, .spamOrAdvertising, .other]
        case .user: [.suspectedScam, .copyrightOrStolenMedia, .harassmentOrAbuse, .sexualOrIllegal, .spamOrAdvertising, .other]
        case .collection: [.suspectedScam, .falseOrExpiredGroupBuy, .invalidContact, .copyrightOrStolenMedia, .sexualOrIllegal, .spamOrAdvertising, .other]
        case .post: SafetyReasonCode.allCases.filter { $0 != .directMessageRisk }
        }
    }
}
```

When a post reason can concern shared information, show a menu of `content` plus collection fields only when `collectionID != nil`. For `invalid_contact`, require one of the three contact fields. For collection sources, map invalid contact to the selected contact field and other collection-wide reasons to `collection_description` or `collection_deadline` as selected.

- [ ] **Step 3: Implement form states and validation**

The sheet contains: target summary, reason menu, conditional field menu, 1000-character detail editor, up to six PhotosPicker evidence items, default-on block toggle when supported, collection-scope confirmation, submit progress, inline validation, and Cancel/Submit commands. Use 8px-or-smaller panel radii and stable button heights. Do not place page sections inside decorative cards.

The submit command must:

```swift
guard validationMessage == nil else { return }
if affectsCollection && !hasConfirmedCollectionScope {
    isCollectionConfirmationPresented = true
    return
}
let accepted = await store.submitSafetyReport(
    draft: currentDraft,
    imageData: evidenceData,
    blockUserID: blockUser ? source.peerUserID ?? source.ownerUserID : nil
)
if accepted { onAccepted(); dismiss() }
```

- [ ] **Step 4: Add previews for every target and dynamic type**

Add previews for post content, post shared contact, comment, user with block toggle, incoming message, and collection. Check the longest Chinese reason at accessibility text size without clipping.

- [ ] **Step 5: Register the file, build, and commit**

```bash
xcodebuild -project ZhouBianTuan.xcodeproj -scheme ZhouBianTuan -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO build
git add ZhouBianTuan/ReportViews.swift ZhouBianTuan/CommonComponents.swift ZhouBianTuan.xcodeproj/project.pbxproj
git commit -m "Build shared iOS report form"
```

### Task 4: Wire All Five Report Entry Points

**Files:**
- Modify: `ZhouBianTuan/PostDetailViews.swift:1-135`
- Modify: `ZhouBianTuan/PostDetailViews.swift:269-330,1150-1210`
- Modify: `ZhouBianTuan/ProfileViews.swift:1055-1117,2056-2235`
- Modify: `ZhouBianTuan/MessageViews.swift:515-555`

**Interfaces:**
- Consumes: `ReportSheet` and `SafetyReportSource`.

- [ ] **Step 1: Add the post menu without removing share**

Replace the standalone share icon with a familiar ellipsis `Menu` containing Share and Report. Owners see Share only. Present the report sheet with post ID, author ID, and collection ID.

- [ ] **Step 2: Add comment report to the existing action overlay**

For comments not authored by the current user, add a `CommentActionRow(title: "举报", systemImage: "exclamationmark.bubble", isDestructive: true, ...)`. Keep Reply and Copy. Owner deletion and report must be mutually clear commands.

- [ ] **Step 3: Add user report to the other-user profile header**

Add an ellipsis icon button in the top-right header. The menu includes Report User and the existing block/unblock command. Do not show it on the current user's own profile. Reporting defaults the block toggle on but does not force block.

- [ ] **Step 4: Add incoming-message report to the context menu**

In `ChatBubble`, show Report only when `!isMine && !message.isRevoked && !message.isDeletedForMe`. Pass message ID and peer ID. Keep Delete and sender-only Revoke behavior unchanged.

- [ ] **Step 5: Add collection report to the navigation toolbar**

In `CollectionDetailView`, add an ellipsis toolbar menu for non-owners. Present the collection report sheet with owner ID. Owners retain Edit and do not see Report.

- [ ] **Step 6: Render safety-specific hidden states**

When `DirectMessage.isSafetyHidden`, replace body/image/share content with “消息因安全审核暂不可见”; do not show Report, Copy, or Revoke on that safety-hidden row. When post or collection contact visibility is hidden, show “联系方式因安全审核暂不可见” and disable copy/open commands. These states are distinct from user revoke, deletion, moderation rejection, and an unfilled contact field.

- [ ] **Step 7: Build and perform five-entry simulator smoke**

Run:

```bash
xcodebuild -project ZhouBianTuan.xcodeproj -scheme ZhouBianTuan -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO build
```

On a simulator, open and dismiss all five report sheets, verify no menu clips, submit one post and one incoming-message report against the local backend, and confirm the incoming-message flow offers block by default.

- [ ] **Step 8: Commit entry points**

```bash
git add ZhouBianTuan/PostDetailViews.swift ZhouBianTuan/ProfileViews.swift ZhouBianTuan/MessageViews.swift ZhouBianTuan/Models.swift ZhouBianTuan/BackendClient.swift
git commit -m "Add five iOS report entry points"
```

### Task 5: Add My Reports

**Files:**
- Create: `ZhouBianTuan/MyReportsView.swift`
- Modify: `ZhouBianTuan/SettingsViews.swift:1-180`
- Modify: `ZhouBianTuan/ZhouBianTuanApp.swift:91-110,260-303`
- Modify: `ZhouBianTuan.xcodeproj/project.pbxproj`

**Interfaces:**
- Produces: `Route.myReports` and `MyReportsView`.

- [ ] **Step 1: Add the settings route**

Add a shield/checkmark row under account and safety settings labeled “我的举报”. Register `case myReports` and its navigation destination.

- [ ] **Step 2: Build the status list**

Use a plain list or unframed vertical rows with reason label, safe target summary, user-visible status, and updated date. Status copy is exactly: 已接收, 审核中, 已处理, 未发现明确违规. Never show `caseID`, reporter IDs, internal confidence, other report counts, or admin notes.

- [ ] **Step 3: Add loading, empty, refresh, and error states**

On task, call `myReports`. Add pull-to-refresh. Empty state says “还没有提交过举报”; errors preserve prior rows and show retry. Use a stable row height and allow reason text to wrap.

- [ ] **Step 4: Add evidence supplements for open reports**

Opening a `received` or `reviewing` row shows “补充证据”. The sheet accepts a new explanation and up to six images, uploads under `report/<current-user>/`, and calls `appendReportEvidence` with a new persistent supplement request UUID. Retry reuses that UUID; handled/no-violation reports are read-only. Successful supplement refreshes the existing row and never creates another report.

- [ ] **Step 5: Run all client checks and commit**

```bash
swift test --package-path .
xcodebuild -project ZhouBianTuan.xcodeproj -scheme ZhouBianTuan -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO build
git diff --check
git add ZhouBianTuan/MyReportsView.swift ZhouBianTuan/SettingsViews.swift ZhouBianTuan/ZhouBianTuanApp.swift ZhouBianTuan.xcodeproj/project.pbxproj
git commit -m "Add My Reports status view"
```

### Task 6: Verify the Real Two-Account Report Flow

**Files:**
- No source changes unless verification reveals a defect.

**Interfaces:**
- Uses the Phase 2 production-disabled or local backend and two existing test accounts.

- [ ] **Step 1: Run the local backend with safety intake enabled and AI off**

Use a non-production database and local OSS-compatible test setup. Verify `/api/health` before launching simulators.

- [ ] **Step 2: Exercise each target**

Account A reports B's post content, B's collection contact, B's comment, B's profile, and one incoming message. Verify server source/subject mapping, evidence counts, and user-visible statuses. Attempt own-content reports and verify the UI does not offer them and the server rejects crafted requests.

- [ ] **Step 3: Verify default block is independent**

Submit one message report with block on and one profile report with block off. Confirm both reports exist; only the first changes the block relation.

- [ ] **Step 4: Verify retries and offline state**

Disable network during submit, re-enable, retry, and verify one report row and one initial evidence row exist for the original `clientRequestID`.

- [ ] **Step 5: Capture verification facts without private content**

Record report IDs, target types, HTTP statuses, counts, and pass/fail only. Do not capture message bodies, credentials, JWTs, image evidence, or user emails.
