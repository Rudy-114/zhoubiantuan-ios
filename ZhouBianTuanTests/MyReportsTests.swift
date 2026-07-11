import Foundation
import SwiftUI
import XCTest
@testable import ZhouBianTuan

final class MyReportsTests: XCTestCase {
    func testSummaryExposesOnlySafeFields() {
        let report = SafetyReport(
            id: "rp-public",
            caseID: "case-private",
            sourceType: .post,
            sourceID: "post-private",
            subjectType: .user,
            subjectID: "user-private",
            reasonCode: .suspectedScam,
            reportedField: .content,
            detail: "private report detail",
            status: .received,
            createdAt: "2026-07-11T01:00:00.000Z",
            updatedAt: "2026-07-11T02:00:00.000Z"
        )

        let summary = SafetyReportSummary(report: report)

        XCTAssertEqual(summary.id, "rp-public")
        XCTAssertEqual(summary.reasonCode, .suspectedScam)
        XCTAssertEqual(summary.targetType, .post)
        XCTAssertEqual(summary.status, .received)
        XCTAssertEqual(summary.updatedAt, "2026-07-11T02:00:00.000Z")
        XCTAssertEqual(
            Set(Mirror(reflecting: summary).children.compactMap(\.label)),
            ["id", "reasonCode", "targetType", "status", "updatedAt"]
        )
    }

    func testMyReportsProductionSourcesWireNavigationStatesLayoutRetryRefreshAndSupplementSheet() throws {
        let settingsSource = compacted(try source("ZhouBianTuan/SettingsViews.swift"))
        let appSource = compacted(try source("ZhouBianTuan/ZhouBianTuanApp.swift"))
        let reportsSource = compacted(try source("ZhouBianTuan/MyReportsView.swift"))
        let reportRowSource = try section(
            of: reportsSource,
            from: "privatestructMyReportRow:View",
            to: "privatestructMyReportSupplementSheet:View"
        )

        XCTAssertTrue(reportsSource.contains("staticletroute=Route.myReports"))
        XCTAssertTrue(reportsSource.contains("staticlettitle=\"我的举报\""))
        XCTAssertTrue(reportsSource.contains("staticletsystemImage=\"checkmark.shield\""))
        XCTAssertTrue(settingsSource.contains("NavigationLink(value:MyReportsNavigationEntry.route){"))
        XCTAssertTrue(settingsSource.contains("icon:MyReportsNavigationEntry.systemImage"))
        XCTAssertTrue(settingsSource.contains("title:MyReportsNavigationEntry.title"))
        XCTAssertTrue(appSource.contains("casemyReports"))
        XCTAssertTrue(appSource.contains("case.myReports:MyReportsView()"))

        XCTAssertTrue(reportsSource.contains("if!store.hasFinishedMyReportsLoad&&summaries.isEmpty{MyReportsLoadingRow()}"))
        XCTAssertTrue(reportsSource.contains("elseifsummaries.isEmpty&&store.myReportsErrorMessage==nil{MyReportsEmptyRow()}"))
        XCTAssertTrue(reportsSource.contains("staticletemptyText=\"还没有提交过举报\""))
        XCTAssertTrue(reportsSource.contains("Text(MyReportsPresentation.emptyText)"))
        XCTAssertTrue(reportsSource.contains("Image(systemName:\"checkmark.shield\")"))
        XCTAssertTrue(reportsSource.contains(".listStyle(.plain)"))
        XCTAssertTrue(reportRowSource.contains("Text(summary.reasonCode.displayName)"))
        XCTAssertTrue(reportRowSource.contains(".fixedSize(horizontal:false,vertical:true)"))
        XCTAssertFalse(reportRowSource.contains(".font(.system(size:"))
        XCTAssertTrue(reportRowSource.contains(".font(.headline)"))
        XCTAssertTrue(reportRowSource.contains(".font(.subheadline)"))
        XCTAssertTrue(reportRowSource.contains(".font(.footnote)"))
        XCTAssertTrue(reportRowSource.contains("@Environment(\\.dynamicTypeSize)privatevardynamicTypeSize"))
        XCTAssertTrue(reportRowSource.contains("MyReportRowLayoutPolicy.usesStackedFooter(for:dynamicTypeSize)"))
        XCTAssertTrue(reportRowSource.contains("ViewThatFits(in:.horizontal)"))
        XCTAssertTrue(reportRowSource.contains("minHeight:MyReportRowLayoutPolicy.minimumHeight"))

        XCTAssertTrue(reportsSource.contains(".task{awaitstore.refreshMyReports()}"))
        XCTAssertTrue(reportsSource.contains(".refreshable{awaitstore.refreshMyReports()}"))
        XCTAssertTrue(reportsSource.contains("MyReportsErrorRow(message:errorMessage){Task{awaitstore.refreshMyReports()}}"))
        XCTAssertTrue(reportsSource.contains("Button(action:retry){Label(\"重试\",systemImage:\"arrow.clockwise\")"))
        XCTAssertTrue(reportsSource.contains("Button{supplementSummary=summary}label:{MyReportRow(summary:summary,offersSupplement:true)}"))
        XCTAssertTrue(reportsSource.contains(".sheet(item:$supplementSummary){summaryinMyReportSupplementSheet(summary:summary)}"))
        XCTAssertTrue(reportsSource.contains("draftState.markAttemptStarted()"))
        XCTAssertTrue(reportsSource.contains(".disabled(draftState.hasStarted)"))
        XCTAssertTrue(reportsSource.contains("evidenceBuffer.isLoading||draftState.hasStarted"))
        XCTAssertTrue(reportsSource.contains(".accessibilityLabel(\"删除证据图片\").disabled(draftState.hasStarted)"))
        XCTAssertTrue(reportsSource.contains("store.discardSafetyReportEvidenceAttempt(clientRequestID:draftState.clientRequestID)"))
    }

    func testMyReportsMapsEveryPublicStatusToExactCopy() {
        let expectedLabels: [(SafetyReportStatus, String)] = [
            (.received, "已接收"),
            (.reviewing, "审核中"),
            (.handled, "已处理"),
            (.noViolation, "未发现明确违规")
        ]

        for (status, label) in expectedLabels {
            XCTAssertEqual(MyReportsPresentation.statusText(for: status), label)
        }
    }

    func testOnlyReceivedAndReviewingReportsOfferEvidenceSupplement() {
        XCTAssertEqual(MyReportsPresentation.supplementActionText, "补充证据")
        XCTAssertTrue(MyReportsPresentation.canSupplementEvidence(status: .received))
        XCTAssertTrue(MyReportsPresentation.canSupplementEvidence(status: .reviewing))
        XCTAssertFalse(MyReportsPresentation.canSupplementEvidence(status: .handled))
        XCTAssertFalse(MyReportsPresentation.canSupplementEvidence(status: .noViolation))
    }

    func testMyReportRowLayoutPolicyStacksFooterAtAccessibilitySizes() {
        XCTAssertEqual(MyReportRowLayoutPolicy.minimumHeight, 96)
        XCTAssertFalse(MyReportRowLayoutPolicy.usesStackedFooter(for: .xxxLarge))
        for size in [
            DynamicTypeSize.accessibility1,
            .accessibility2,
            .accessibility3,
            .accessibility4,
            .accessibility5
        ] {
            XCTAssertTrue(MyReportRowLayoutPolicy.usesStackedFooter(for: size))
        }
    }

    func testMyReportsAuxiliaryTextUsesDynamicTypeAndAccessibilityFallbackLayouts() throws {
        let reportsSource = compacted(try source("ZhouBianTuan/MyReportsView.swift"))

        XCTAssertTrue(reportsSource.contains("Text(errorMessage).font(.footnote)"))
        XCTAssertTrue(reportsSource.contains("Text(summary.reasonCode.displayName).font(.headline)"))
        XCTAssertTrue(reportsSource.contains("Text(\"正在加载举报记录\").font(.subheadline)"))
        XCTAssertTrue(reportsSource.contains("Text(MyReportsPresentation.emptyText).font(.headline)"))
        XCTAssertTrue(reportsSource.contains("Text(message).font(.subheadline)"))
        XCTAssertTrue(reportsSource.contains("Label(\"重试\",systemImage:\"arrow.clockwise\").font(.subheadline)"))
        XCTAssertTrue(reportsSource.contains("@Environment(\\.dynamicTypeSize)privatevardynamicTypeSize"))
        XCTAssertTrue(reportsSource.contains("MyReportsAuxiliaryLayoutPolicy.usesStackedLayout(for:dynamicTypeSize)"))
        XCTAssertTrue(reportsSource.contains("ViewThatFits(in:.horizontal)"))
        XCTAssertTrue(reportsSource.contains(".fixedSize(horizontal:false,vertical:true)"))

        for fixedTextStyle in [
            "Text(errorMessage).font(.system(size:",
            "Text(summary.reasonCode.displayName).font(.system(size:",
            "Text(\"正在加载举报记录\").font(.system(size:",
            "Text(MyReportsPresentation.emptyText).font(.system(size:",
            "Text(message).font(.system(size:",
            "Label(\"重试\",systemImage:\"arrow.clockwise\").font(.system(size:"
        ] {
            XCTAssertFalse(reportsSource.contains(fixedTextStyle), fixedTextStyle)
        }
    }

    func testMyReportsAuxiliaryLayoutPolicyStacksEveryAccessibilitySize() {
        XCTAssertFalse(MyReportsAuxiliaryLayoutPolicy.usesStackedLayout(for: .xxxLarge))
        for size in [
            DynamicTypeSize.accessibility1,
            .accessibility2,
            .accessibility3,
            .accessibility4,
            .accessibility5
        ] {
            XCTAssertTrue(MyReportsAuxiliaryLayoutPolicy.usesStackedLayout(for: size))
        }
    }

    private func source(_ relativePath: String) throws -> String {
        let repositoryRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        return try String(
            contentsOf: repositoryRoot.appendingPathComponent(relativePath),
            encoding: .utf8
        )
    }

    private func compacted(_ source: String) -> String {
        source.components(separatedBy: .whitespacesAndNewlines).joined()
    }

    private func section(of source: String, from start: String, to end: String) throws -> String {
        let startRange = try XCTUnwrap(source.range(of: start))
        let remainingSource = source[startRange.lowerBound...]
        let endRange = try XCTUnwrap(remainingSource.range(of: end))
        return String(remainingSource[..<endRange.lowerBound])
    }
}
