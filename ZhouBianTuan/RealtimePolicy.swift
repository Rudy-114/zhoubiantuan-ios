public struct RealtimeFallbackPolicy: Sendable {
    private let delays: [UInt64] = [30, 60, 120, 300]

    public init() {}

    public func delayNanoseconds(forAttempt attempt: Int) -> UInt64 {
        let index = min(max(attempt, 0), delays.count - 1)
        return delays[index] * 1_000_000_000
    }
}

public struct RealtimeConnectionState: Sendable {
    public private(set) var isOpening = false
    public private(set) var isConnected = false

    public init() {}

    public mutating func beginOpening() {
        isOpening = true
        isConnected = false
    }

    public mutating func confirmOpen() {
        isOpening = false
        isConnected = true
    }

    public mutating func disconnect() {
        isOpening = false
        isConnected = false
    }
}

@discardableResult
func cancelCurrentTask<T: AnyObject>(
    _ currentTask: inout T?,
    requestedTask: T?,
    cancel: (T) -> Void
) -> Bool {
    if let requestedTask {
        guard let currentTask, requestedTask === currentTask else { return false }
    }
    if let currentTask {
        cancel(currentTask)
    }
    currentTask = nil
    return true
}

struct RealtimeFallbackState: Sendable {
    private(set) var attempt = 0

    mutating func reset() {
        attempt = 0
    }

    mutating func recordSuccess() {
        attempt = 0
    }

    mutating func recordFailure() {
        attempt = min(attempt + 1, 3)
    }
}

func shouldOpenRealtimeConnection(
    reconnectTaskIsCancelled: Bool,
    hasActiveWebSocketTask: Bool
) -> Bool {
    !reconnectTaskIsCancelled && !hasActiveWebSocketTask
}
