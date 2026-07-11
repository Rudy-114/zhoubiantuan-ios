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
