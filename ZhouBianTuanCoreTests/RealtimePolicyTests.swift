import XCTest
@testable import ZhouBianTuanCore

final class RealtimePolicyTests: XCTestCase {
    private final class TaskMock {
        var cancellationCount = 0
    }

    func testFallbackDelaysUseCappedBackoff() {
        let policy = RealtimeFallbackPolicy()

        XCTAssertEqual(policy.delayNanoseconds(forAttempt: 0), 30_000_000_000)
        XCTAssertEqual(policy.delayNanoseconds(forAttempt: 1), 60_000_000_000)
        XCTAssertEqual(policy.delayNanoseconds(forAttempt: 2), 120_000_000_000)
        XCTAssertEqual(policy.delayNanoseconds(forAttempt: 3), 300_000_000_000)
        XCTAssertEqual(policy.delayNanoseconds(forAttempt: 4), 300_000_000_000)
        XCTAssertEqual(policy.delayNanoseconds(forAttempt: 5), 300_000_000_000)
    }

    func testConnectionRequiresConfirmationBeforeBecomingConnected() {
        var state = RealtimeConnectionState()

        state.beginOpening()
        XCTAssertTrue(state.isOpening)
        XCTAssertFalse(state.isConnected)

        state.confirmOpen()
        XCTAssertFalse(state.isOpening)
        XCTAssertTrue(state.isConnected)

        state.disconnect()
        XCTAssertFalse(state.isOpening)
        XCTAssertFalse(state.isConnected)
    }

    func testCancellingMatchingTaskClearsCurrentTask() {
        let task = TaskMock()
        var currentTask: TaskMock? = task

        XCTAssertTrue(cancelCurrentTask(&currentTask, requestedTask: task) { $0.cancellationCount += 1 })
        XCTAssertEqual(task.cancellationCount, 1)
        XCTAssertNil(currentTask)
    }

    func testCancellingStaleTaskLeavesCurrentTaskUntouched() {
        let current = TaskMock()
        let stale = TaskMock()
        var currentTask: TaskMock? = current

        XCTAssertFalse(cancelCurrentTask(&currentTask, requestedTask: stale) { $0.cancellationCount += 1 })
        XCTAssertEqual(current.cancellationCount, 0)
        XCTAssertTrue(currentTask === current)
    }

    func testExplicitCancellationClearsCurrentTask() {
        let task = TaskMock()
        var currentTask: TaskMock? = task

        XCTAssertTrue(cancelCurrentTask(&currentTask, requestedTask: nil) { $0.cancellationCount += 1 })
        XCTAssertEqual(task.cancellationCount, 1)
        XCTAssertNil(currentTask)
    }

    func testFallbackStateCapsFailuresAtThree() {
        var state = RealtimeFallbackState()

        state.recordFailure()
        XCTAssertEqual(state.attempt, 1)
        state.recordFailure()
        XCTAssertEqual(state.attempt, 2)
        state.recordFailure()
        XCTAssertEqual(state.attempt, 3)
        state.recordFailure()
        XCTAssertEqual(state.attempt, 3)
    }

    func testFallbackStateSuccessResetsAttempt() {
        var state = RealtimeFallbackState()
        state.recordFailure()

        state.recordSuccess()

        XCTAssertEqual(state.attempt, 0)
    }

    func testFallbackStateResetClearsPriorFailure() {
        var state = RealtimeFallbackState()
        state.recordFailure()

        state.reset()

        XCTAssertEqual(state.attempt, 0)
    }

    func testReconnectGateRejectsCancelledTask() {
        XCTAssertFalse(shouldOpenRealtimeConnection(reconnectTaskIsCancelled: true, hasActiveWebSocketTask: false))
    }

    func testReconnectGateRejectsActiveWebSocketTask() {
        XCTAssertFalse(shouldOpenRealtimeConnection(reconnectTaskIsCancelled: false, hasActiveWebSocketTask: true))
    }

    func testReconnectGateAllowsIdleActiveReconnectTask() {
        XCTAssertTrue(shouldOpenRealtimeConnection(reconnectTaskIsCancelled: false, hasActiveWebSocketTask: false))
    }
}
