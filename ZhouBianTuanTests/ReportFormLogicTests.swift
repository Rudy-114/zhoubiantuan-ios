import XCTest
@testable import ZhouBianTuan

final class ReportFormLogicTests: XCTestCase {
    func testAllowedReasonsMatchPlanOrderForAllFiveSourceTypes() {
        XCTAssertEqual(
            makePostSource(collectionID: "collection-1").allowedReasons,
            [
                .suspectedScam,
                .falseOrExpiredGroupBuy,
                .invalidContact,
                .copyrightOrStolenMedia,
                .harassmentOrAbuse,
                .sexualOrIllegal,
                .spamOrAdvertising,
                .other
            ]
        )
        XCTAssertEqual(
            makeCommentSource().allowedReasons,
            [
                .suspectedScam,
                .harassmentOrAbuse,
                .sexualOrIllegal,
                .spamOrAdvertising,
                .other
            ]
        )
        XCTAssertEqual(
            makeUserSource().allowedReasons,
            [
                .suspectedScam,
                .copyrightOrStolenMedia,
                .harassmentOrAbuse,
                .sexualOrIllegal,
                .spamOrAdvertising,
                .other
            ]
        )
        XCTAssertEqual(
            makeDirectMessageSource().allowedReasons,
            [
                .suspectedScam,
                .harassmentOrAbuse,
                .sexualOrIllegal,
                .spamOrAdvertising,
                .directMessageRisk,
                .other
            ]
        )
        XCTAssertEqual(
            makeCollectionSource().allowedReasons,
            [
                .suspectedScam,
                .falseOrExpiredGroupBuy,
                .invalidContact,
                .copyrightOrStolenMedia,
                .sexualOrIllegal,
                .spamOrAdvertising,
                .other
            ]
        )
    }

    func testBlockOfferExistsOnlyForUserAndDirectMessage() {
        XCTAssertFalse(makePostSource(collectionID: nil).canOfferBlock)
        XCTAssertFalse(makeCommentSource().canOfferBlock)
        XCTAssertTrue(makeUserSource().canOfferBlock)
        XCTAssertTrue(makeDirectMessageSource().canOfferBlock)
        XCTAssertFalse(makeCollectionSource().canOfferBlock)
    }

    func testStableIdentitySeparatesDifferentTypesWithSameRawID() {
        let post = SafetyReportSource(
            type: .post,
            id: "shared-1",
            title: "帖子",
            ownerUserID: "owner-1",
            collectionID: nil,
            peerUserID: nil
        )
        let user = SafetyReportSource(
            type: .user,
            id: "shared-1",
            title: "用户",
            ownerUserID: "owner-1",
            collectionID: nil,
            peerUserID: nil
        )

        XCTAssertNotEqual(post.id, user.id)
        XCTAssertEqual(post.objectID, "shared-1")
        XCTAssertEqual(user.objectID, "shared-1")
    }

    func testPostWithoutCollectionOnlySupportsContentField() {
        let source = makePostSource(collectionID: nil)

        XCTAssertEqual(
            SafetyReportFormLogic.allowedFields(for: source, reason: .falseOrExpiredGroupBuy),
            [.content]
        )
        XCTAssertEqual(
            SafetyReportFormLogic.allowedFields(for: source, reason: .invalidContact),
            [.content]
        )
        XCTAssertEqual(
            SafetyReportFormLogic.allowedFields(for: source, reason: .harassmentOrAbuse),
            [.content]
        )
    }

    func testPostWithoutCollectionInvalidContactRequiresInlineMessageAndRejectsDraft() throws {
        let source = makePostSource(collectionID: nil)

        let validation = SafetyReportFormLogic.validation(
            source: source,
            reason: .invalidContact,
            reportedField: .content,
            detail: "微信号失效",
            evidenceCount: 0
        )

        XCTAssertEqual(validation.fieldMessage, "该帖子没有可核查的合集联系方式，请改选其他原因或直接说明内容问题")
        XCTAssertNil(validation.detailMessage)
        XCTAssertNil(validation.evidenceMessage)
        XCTAssertNil(
            SafetyReportFormLogic.buildDraft(
                source: source,
                reason: .invalidContact,
                reportedField: .content,
                detail: "微信号失效",
                objectKeys: [],
                clientRequestID: "req-post-no-collection-invalid-contact"
            )
        )
    }

    func testPostSharedReasonsAllowCollectionFieldsOnlyWhenCollectionExists() {
        let source = makePostSource(collectionID: "collection-1")

        XCTAssertEqual(
            SafetyReportFormLogic.allowedFields(for: source, reason: .falseOrExpiredGroupBuy),
            [.content, .collectionDescription, .collectionDeadline, .collectionDefaultNote]
        )
        XCTAssertEqual(
            SafetyReportFormLogic.allowedFields(for: source, reason: .invalidContact),
            [.contactWechat, .contactQQ, .contactGroupNumber]
        )
        XCTAssertEqual(
            SafetyReportFormLogic.allowedFields(for: source, reason: .harassmentOrAbuse),
            [.content]
        )
    }

    func testPostWithCollectionMatchesBackendCollectionFieldReasonMatrix() {
        let source = makePostSource(collectionID: "collection-1")
        let expectedFieldsByReason: [(SafetyReasonCode, [SafetyReportedField])] = [
            (.suspectedScam, [.content, .collectionDescription, .collectionDeadline, .collectionDefaultNote]),
            (.falseOrExpiredGroupBuy, [.content, .collectionDescription, .collectionDeadline, .collectionDefaultNote]),
            (.invalidContact, [.contactWechat, .contactQQ, .contactGroupNumber]),
            (.copyrightOrStolenMedia, [.content, .collectionDescription, .collectionDeadline, .collectionDefaultNote]),
            (.sexualOrIllegal, [.content, .collectionDescription, .collectionDeadline, .collectionDefaultNote]),
            (.spamOrAdvertising, [.content, .collectionDescription, .collectionDeadline, .collectionDefaultNote]),
            (.other, [.content, .collectionDescription, .collectionDeadline, .collectionDefaultNote]),
            (.harassmentOrAbuse, [.content])
        ]

        for (reason, expectedFields) in expectedFieldsByReason {
            XCTAssertEqual(
                SafetyReportFormLogic.allowedFields(for: source, reason: reason),
                expectedFields,
                "unexpected fields for \(reason.rawValue)"
            )
        }
    }

    func testCommentUserAndDirectMessageNeverAllowCollectionFields() {
        XCTAssertEqual(
            SafetyReportFormLogic.allowedFields(for: makeCommentSource(), reason: .suspectedScam),
            [.content]
        )
        XCTAssertEqual(
            SafetyReportFormLogic.allowedFields(for: makeUserSource(), reason: .copyrightOrStolenMedia),
            [.content]
        )
        XCTAssertEqual(
            SafetyReportFormLogic.allowedFields(for: makeDirectMessageSource(), reason: .directMessageRisk),
            [.content]
        )
    }

    func testInvalidContactRequiresSpecificFieldAndDetail() {
        let source = makeCollectionSource()

        let missingField = SafetyReportFormLogic.validation(
            source: source,
            reason: .invalidContact,
            reportedField: .content,
            detail: " ",
            evidenceCount: 0
        )
        XCTAssertNotNil(missingField.fieldMessage)
        XCTAssertNotNil(missingField.detailMessage)

        let valid = SafetyReportFormLogic.validation(
            source: source,
            reason: .invalidContact,
            reportedField: .contactWechat,
            detail: "加群微信失效",
            evidenceCount: 0
        )
        XCTAssertNil(valid.fieldMessage)
        XCTAssertNil(valid.detailMessage)
        XCTAssertNil(valid.evidenceMessage)
    }

    func testOtherReasonRequiresDetailAndRespectsThousandCharacterLimit() {
        let source = makePostSource(collectionID: nil)
        let thousand = String(repeating: "测", count: 1000)
        let oneThousandAndOne = String(repeating: "测", count: 1001)

        let missingDetail = SafetyReportFormLogic.validation(
            source: source,
            reason: .other,
            reportedField: .content,
            detail: "",
            evidenceCount: 0
        )
        XCTAssertNotNil(missingDetail.detailMessage)

        let atLimit = SafetyReportFormLogic.validation(
            source: source,
            reason: .other,
            reportedField: .content,
            detail: thousand,
            evidenceCount: 0
        )
        XCTAssertNil(atLimit.detailMessage)

        let overLimit = SafetyReportFormLogic.validation(
            source: source,
            reason: .other,
            reportedField: .content,
            detail: oneThousandAndOne,
            evidenceCount: 0
        )
        XCTAssertNotNil(overLimit.detailMessage)
    }

    func testUnicodeCodePointCountingMatchesBackendLimit() {
        let source = makePostSource(collectionID: nil)
        let familyEmoji = "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}"
        let accented = "e\u{0301}"
        let singleEmoji = "\u{1F680}"
        let codePointUnit = familyEmoji + accented + singleEmoji
        let atLimit = String(repeating: codePointUnit, count: 100)
        let overLimit = atLimit + "a"

        XCTAssertEqual(SafetyReportFormLogic.codePointCount(in: familyEmoji), 7)
        XCTAssertEqual(SafetyReportFormLogic.codePointCount(in: accented), 2)
        XCTAssertEqual(SafetyReportFormLogic.codePointCount(in: singleEmoji), 1)
        XCTAssertEqual(SafetyReportFormLogic.codePointCount(in: atLimit), 1000)
        XCTAssertEqual(SafetyReportFormLogic.codePointCount(in: overLimit), 1001)

        XCTAssertNil(
            SafetyReportFormLogic.validation(
                source: source,
                reason: .other,
                reportedField: .content,
                detail: atLimit,
                evidenceCount: 0
            ).detailMessage
        )
        XCTAssertEqual(
            SafetyReportFormLogic.validation(
                source: source,
                reason: .other,
                reportedField: .content,
                detail: overLimit,
                evidenceCount: 0
            ).detailMessage,
            "说明最多填写 1000 字"
        )
    }

    func testEvidenceCountIsLimitedToSix() {
        let source = makePostSource(collectionID: nil)

        let six = SafetyReportFormLogic.validation(
            source: source,
            reason: .suspectedScam,
            reportedField: .content,
            detail: "截图补充",
            evidenceCount: 6
        )
        XCTAssertNil(six.evidenceMessage)

        let seven = SafetyReportFormLogic.validation(
            source: source,
            reason: .suspectedScam,
            reportedField: .content,
            detail: "截图补充",
            evidenceCount: 7
        )
        XCTAssertNotNil(seven.evidenceMessage)
    }

    func testDisallowedReasonsProduceInlineReasonErrorAndRejectDraft() {
        let cases: [(SafetyReportSource, SafetyReasonCode)] = [
            (makePostSource(collectionID: nil), .directMessageRisk),
            (makeCommentSource(), .falseOrExpiredGroupBuy),
            (makeUserSource(), .invalidContact),
            (makeDirectMessageSource(), .copyrightOrStolenMedia),
            (makeCollectionSource(), .harassmentOrAbuse)
        ]

        for (source, reason) in cases {
            let validation = SafetyReportFormLogic.validation(
                source: source,
                reason: reason,
                reportedField: .content,
                detail: "需要核查",
                evidenceCount: 0
            )

            XCTAssertEqual(validation.reasonMessage, "这个对象不支持当前举报原因，请重新选择", "unexpected reason message for \(source.type.rawValue) / \(reason.rawValue)")
            XCTAssertNil(
                SafetyReportFormLogic.buildDraft(
                    source: source,
                    reason: reason,
                    reportedField: .content,
                    detail: "需要核查",
                    objectKeys: [],
                    clientRequestID: "req-invalid-\(source.type.rawValue)-\(reason.rawValue)"
                )
            )
        }
    }

    func testEvidenceBufferIgnoresStaleGenerationAndReappliesCapacityAtCompletion() {
        let existingItems = makeEvidenceItems(count: 5)
        var buffer = SafetyReportEvidenceBuffer(items: existingItems)
        let staleGeneration = buffer.beginLoading()
        let currentGeneration = buffer.beginLoading()

        XCTAssertFalse(
            buffer.finishLoading(
                generation: staleGeneration,
                loadedData: [Data("stale".utf8)],
                selectedCount: 1,
                failedCount: 0
            )
        )
        XCTAssertEqual(buffer.items, existingItems)
        XCTAssertTrue(buffer.isLoading)

        buffer.remove(existingItems[0].id)
        buffer.remove(existingItems[1].id)
        XCTAssertEqual(buffer.items.count, 3)

        XCTAssertTrue(
            buffer.finishLoading(
                generation: currentGeneration,
                loadedData: [
                    Data("fresh-1".utf8),
                    Data("fresh-2".utf8),
                    Data("fresh-3".utf8),
                    Data("fresh-4".utf8)
                ],
                selectedCount: 4,
                failedCount: 0
            )
        )
        XCTAssertEqual(buffer.items.count, 6)
        XCTAssertEqual(buffer.items.suffix(3).map(\.data), [Data("fresh-1".utf8), Data("fresh-2".utf8), Data("fresh-3".utf8)])
        XCTAssertEqual(buffer.statusMessage, "最多上传 6 张证据图片")
        XCTAssertFalse(buffer.isLoading)
    }

    func testEvidenceBufferRemoveClearsOverflowMessageAfterReturningUnderLimit() {
        let items = makeEvidenceItems(count: 6)
        var buffer = SafetyReportEvidenceBuffer(items: items, statusMessage: "最多上传 6 张证据图片")

        buffer.remove(items[0].id)

        XCTAssertEqual(buffer.items.count, 5)
        XCTAssertNil(buffer.statusMessage)
    }

    func testBlockCandidateUserIDRequiresSupportedSourceNonBlankValueAndNonSelf() {
        XCTAssertNil(
            SafetyReportFormLogic.blockCandidateUserID(
                for: makePostSource(collectionID: "collection-1"),
                currentUserID: "u-me"
            )
        )
        XCTAssertNil(
            SafetyReportFormLogic.blockCandidateUserID(
                for: SafetyReportSource(
                    type: .user,
                    id: "user-self",
                    title: "自己",
                    ownerUserID: "u-me",
                    collectionID: nil,
                    peerUserID: nil
                ),
                currentUserID: "u-me"
            )
        )
        XCTAssertNil(
            SafetyReportFormLogic.blockCandidateUserID(
                for: SafetyReportSource(
                    type: .directMessage,
                    id: "message-blank",
                    title: "空白私信",
                    ownerUserID: "   ",
                    collectionID: nil,
                    peerUserID: " \n "
                ),
                currentUserID: "u-me"
            )
        )
        XCTAssertEqual(
            SafetyReportFormLogic.blockCandidateUserID(
                for: makeDirectMessageSource(),
                currentUserID: "u-me"
            ),
            "user-peer"
        )
        XCTAssertEqual(
            SafetyReportFormLogic.blockCandidateUserID(
                for: SafetyReportSource(
                    type: .directMessage,
                    id: "message-owner-fallback",
                    title: "自己发给对方的私信",
                    ownerUserID: "user-owner-fallback",
                    collectionID: nil,
                    peerUserID: "u-me"
                ),
                currentUserID: "u-me"
            ),
            "user-owner-fallback"
        )
        XCTAssertEqual(
            SafetyReportFormLogic.blockCandidateUserID(
                for: makeUserSource(),
                currentUserID: "u-me"
            ),
            "user-2"
        )
    }

    @MainActor
    func testPreviewStoreInitializationSkipsPersistentSideEffects() throws {
        let defaults = UserDefaults.standard
        let fallbackTokenKey = "zhoubiantuan.backendToken.fallback"
        let loginKey = "zhoubiantuan.isLoggedIn"
        let localResetKey = "zhoubiantuan.localDataResetVersion"
        let searchHistoryKey = "zhoubiantuan.searchHistory"
        let fileURL = try XCTUnwrap(Self.messageThreadsStorageURL())
        let originalValues = [
            fallbackTokenKey: defaults.object(forKey: fallbackTokenKey),
            loginKey: defaults.object(forKey: loginKey),
            localResetKey: defaults.object(forKey: localResetKey),
            searchHistoryKey: defaults.object(forKey: searchHistoryKey)
        ]
        let originalFileData = try? Data(contentsOf: fileURL)

        defer {
            for (key, value) in originalValues {
                if let value {
                    defaults.set(value, forKey: key)
                } else {
                    defaults.removeObject(forKey: key)
                }
            }

            if let originalFileData {
                try? FileManager.default.createDirectory(
                    at: fileURL.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                try? originalFileData.write(to: fileURL, options: .atomic)
            } else {
                try? FileManager.default.removeItem(at: fileURL)
            }
        }

        defaults.set("legacy-fallback-token", forKey: fallbackTokenKey)
        defaults.set(true, forKey: loginKey)
        defaults.set(99, forKey: localResetKey)
        defaults.set(["已保存"], forKey: searchHistoryKey)
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let sentinel = Data("threads-sentinel".utf8)
        try sentinel.write(to: fileURL, options: .atomic)

        let previewStore = MockAppStore.previewStore()

        XCTAssertFalse(previewStore.isLoggedIn)
        XCTAssertEqual(defaults.string(forKey: fallbackTokenKey), "legacy-fallback-token")
        XCTAssertTrue(defaults.bool(forKey: loginKey))
        XCTAssertEqual(defaults.integer(forKey: localResetKey), 99)
        XCTAssertEqual(defaults.stringArray(forKey: searchHistoryKey), ["已保存"])
        XCTAssertEqual(try Data(contentsOf: fileURL), sentinel)
    }

    func testCollectionScopeAndDraftWireFieldsArePreserved() {
        let source = makeCollectionSource()

        XCTAssertTrue(
            SafetyReportFormLogic.affectsCollection(
                source: source,
                reason: .falseOrExpiredGroupBuy,
                reportedField: .collectionDeadline
            )
        )

        let draft = try? XCTUnwrap(
            SafetyReportFormLogic.buildDraft(
                source: source,
                reason: .falseOrExpiredGroupBuy,
                reportedField: .collectionDeadline,
                detail: "合集已经截团但还在继续发帖",
                objectKeys: ["report/image-1.jpg"],
                clientRequestID: "req-collection-1"
            )
        )

        XCTAssertEqual(draft?.clientRequestID, "req-collection-1")
        XCTAssertEqual(draft?.sourceType, .collection)
        XCTAssertEqual(draft?.sourceID, source.objectID)
        XCTAssertEqual(draft?.reasonCode, .falseOrExpiredGroupBuy)
        XCTAssertEqual(draft?.reportedField, .collectionDeadline)
        XCTAssertEqual(draft?.detail, "合集已经截团但还在继续发帖")
        XCTAssertEqual(draft?.objectKeys, ["report/image-1.jpg"])
    }

    func testBuildDraftUsesPassedClientRequestIDWithoutReplacement() throws {
        let source = makePostSource(collectionID: "collection-1")
        let draft = try XCTUnwrap(
            SafetyReportFormLogic.buildDraft(
                source: source,
                reason: .invalidContact,
                reportedField: .contactQQ,
                detail: "QQ 号无效",
                objectKeys: [],
                clientRequestID: "req-stable-42"
            )
        )

        XCTAssertEqual(draft.clientRequestID, "req-stable-42")
        XCTAssertEqual(draft.sourceID, source.objectID)
    }

    private func makePostSource(collectionID: String?) -> SafetyReportSource {
        SafetyReportSource(
            type: .post,
            id: "post-1",
            title: "收一套拍立得",
            ownerUserID: "user-owner",
            collectionID: collectionID,
            peerUserID: nil
        )
    }

    private func makeCommentSource() -> SafetyReportSource {
        SafetyReportSource(
            type: .comment,
            id: "comment-1",
            title: "评论内容",
            ownerUserID: "user-comment",
            collectionID: "collection-1",
            peerUserID: nil
        )
    }

    private func makeUserSource() -> SafetyReportSource {
        SafetyReportSource(
            type: .user,
            id: "user-2",
            title: "团长 A",
            ownerUserID: "user-2",
            collectionID: nil,
            peerUserID: nil
        )
    }

    private func makeDirectMessageSource() -> SafetyReportSource {
        SafetyReportSource(
            type: .directMessage,
            id: "message-1",
            title: "来自团长 A 的私信",
            ownerUserID: "user-owner",
            collectionID: nil,
            peerUserID: "user-peer"
        )
    }

    private func makeCollectionSource() -> SafetyReportSource {
        SafetyReportSource(
            type: .collection,
            id: "collection-1",
            title: "暑假合集",
            ownerUserID: "user-owner",
            collectionID: "collection-1",
            peerUserID: nil
        )
    }

    private func makeEvidenceItems(count: Int) -> [SafetyReportEvidenceItem] {
        (0..<count).map { index in
            SafetyReportEvidenceItem(data: Data("existing-\(index)".utf8))
        }
    }

    private static func messageThreadsStorageURL() -> URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("zhoubiantuan-message-threads.json")
    }
}
