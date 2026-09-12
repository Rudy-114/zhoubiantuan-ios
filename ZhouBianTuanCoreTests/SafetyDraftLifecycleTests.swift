import XCTest
@testable import ZhouBianTuanCore

final class SafetyDraftLifecycleTests: XCTestCase {
    func testRetryKeepsClientRequestIDUntilAccepted() {
        var state = SafetyReportDraftState(sourceType: .post, sourceID: "p-1")
        let first = state.clientRequestID

        state.markFailed()

        XCTAssertEqual(state.clientRequestID, first)
    }

    func testMarkAcceptedGeneratesNewClientRequestID() {
        var state = SafetyReportDraftState(sourceType: .post, sourceID: "p-1")
        let first = state.clientRequestID

        state.markAccepted()

        XCTAssertNotEqual(state.clientRequestID, first)
    }

    func testExplicitClientRequestIDRemainsStableUntilAccepted() {
        var state = SafetyReportDraftState(
            sourceType: .directMessage,
            sourceID: "m-1",
            clientRequestID: "request-fixed"
        )

        state.markFailed()

        XCTAssertEqual(state.clientRequestID, "request-fixed")
    }

    func testDifferentStatesGenerateUniqueDefaultClientRequestIDs() {
        let first = SafetyReportDraftState(sourceType: .post, sourceID: "p-1")
        let second = SafetyReportDraftState(sourceType: .post, sourceID: "p-1")

        XCTAssertNotEqual(first.clientRequestID, second.clientRequestID)
    }

    func testEvidenceSupplementEncodesExactBackendFieldNames() throws {
        let supplement = SafetyEvidenceSupplement(
            clientRequestID: "request-1",
            detail: "additional context",
            objectKeys: ["reports/evidence-1.jpg"]
        )

        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(supplement)) as? [String: Any]
        )

        XCTAssertEqual(Set(object.keys), ["clientRequestID", "detail", "objectKeys"])
        XCTAssertEqual(object["clientRequestID"] as? String, "request-1")
        XCTAssertEqual(object["detail"] as? String, "additional context")
        XCTAssertEqual(object["objectKeys"] as? [String], ["reports/evidence-1.jpg"])
    }

    func testSubmissionResetAllowsNextSubmissionImmediately() throws {
        var state = SafetyReportSubmissionState()
        let first = try XCTUnwrap(state.begin())

        state.reset()
        let next = try XCTUnwrap(state.begin())

        XCTAssertNotEqual(next, first)
        XCTAssertTrue(state.isSubmitting)
    }

    func testFinishingOldSubmissionDoesNotClearNewSubmission() throws {
        var state = SafetyReportSubmissionState()
        let old = try XCTUnwrap(state.begin())
        state.reset()
        let current = try XCTUnwrap(state.begin())

        state.finish(old)

        XCTAssertEqual(state.activeSubmissionID, current)
        XCTAssertTrue(state.isSubmitting)
    }

    func testFinishingCurrentSubmissionClearsSubmittingState() throws {
        var state = SafetyReportSubmissionState()
        let current = try XCTUnwrap(state.begin())

        state.finish(current)

        XCTAssertNil(state.activeSubmissionID)
        XCTAssertFalse(state.isSubmitting)
    }
}
