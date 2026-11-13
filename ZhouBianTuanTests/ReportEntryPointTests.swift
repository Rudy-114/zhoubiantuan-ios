import XCTest
@testable import ZhouBianTuan

final class ReportEntryPointTests: XCTestCase {
    func testCanReportPoliciesMatchOwnershipAndIncomingRules() {
        let post = GroupBuyPost(
            id: "post-1",
            title: "收一套拍立得",
            imageNames: [],
            authorID: "user-owner",
            categoryTags: [],
            fandomTags: [],
            price: "99",
            deposit: "10",
            deadline: Date(timeIntervalSince1970: 1_720_000_000),
            condition: "全新",
            isFormed: false,
            description: "描述",
            wechat: "wx-1",
            qq: "qq-1",
            groupNumber: "12345",
            groupInfo: "备注进群",
            contactVisibility: "active",
            externalLink: "",
            createdAt: Date(timeIntervalSince1970: 1_720_000_100),
            likedCount: 0,
            favoriteCount: 0,
            commentCount: 0,
            reportCount: 0,
            status: .active,
            imageAspect: 1
        )
        let comment = Comment(
            id: "comment-1",
            body: "这条评论需要核查",
            authorID: "user-comment",
            postID: post.id,
            replyToID: nil,
            createdAt: Date(timeIntervalSince1970: 1_720_000_200),
            status: .active
        )
        let incomingMessage = DirectMessage(
            id: "message-1",
            senderID: "user-peer",
            body: "私信内容",
            createdAt: Date(timeIntervalSince1970: 1_720_000_300)
        )
        let outgoingMessage = DirectMessage(
            id: "message-2",
            senderID: "user-me",
            body: "我发出的消息",
            createdAt: Date(timeIntervalSince1970: 1_720_000_301)
        )
        let revokedMessage = DirectMessage(
            id: "message-3",
            senderID: "user-peer",
            body: "已撤回",
            createdAt: Date(timeIntervalSince1970: 1_720_000_302),
            isRevoked: true
        )
        let deletedMessage = DirectMessage(
            id: "message-4",
            senderID: "user-peer",
            body: "已删除",
            createdAt: Date(timeIntervalSince1970: 1_720_000_303),
            isDeletedForMe: true
        )
        let safetyHiddenMessage = DirectMessage(
            id: "message-5",
            senderID: "user-peer",
            body: "安全隐藏",
            createdAt: Date(timeIntervalSince1970: 1_720_000_304),
            isSafetyHidden: true
        )
        let collection = GroupCollection(
            id: "collection-1",
            ownerID: "user-owner",
            name: "暑假合集",
            contactWechat: "wx-1",
            contactQQ: "qq-1",
            contactGroupNumber: "12345",
            groupInfo: "备注",
            contactVisibility: "active",
            deadline: Date(timeIntervalSince1970: 1_720_001_000),
            defaultNote: "默认说明",
            postIDs: [post.id],
            createdAt: Date(timeIntervalSince1970: 1_720_000_000)
        )

        XCTAssertTrue(SafetyReportEntryPolicy.canReportPost(post, currentUserID: "user-other"))
        XCTAssertFalse(SafetyReportEntryPolicy.canReportPost(post, currentUserID: "user-owner"))

        XCTAssertTrue(SafetyReportEntryPolicy.canReportComment(comment, currentUserID: "user-owner"))
        XCTAssertTrue(SafetyReportEntryPolicy.canReportComment(comment, currentUserID: "user-other"))
        XCTAssertFalse(SafetyReportEntryPolicy.canReportComment(comment, currentUserID: "user-comment"))

        XCTAssertTrue(SafetyReportEntryPolicy.canReportUser(userID: "user-peer", currentUserID: "user-me"))
        XCTAssertFalse(SafetyReportEntryPolicy.canReportUser(userID: "user-me", currentUserID: "user-me"))

        XCTAssertTrue(SafetyReportEntryPolicy.canReportMessage(incomingMessage, currentUserID: "user-me"))
        XCTAssertFalse(SafetyReportEntryPolicy.canReportMessage(outgoingMessage, currentUserID: "user-me"))
        XCTAssertFalse(SafetyReportEntryPolicy.canReportMessage(revokedMessage, currentUserID: "user-me"))
        XCTAssertFalse(SafetyReportEntryPolicy.canReportMessage(deletedMessage, currentUserID: "user-me"))
        XCTAssertFalse(SafetyReportEntryPolicy.canReportMessage(safetyHiddenMessage, currentUserID: "user-me"))

        XCTAssertTrue(SafetyReportEntryPolicy.canReportCollection(collection, currentUserID: "user-other"))
        XCTAssertFalse(SafetyReportEntryPolicy.canReportCollection(collection, currentUserID: "user-owner"))
    }

    func testSourceFactoriesProduceExpectedTypedSources() {
        let post = GroupBuyPost(
            id: "post-1",
            title: "  收一套拍立得  ",
            imageNames: [],
            authorID: "user-owner",
            collectionID: "collection-1",
            categoryTags: [],
            fandomTags: [],
            price: "99",
            deposit: "10",
            deadline: Date(timeIntervalSince1970: 1_720_000_000),
            condition: "全新",
            isFormed: false,
            description: "描述",
            wechat: "",
            qq: "",
            groupNumber: "",
            groupInfo: "",
            contactVisibility: "active",
            externalLink: "",
            createdAt: Date(timeIntervalSince1970: 1_720_000_100),
            likedCount: 0,
            favoriteCount: 0,
            commentCount: 0,
            reportCount: 0,
            status: .active,
            imageAspect: 1
        )
        let comment = Comment(
            id: "comment-1",
            body: "  这条评论真的有点长，需要一个简洁标题来展示给用户看  ",
            authorID: "user-comment",
            postID: post.id,
            replyToID: nil,
            createdAt: Date(timeIntervalSince1970: 1_720_000_200),
            status: .active
        )
        let user = User(
            id: "user-peer",
            nickname: "  团长 A  ",
            bio: "",
            followingCount: 0,
            followersCount: 0,
            postCount: 0,
            isRestricted: false,
            canShowContact: true,
            avatarSymbol: "person.circle.fill",
            avatarTint: .rose
        )
        let message = DirectMessage(
            id: "message-1",
            senderID: "user-sender",
            body: "  这是私信内容  ",
            createdAt: Date(timeIntervalSince1970: 1_720_000_300)
        )
        let collection = GroupCollection(
            id: "collection-1",
            ownerID: "user-owner",
            name: "  暑假合集  ",
            contactWechat: "",
            contactQQ: "",
            contactGroupNumber: "",
            groupInfo: "",
            contactVisibility: "active",
            deadline: Date(timeIntervalSince1970: 1_720_001_000),
            defaultNote: "默认说明",
            postIDs: [post.id],
            createdAt: Date(timeIntervalSince1970: 1_720_000_000)
        )

        XCTAssertEqual(
            SafetyReportSourceFactory.post(post),
            SafetyReportSource(
                type: .post,
                id: "post-1",
                title: "收一套拍立得",
                ownerUserID: "user-owner",
                collectionID: "collection-1",
                peerUserID: nil
            )
        )
        XCTAssertEqual(
            SafetyReportSourceFactory.comment(comment),
            SafetyReportSource(
                type: .comment,
                id: "comment-1",
                title: "这条评论真的有点长，需要一个简洁标题来展示给用户看",
                ownerUserID: "user-comment",
                collectionID: nil,
                peerUserID: nil
            )
        )
        XCTAssertEqual(
            SafetyReportSourceFactory.user(user),
            SafetyReportSource(
                type: .user,
                id: "user-peer",
                title: "团长 A",
                ownerUserID: "user-peer",
                collectionID: nil,
                peerUserID: "user-peer"
            )
        )
        XCTAssertEqual(
            SafetyReportSourceFactory.directMessage(message, peerUserID: "user-peer"),
            SafetyReportSource(
                type: .directMessage,
                id: "message-1",
                title: "这是私信内容",
                ownerUserID: "user-sender",
                collectionID: nil,
                peerUserID: "user-peer"
            )
        )
        XCTAssertEqual(
            SafetyReportSourceFactory.collection(collection),
            SafetyReportSource(
                type: .collection,
                id: "collection-1",
                title: "暑假合集",
                ownerUserID: "user-owner",
                collectionID: "collection-1",
                peerUserID: nil
            )
        )
    }

    func testContactVisibilityPrefersCollectionValueAndOnlyHiddenRestricts() {
        let post = GroupBuyPost(
            id: "post-1",
            title: "收一套拍立得",
            imageNames: [],
            authorID: "user-owner",
            categoryTags: [],
            fandomTags: [],
            price: "99",
            deposit: "10",
            deadline: Date(timeIntervalSince1970: 1_720_000_000),
            condition: "全新",
            isFormed: false,
            description: "描述",
            wechat: "wx-1",
            qq: "qq-1",
            groupNumber: "12345",
            groupInfo: "备注",
            contactVisibility: "hidden",
            externalLink: "",
            createdAt: Date(timeIntervalSince1970: 1_720_000_100),
            likedCount: 0,
            favoriteCount: 0,
            commentCount: 0,
            reportCount: 0,
            status: .active,
            imageAspect: 1
        )
        let activeCollection = GroupCollection(
            id: "collection-1",
            ownerID: "user-owner",
            name: "暑假合集",
            contactWechat: "wx-1",
            contactQQ: "qq-1",
            contactGroupNumber: "12345",
            groupInfo: "备注",
            contactVisibility: "active",
            deadline: Date(timeIntervalSince1970: 1_720_001_000),
            defaultNote: "默认说明",
            postIDs: [post.id],
            createdAt: Date(timeIntervalSince1970: 1_720_000_000)
        )
        let hiddenCollection = GroupCollection(
            id: "collection-2",
            ownerID: "user-owner",
            name: "隐藏合集",
            contactWechat: "wx-2",
            contactQQ: "qq-2",
            contactGroupNumber: "54321",
            groupInfo: "备注",
            contactVisibility: "hidden",
            deadline: Date(timeIntervalSince1970: 1_720_001_500),
            defaultNote: "默认说明",
            postIDs: [post.id],
            createdAt: Date(timeIntervalSince1970: 1_720_000_000)
        )

        XCTAssertEqual(SafetyReportEntryPolicy.effectiveContactVisibility(post: post, collection: nil), "hidden")
        XCTAssertEqual(SafetyReportEntryPolicy.effectiveContactVisibility(post: post, collection: activeCollection), "active")
        XCTAssertEqual(SafetyReportEntryPolicy.effectiveContactVisibility(post: post, collection: hiddenCollection), "hidden")

        XCTAssertTrue(SafetyReportEntryPolicy.isContactHidden(post: post, collection: nil))
        XCTAssertFalse(SafetyReportEntryPolicy.isContactHidden(post: post, collection: activeCollection))
        XCTAssertTrue(SafetyReportEntryPolicy.isContactHidden(post: post, collection: hiddenCollection))
    }

    func testSafetyHiddenMessagesSuppressFailureIndicatorAndRetryForEveryDeliveryState() {
        let deliveryStates: [MessageDeliveryStatus] = [
            .sent,
            .failedNetwork,
            .failedBlockedPeer,
            .failedBlockedByPeer
        ]

        for deliveryState in deliveryStates {
            let presentation = SafetyMessageDeliveryPolicy.presentation(
                isSafetyHidden: true,
                isMine: true,
                deliveryStatus: deliveryState
            )

            XCTAssertNil(presentation.failureMessage, "Unexpected failure indicator for \(deliveryState)")
            XCTAssertFalse(presentation.allowsRetry, "Unexpected retry for \(deliveryState)")
        }
    }
}
