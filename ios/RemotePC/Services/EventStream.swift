import Foundation

/// Keeps a WebSocket open to the agent and reconnects with backoff when it drops.
@MainActor
final class EventStream {
    var onMessage: ((Data) -> Void)?
    var onDisconnect: ((String) -> Void)?

    private let request: URLRequest
    private let session = URLSession(configuration: .default)
    private var task: URLSessionWebSocketTask?
    private var loop: Task<Void, Never>?
    private var stopped = true

    init(request: URLRequest) {
        self.request = request
    }

    func start() {
        guard stopped else { return }
        stopped = false
        loop = Task { [weak self] in
            await self?.run()
        }
    }

    func stop() {
        stopped = true
        loop?.cancel()
        loop = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    /// Drop the current socket and reconnect right away (e.g. after returning to the foreground).
    func restart() {
        stop()
        start()
    }

    private func run() async {
        var attempt = 0
        while !stopped && !Task.isCancelled {
            let socket = session.webSocketTask(with: request)
            task = socket
            socket.resume()
            let pinger = Task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(20))
                    if Task.isCancelled { return }
                    try? await socket.send(.string("{\"type\":\"ping\"}"))
                }
            }
            do {
                while !stopped && !Task.isCancelled {
                    let message = try await socket.receive()
                    attempt = 0
                    switch message {
                    case .string(let text):
                        onMessage?(Data(text.utf8))
                    case .data(let data):
                        onMessage?(data)
                    @unknown default:
                        break
                    }
                }
            } catch {
                if !stopped { onDisconnect?(error.localizedDescription) }
            }
            pinger.cancel()
            socket.cancel(with: .goingAway, reason: nil)
            if stopped || Task.isCancelled { break }
            attempt += 1
            let delay = min(10.0, 0.5 * pow(2.0, Double(min(attempt, 5))))
            try? await Task.sleep(for: .seconds(delay))
        }
    }
}
