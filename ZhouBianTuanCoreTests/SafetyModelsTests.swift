import Foundation
import XCTest
@testable import ZhouBianTuanCore

final class SafetyModelsTests: XCTestCase {
    func testSafetyReportDraftEncodesBackendFieldNames() throws {
        let draft = SafetyReportDraft(
            clientRequestID: "request-1",
            sourceType: .post,
            sourceID: "p-1",
            reasonCode: .invalidContact,
            reportedField: .contactWechat,
            detail: "微信号无效",
            objectKeys: ["report/u-1/2026-07-11/p-1.png"]
        )

        let data = try JSONEncoder().encode(draft)
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(payload["clientRequestID"] as? String, "request-1")
        XCTAssertEqual(payload["sourceType"] as? String, "post")
        XCTAssertEqual(payload["sourceID"] as? String, "p-1")
        XCTAssertEqual(payload["reasonCode"] as? String, "invalid_contact")
        XCTAssertEqual(payload["reportedField"] as? String, "contact_wechat")
        XCTAssertEqual(payload["detail"] as? String, "微信号无效")
        XCTAssertEqual(payload["objectKeys"] as? [String], ["report/u-1/2026-07-11/p-1.png"])
    }

    func testSafetyReportDraftGeneratesDistinctUUIDRequestIDsAndPreservesExplicitID() {
        let first = SafetyReportDraft(
            sourceType: .post,
            sourceID: "p-1",
            reasonCode: .spamOrAdvertising,
            detail: "",
            objectKeys: []
        )
        let second = SafetyReportDraft(
            sourceType: .post,
            sourceID: "p-1",
            reasonCode: .spamOrAdvertising,
            detail: "",
            objectKeys: []
        )
        let explicit = SafetyReportDraft(
            clientRequestID: "request-stable",
            sourceType: .post,
            sourceID: "p-1",
            reasonCode: .spamOrAdvertising,
            detail: "",
            objectKeys: []
        )

        XCTAssertFalse(first.clientRequestID.isEmpty)
        XCTAssertFalse(second.clientRequestID.isEmpty)
        XCTAssertNotEqual(first.clientRequestID, second.clientRequestID)
        XCTAssertNotNil(UUID(uuidString: first.clientRequestID))
        XCTAssertNotNil(UUID(uuidString: second.clientRequestID))
        XCTAssertEqual(explicit.clientRequestID, "request-stable")
    }

    func testSafetyReportDecodesCollectionSubjectReviewingReport() throws {
        let json = """
        {
          "id": "rp-1",
          "caseID": "sc-1",
          "sourceType": "post",
          "sourceID": "p-1",
          "subjectType": "collection",
          "subjectID": "col-1",
          "reasonCode": "invalid_contact",
          "reportedField": "contact_wechat",
          "detail": "集合页中的微信号已失效",
          "status": "reviewing",
          "createdAt": "2026-07-11T08:30:00.000Z",
          "updatedAt": "2026-07-11T09:00:00.000Z"
        }
        """

        let report = try JSONDecoder().decode(SafetyReport.self, from: Data(json.utf8))

        XCTAssertEqual(report.id, "rp-1")
        XCTAssertEqual(report.caseID, "sc-1")
        XCTAssertEqual(report.sourceType, .post)
        XCTAssertEqual(report.sourceID, "p-1")
        XCTAssertEqual(report.subjectType, .collection)
        XCTAssertEqual(report.subjectID, "col-1")
        XCTAssertEqual(report.reasonCode, .invalidContact)
        XCTAssertEqual(report.reportedField, .contactWechat)
        XCTAssertEqual(report.detail, "集合页中的微信号已失效")
        XCTAssertEqual(report.status, .reviewing)
        XCTAssertEqual(report.createdAt, "2026-07-11T08:30:00.000Z")
        XCTAssertEqual(report.updatedAt, "2026-07-11T09:00:00.000Z")
    }

    func testSafetyEnumsUseClosedBackendRawValues() throws {
        XCTAssertEqual(
            Set(SafetyTargetType.allCases.map(\.rawValue)),
            ["post", "comment", "user", "direct_message", "collection"]
        )
        XCTAssertEqual(
            Set(SafetyReasonCode.allCases.map(\.rawValue)),
            [
                "suspected_scam", "false_or_expired_group_buy", "invalid_contact",
                "copyright_or_stolen_media", "harassment_or_abuse", "sexual_or_illegal",
                "spam_or_advertising", "direct_message_risk", "other"
            ]
        )
        XCTAssertEqual(
            Set(SafetyReportedField.allCases.map(\.rawValue)),
            [
                "content", "contact_wechat", "contact_qq", "contact_group_number",
                "collection_deadline", "collection_description", "collection_default_note"
            ]
        )
        XCTAssertEqual(
            Set(SafetyReportStatus.allCases.map(\.rawValue)),
            ["received", "reviewing", "handled", "no_violation"]
        )

        XCTAssertThrowsError(try JSONDecoder().decode(SafetyReportStatus.self, from: Data("\"unknown\"".utf8)))
    }

    func testSafetyReportResponseEnvelopesRoundTrip() throws {
        let report = makeReport()
        let responseData = try JSONEncoder().encode(SafetyReportResponse(report: report, duplicate: true))
        let responsePayload = try XCTUnwrap(JSONSerialization.jsonObject(with: responseData) as? [String: Any])
        let encodedReport = try XCTUnwrap(responsePayload["report"] as? [String: Any])

        XCTAssertEqual(encodedReport["id"] as? String, "rp-1")
        XCTAssertEqual(responsePayload["duplicate"] as? Bool, true)

        let decodedResponse = try JSONDecoder().decode(SafetyReportResponse.self, from: responseData)
        XCTAssertEqual(decodedResponse.report, report)
        XCTAssertTrue(decodedResponse.duplicate)

        let reportsData = try JSONEncoder().encode(SafetyReportsResponse(reports: [report]))
        let reportsPayload = try XCTUnwrap(JSONSerialization.jsonObject(with: reportsData) as? [String: Any])
        let encodedReports = try XCTUnwrap(reportsPayload["reports"] as? [[String: Any]])

        XCTAssertEqual(encodedReports.map { $0["id"] as? String }, ["rp-1"])

        let decodedReports = try JSONDecoder().decode(SafetyReportsResponse.self, from: reportsData)
        XCTAssertEqual(decodedReports.reports, [report])
    }

    private func makeReport() -> SafetyReport {
        SafetyReport(
            id: "rp-1",
            caseID: "sc-1",
            sourceType: .post,
            sourceID: "p-1",
            subjectType: .collection,
            subjectID: "col-1",
            reasonCode: .invalidContact,
            reportedField: .contactWechat,
            detail: "集合页中的微信号已失效",
            status: .reviewing,
            createdAt: "2026-07-11T08:30:00.000Z",
            updatedAt: "2026-07-11T09:00:00.000Z"
        )
    }
}
