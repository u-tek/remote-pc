import Foundation
import Observation
import UIKit

/// One PC app open on the phone: keeps the native view in sync over /api/ui and sends taps back.
@Observable
@MainActor
final class AppSession {
    enum Phase: Equatable {
        case connecting
        case live
        case ended(String)
    }

    let summary: PhoneAppSummary
    var view: PhoneAppView?
    var phase: Phase = .connecting
    var status: String?
    var error: String?
    /// Something the phone does itself (share sheet, file preview) after a `phone:` action.
    var shareItem: ShareItem?
    var openURL: URL?
    var toast: String?
    /// Values the user just changed, shown until the PC confirms them (keeps controls snappy).
    var pending: [String: Any] = [:]

    @ObservationIgnored private let client: APIClient
    @ObservationIgnored private let session = URLSession(configuration: .default)
    @ObservationIgnored private var task: URLSessionWebSocketTask?
    @ObservationIgnored private var loop: Task<Void, Never>?
    @ObservationIgnored private var stopped = false
    @ObservationIgnored private var retries = 0

    init(client: APIClient, summary: PhoneAppSummary) {
        self.client = client
        self.summary = summary
    }

    var apiClient: APIClient { client }

    func start() {
        stopped = false
        let socket = session.webSocketTask(with: client.webSocketRequest("/api/ui", query: ["app": summary.id]))
        socket.maximumMessageSize = 16 * 1024 * 1024
        task = socket
        socket.resume()
        loop = Task { [weak self] in await self?.receive(socket) }
    }

    func stop() {
        stopped = true
        loop?.cancel()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func receive(_ socket: URLSessionWebSocketTask) async {
        while !Task.isCancelled {
            let message: URLSessionWebSocketTask.Message
            do {
                message = try await socket.receive()
            } catch {
                if stopped { return }
                if case .ended = phase { return }
                // Network hiccup: reconnect quietly a few times before saying anything.
                retries += 1
                if retries > 5 {
                    phase = .ended("Lost the connection to your PC.")
                    return
                }
                status = "Reconnecting…"
                try? await Task.sleep(for: .seconds(Double(retries)))
                if !stopped { start() }
                return
            }
            let data: Data
            switch message {
            case .string(let s): data = Data(s.utf8)
            case .data(let d): data = d
            @unknown default: continue
            }
            guard let msg = try? JSONDecoder().decode(PhoneServerMessage.self, from: data) else { continue }
            retries = 0
            switch msg.type {
            case "view":
                if let v = msg.view {
                    if let t = v.toast { showToast(t) }
                    view = v
                    phase = .live
                    status = nil
                    pending.removeAll()
                }
            case "status":
                status = msg.message
            case "error":
                error = msg.message
                pending.removeAll()
            case "ended":
                phase = .ended(msg.message ?? "This app closed.")
                return
            default:
                break
            }
        }
    }

    private func sendJSON(_ object: [String: Any]) {
        guard let task, let data = try? JSONSerialization.data(withJSONObject: object), let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { _ in }
    }

    /// Run an action from the view. `phone:` actions happen on the phone; the rest go to the PC.
    func perform(_ ref: String, value: Any? = nil) {
        if ref.hasPrefix("phone:") {
            Task { await phoneAction(ref) }
            return
        }
        var msg: [String: Any] = ["type": "action", "ref": ref]
        if let value { msg["value"] = value }
        sendJSON(msg)
        Haptics.tap()
    }

    func perform(_ action: PhoneAction, value: Any? = nil) {
        perform(action.ref, value: value ?? action.value?.any)
    }

    /// Change a control now and tell the PC; the next view from the PC replaces the guess.
    func set(_ ref: String, _ value: Any) {
        pending[ref] = value
        perform(ref, value: value)
    }

    func pop(toDepth depth: Int) {
        sendJSON(["type": "pop", "depth": depth])
    }

    func dismiss() {
        sendJSON(["type": "dismiss"])
    }

    func refresh() {
        sendJSON(["type": "refresh"])
    }

    func showToast(_ text: String) {
        toast = text
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            if toast == text { toast = nil }
        }
    }

    private func phoneAction(_ ref: String) async {
        guard let comps = URLComponents(string: ref.replacingOccurrences(of: "phone:", with: "phone://x/")) else { return }
        let verb = comps.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let q = Dictionary((comps.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
        switch verb {
        case "copy":
            UIPasteboard.general.string = q["text"] ?? ""
            showToast("Copied")
        case "open":
            if let s = q["url"], let url = URL(string: s) { openURL = url }
        case "share":
            if let s = q["url"], let url = URL(string: s) { shareItem = ShareItem(url: url) }
        case "download", "share-file":
            guard let path = q["path"] else { return }
            showToast("Downloading…")
            do {
                let file = try await client.download(pcPath: path)
                shareItem = ShareItem(url: file)
            } catch {
                self.error = error.localizedDescription
            }
        default:
            break
        }
    }
}
