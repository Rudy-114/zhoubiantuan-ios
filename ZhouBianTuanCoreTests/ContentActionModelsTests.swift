import XCTest
@testable import ZhouBianTuanCore

final class ContentActionModelsTests: XCTestCase {
    func testContentActionDecodesOwnerVisibleCorrectionState() throws {
        let json = #"""
        {
          "caseID": "case-correction-1",
          "targetType": "post",
          "targetID": "post-1",
          "targetTitle": "巡演限定小卡套组二开",
          "category": "false_or_expired_group_buy",
          "status": "awaiting_correction",
          "affectedFields": ["content", "collection_deadline"],
          "reason": "拼团信息可能不准确或已失效，请更新相关内容",
          "currentRestriction": "帖子当前已隐藏",
          "correctionDueAt": "2026-07-18T04:00:00.000Z",
          "canSubmitRevision": true,
          "canAppeal": false,
          "revisionStatus": null,
          "updatedAt": "2026-07-13T04:00:00.000Z"
        }
        """#

        let action = try JSONDecoder().decode(SafetyContentAction.self, from: Data(json.utf8))

        XCTAssertEqual(action.id, "case-correction-1")
        XCTAssertEqual(action.targetType, .post)
        XCTAssertEqual(action.targetTitle, "巡演限定小卡套组二开")
        XCTAssertEqual(action.category, .falseOrExpiredGroupBuy)
        XCTAssertEqual(action.status, "awaiting_correction")
        XCTAssertEqual(action.affectedFields, [.content, .collectionDeadline])
        XCTAssertEqual(action.correctionDueAt, "2026-07-18T04:00:00.000Z")
        XCTAssertTrue(action.canSubmitRevision)
        XCTAssertFalse(action.canAppeal)
        XCTAssertNil(action.revisionStatus)
    }

    func testPostRevisionEncodesOnlyOwnerSubmissionFields() throws {
        let snapshot = SafetyPostRevisionSnapshot(
            title: "修正后的标题",
            imageNames: ["cover"],
            imageObjectKeys: ["post/u-owner/cover.jpg"],
            previewImageObjectKeys: ["post/u-owner/cover-preview.jpg"],
            groupType: "followGroup",
            categoryTags: ["徽章"],
            fandomTags: ["作品 A"],
            price: "35",
            deposit: "10",
            condition: "20 人成团",
            isFormed: false,
            description: "修正后的说明",
            externalLink: "https://example.com/group-buy",
            imageAspect: 1.08,
            pingguAveragePrice: "",
            pingguNote: "",
            unsoldRoles: []
        )
        let draft = SafetyRevisionDraft.post(
            snapshot: snapshot,
            objectKeys: ["post/u-owner/cover.jpg", "post/u-owner/cover-preview.jpg"]
        )

        let object = try XCTUnwrap(try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft)) as? [String: Any])
        XCTAssertEqual(Set(object.keys), ["snapshot", "objectKeys"])
        let encodedSnapshot = try XCTUnwrap(object["snapshot"] as? [String: Any])
        XCTAssertEqual(Set(encodedSnapshot.keys), [
            "title", "imageNames", "imageObjectKeys", "previewImageObjectKeys", "groupType",
            "categoryTags", "fandomTags", "price", "deposit", "condition", "isFormed",
            "description", "externalLink", "imageAspect", "pingguAveragePrice", "pingguNote",
            "unsoldRoles"
        ])
        XCTAssertNil(object["reporterID"])
        XCTAssertNil(object["adminReason"])
        XCTAssertNil(object["decision"])
    }

    func testCollectionRevisionAndAppealEncodeBackendFieldNamesWithoutPrivateData() throws {
        let revision = SafetyRevisionDraft.collection(
            snapshot: SafetyCollectionRevisionSnapshot(
                name: "修正后的合集",
                contactWechat: "new-wechat",
                contactQQ: "",
                contactGroupNumber: "123456",
                groupInfo: "修正后的拉群说明",
                deadline: "2026-08-01T00:00:00.000Z",
                defaultNote: "修正后的默认说明",
                deadlineConfirmed: false
            ),
            objectKeys: []
        )
        let revisionObject = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(revision)) as? [String: Any]
        )
        let collectionSnapshot = try XCTUnwrap(revisionObject["snapshot"] as? [String: Any])
        XCTAssertEqual(Set(collectionSnapshot.keys), [
            "name", "contactWechat", "contactQQ", "contactGroupNumber", "groupInfo",
            "deadline", "defaultNote", "deadlineConfirmed"
        ])

        let appeal = SafetyAppealDraft(
            detail: "请人工重新核对这次处理决定。",
            objectKeys: ["report/u-owner/appeal-1.jpg"]
        )
        let appealObject = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(appeal)) as? [String: Any]
        )
        XCTAssertEqual(Set(appealObject.keys), ["detail", "objectKeys"])
        XCTAssertNil(appealObject["decisionActionID"])
        XCTAssertNil(appealObject["handledBy"])
        XCTAssertNil(appealObject["status"])
    }
}
