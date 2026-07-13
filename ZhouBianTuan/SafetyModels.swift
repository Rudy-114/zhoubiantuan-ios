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

public enum SafetyReportStatus: String, Codable, CaseIterable, Sendable {
    case received
    case reviewing
    case handled
    case noViolation = "no_violation"
}

public struct SafetyReportDraft: Codable, Equatable, Sendable {
    public let clientRequestID: String
    public let sourceType: SafetyTargetType
    public let sourceID: String
    public let reasonCode: SafetyReasonCode
    public let reportedField: SafetyReportedField
    public let detail: String
    public let objectKeys: [String]

    public init(
        clientRequestID: String = UUID().uuidString,
        sourceType: SafetyTargetType,
        sourceID: String,
        reasonCode: SafetyReasonCode,
        reportedField: SafetyReportedField = .content,
        detail: String,
        objectKeys: [String]
    ) {
        self.clientRequestID = clientRequestID
        self.sourceType = sourceType
        self.sourceID = sourceID
        self.reasonCode = reasonCode
        self.reportedField = reportedField
        self.detail = detail
        self.objectKeys = objectKeys
    }
}

public struct SafetyReportDraftState: Equatable, Sendable {
    public let sourceType: SafetyTargetType
    public let sourceID: String
    public private(set) var clientRequestID: String

    public init(
        sourceType: SafetyTargetType,
        sourceID: String,
        clientRequestID: String = UUID().uuidString
    ) {
        self.sourceType = sourceType
        self.sourceID = sourceID
        self.clientRequestID = clientRequestID
    }

    public mutating func markFailed() {}

    public mutating func markAccepted() {
        clientRequestID = UUID().uuidString
    }
}

public struct SafetyEvidenceSupplementDraftState: Equatable, Sendable {
    public private(set) var clientRequestID: String
    public private(set) var hasStarted = false

    public init(clientRequestID: String = UUID().uuidString) {
        self.clientRequestID = clientRequestID
    }

    public mutating func markAttemptStarted() {
        hasStarted = true
    }

    public mutating func markFailed() {}

    public mutating func markAccepted() {
        clientRequestID = UUID().uuidString
        hasStarted = false
    }
}

public struct SafetyReportSubmissionState: Equatable, Sendable {
    public private(set) var activeSubmissionID: UUID?

    public init() {}

    public var isSubmitting: Bool {
        activeSubmissionID != nil
    }

    public mutating func begin() -> UUID? {
        guard activeSubmissionID == nil else { return nil }
        let submissionID = UUID()
        activeSubmissionID = submissionID
        return submissionID
    }

    public mutating func finish(_ submissionID: UUID) {
        guard activeSubmissionID == submissionID else { return }
        activeSubmissionID = nil
    }

    public mutating func reset() {
        activeSubmissionID = nil
    }
}

public struct SafetyEvidenceSupplement: Codable, Equatable, Sendable {
    public let clientRequestID: String
    public let detail: String
    public let objectKeys: [String]

    public init(clientRequestID: String, detail: String, objectKeys: [String]) {
        self.clientRequestID = clientRequestID
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

    public init(
        id: String,
        caseID: String,
        sourceType: SafetyTargetType,
        sourceID: String,
        subjectType: SafetyTargetType,
        subjectID: String,
        reasonCode: SafetyReasonCode,
        reportedField: SafetyReportedField,
        detail: String,
        status: SafetyReportStatus,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.caseID = caseID
        self.sourceType = sourceType
        self.sourceID = sourceID
        self.subjectType = subjectType
        self.subjectID = subjectID
        self.reasonCode = reasonCode
        self.reportedField = reportedField
        self.detail = detail
        self.status = status
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct SafetyReportSummary: Identifiable, Equatable, Sendable {
    public let id: String
    public let reasonCode: SafetyReasonCode
    public let targetType: SafetyTargetType
    public let status: SafetyReportStatus
    public let updatedAt: String

    public init(report: SafetyReport) {
        id = report.id
        reasonCode = report.reasonCode
        targetType = report.sourceType
        status = report.status
        updatedAt = report.updatedAt
    }
}

public struct SafetyReportResponse: Codable, Sendable {
    public let report: SafetyReport
    public let duplicate: Bool

    public init(report: SafetyReport, duplicate: Bool) {
        self.report = report
        self.duplicate = duplicate
    }
}

public struct SafetyReportsResponse: Codable, Sendable {
    public let reports: [SafetyReport]

    public init(reports: [SafetyReport]) {
        self.reports = reports
    }
}

public struct SafetyContentAction: Codable, Identifiable, Equatable, Sendable {
    public var id: String { caseID }
    public let caseID: String
    public let targetType: SafetyTargetType
    public let targetID: String
    public let category: SafetyReasonCode
    public let status: String
    public let affectedFields: [SafetyReportedField]
    public let reason: String
    public let currentRestriction: String
    public let correctionDueAt: String?
    public let canSubmitRevision: Bool
    public let canAppeal: Bool
    public let revisionStatus: String?
    public let updatedAt: String

    public init(
        caseID: String,
        targetType: SafetyTargetType,
        targetID: String,
        category: SafetyReasonCode,
        status: String,
        affectedFields: [SafetyReportedField],
        reason: String,
        currentRestriction: String,
        correctionDueAt: String?,
        canSubmitRevision: Bool,
        canAppeal: Bool,
        revisionStatus: String?,
        updatedAt: String
    ) {
        self.caseID = caseID
        self.targetType = targetType
        self.targetID = targetID
        self.category = category
        self.status = status
        self.affectedFields = affectedFields
        self.reason = reason
        self.currentRestriction = currentRestriction
        self.correctionDueAt = correctionDueAt
        self.canSubmitRevision = canSubmitRevision
        self.canAppeal = canAppeal
        self.revisionStatus = revisionStatus
        self.updatedAt = updatedAt
    }
}

public struct SafetyRevisionRoleSnapshot: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let quantity: Int
    public let priceAdjustment: Double

    public init(id: String, name: String, quantity: Int, priceAdjustment: Double) {
        self.id = id
        self.name = name
        self.quantity = quantity
        self.priceAdjustment = priceAdjustment
    }
}

public struct SafetyPostRevisionSnapshot: Codable, Equatable, Sendable {
    public let title: String
    public let imageNames: [String]
    public let imageObjectKeys: [String]
    public let previewImageObjectKeys: [String]
    public let groupType: String
    public let categoryTags: [String]
    public let fandomTags: [String]
    public let price: String
    public let deposit: String
    public let condition: String
    public let isFormed: Bool
    public let description: String
    public let externalLink: String
    public let imageAspect: Double
    public let pingguAveragePrice: String
    public let pingguNote: String
    public let unsoldRoles: [SafetyRevisionRoleSnapshot]

    public init(
        title: String,
        imageNames: [String],
        imageObjectKeys: [String],
        previewImageObjectKeys: [String],
        groupType: String,
        categoryTags: [String],
        fandomTags: [String],
        price: String,
        deposit: String,
        condition: String,
        isFormed: Bool,
        description: String,
        externalLink: String,
        imageAspect: Double,
        pingguAveragePrice: String,
        pingguNote: String,
        unsoldRoles: [SafetyRevisionRoleSnapshot]
    ) {
        self.title = title
        self.imageNames = imageNames
        self.imageObjectKeys = imageObjectKeys
        self.previewImageObjectKeys = previewImageObjectKeys
        self.groupType = groupType
        self.categoryTags = categoryTags
        self.fandomTags = fandomTags
        self.price = price
        self.deposit = deposit
        self.condition = condition
        self.isFormed = isFormed
        self.description = description
        self.externalLink = externalLink
        self.imageAspect = imageAspect
        self.pingguAveragePrice = pingguAveragePrice
        self.pingguNote = pingguNote
        self.unsoldRoles = unsoldRoles
    }
}

public struct SafetyCollectionRevisionSnapshot: Codable, Equatable, Sendable {
    public let name: String
    public let contactWechat: String
    public let contactQQ: String
    public let contactGroupNumber: String
    public let groupInfo: String
    public let deadline: String
    public let defaultNote: String
    public let deadlineConfirmed: Bool

    public init(
        name: String,
        contactWechat: String,
        contactQQ: String,
        contactGroupNumber: String,
        groupInfo: String,
        deadline: String,
        defaultNote: String,
        deadlineConfirmed: Bool
    ) {
        self.name = name
        self.contactWechat = contactWechat
        self.contactQQ = contactQQ
        self.contactGroupNumber = contactGroupNumber
        self.groupInfo = groupInfo
        self.deadline = deadline
        self.defaultNote = defaultNote
        self.deadlineConfirmed = deadlineConfirmed
    }
}

public enum SafetyRevisionDraft: Encodable, Equatable, Sendable {
    case post(snapshot: SafetyPostRevisionSnapshot, objectKeys: [String])
    case collection(snapshot: SafetyCollectionRevisionSnapshot, objectKeys: [String])

    private enum CodingKeys: String, CodingKey {
        case snapshot
        case objectKeys
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .post(snapshot, objectKeys):
            try container.encode(snapshot, forKey: .snapshot)
            try container.encode(objectKeys, forKey: .objectKeys)
        case let .collection(snapshot, objectKeys):
            try container.encode(snapshot, forKey: .snapshot)
            try container.encode(objectKeys, forKey: .objectKeys)
        }
    }
}

public struct SafetyAppealDraft: Codable, Equatable, Sendable {
    public let detail: String
    public let objectKeys: [String]

    public init(detail: String, objectKeys: [String]) {
        self.detail = detail
        self.objectKeys = objectKeys
    }
}

public struct SafetyContentActionsResponse: Codable, Equatable, Sendable {
    public let actions: [SafetyContentAction]
    public let nextCursor: String?

    public init(actions: [SafetyContentAction], nextCursor: String? = nil) {
        self.actions = actions
        self.nextCursor = nextCursor
    }
}

public struct SafetyContentActionResponse: Codable, Equatable, Sendable {
    public let action: SafetyContentAction

    public init(action: SafetyContentAction) {
        self.action = action
    }
}
