import Foundation
import Observation
import UIKit

/// What to show live: a whole monitor, or one app window ("app mode").
enum StreamTarget: Identifiable, Hashable {
    case desktop(output: Int?)
    case window(hwnd: Int64, title: String, fit: Bool)

    var id: String {
        switch self {
        case .desktop(let output): return "desktop-\(output ?? -1)"
        case .window(let hwnd, _, let fit): return "window-\(hwnd)-\(fit)"
        }
    }

    var title: String {
        switch self {
        case .desktop: return "Desktop"
        case .window(_, let title, _): return title
        }
    }
}

struct StreamOutput: Codable, Hashable, Identifiable {
    var index: Int
    var name: String
    var width: Int
    var height: Int
    var primary: Bool

    var id: Int { index }
    var label: String { "\(primary ? "Main" : "Screen \(index + 1)") · \(width)×\(height)" }
}

enum StreamQuality: String, CaseIterable, Identifiable {
    case high, balanced, low, saver

    var id: String { rawValue }

    var title: String {
        switch self {
        case .high: return "Sharp (1080p60)"
        case .balanced: return "Balanced"
        case .low: return "Smooth on slow Wi-Fi"
        case .saver: return "Cellular saver"
        }
    }

    var lower: StreamQuality? {
        switch self {
        case .high: return .balanced
        case .balanced: return .low
        case .low: return .saver
        case .saver: return nil
        }
    }
}

/// A live view of the PC screen: receives H.264 video over a WebSocket and sends input back.
@Observable
@MainActor
final class StreamClient {
    enum Phase: Equatable {
        case connecting
        case streaming
        case failed(String)
        case ended(String)
    }

    var phase: Phase = .connecting
    var status = "Connecting…"
    var videoSize = CGSize(width: 16, height: 9)
    var regionSize = CGSize(width: 1920, height: 1080)
    var encoder = ""
    var quality: StreamQuality
    var outputs: [StreamOutput] = []
    var output = 0
    var fps = 0
    var kbps = 0
    var notice: String?
    /// Cursor position (0…1 within the picture), reported in trackpad mode.
    var cursor: CGPoint?

    @ObservationIgnored let renderer: VideoRenderer
    @ObservationIgnored let target: StreamTarget
    @ObservationIgnored private let client: APIClient
    @ObservationIgnored private let aspect: Double
    @ObservationIgnored private let session = URLSession(configuration: .default)
    @ObservationIgnored private var task: URLSessionWebSocketTask?
    @ObservationIgnored private var loop: Task<Void, Never>?
    @ObservationIgnored private var statsTask: Task<Void, Never>?
    @ObservationIgnored private var frameCount = 0
    @ObservationIgnored private var byteCount = 0
    @ObservationIgnored private var lastAutoLower = Date.distantPast
    @ObservationIgnored private var stopped = false

    init(client: APIClient, target: StreamTarget, quality: StreamQuality, aspect: Double) {
        self.renderer = VideoRenderer()
        self.client = client
        self.target = target
        self.quality = quality
        self.aspect = aspect
        renderer.onNeedKeyframe = { [weak self] in self?.send(["t": "keyframe"]) }
    }

    func start() {
        stopped = false
        phase = .connecting
        status = "Connecting…"
        renderer.reset()
        var query = ["quality": quality.rawValue, "aspect": String(format: "%.4f", aspect)]
        switch target {
        case .desktop(let output):
            query["mode"] = "desktop"
            if let output { query["output"] = String(output) }
        case .window(let hwnd, _, let fit):
            query["mode"] = "window"
            query["hwnd"] = String(hwnd)
            query["fit"] = fit ? "1" : "0"
        }
        let socket = session.webSocketTask(with: client.webSocketRequest("/api/stream", query: query))
        socket.maximumMessageSize = 32 * 1024 * 1024
        task = socket
        socket.resume()
        loop = Task { [weak self] in await self?.receive(socket) }
        statsTask?.cancel()
        statsTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard let self else { return }
                self.fps = self.frameCount
                self.kbps = self.byteCount * 8 / 1000
                self.frameCount = 0
                self.byteCount = 0
            }
        }
    }

    func stop() {
        stopped = true
        loop?.cancel()
        statsTask?.cancel()
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
    }

    func restart() {
        stop()
        start()
    }

    private func receive(_ socket: URLSessionWebSocketTask) async {
        do {
            while !Task.isCancelled {
                let message = try await socket.receive()
                switch message {
                case .data(let data): handleBinary(data)
                case .string(let text): handleText(text)
                @unknown default: break
                }
            }
        } catch {
            guard !stopped else { return }
            if case .failed = phase { return }
            if case .ended = phase { return }
            phase = .failed("Lost the connection to your PC. \(error.localizedDescription)")
        }
    }

    private func handleBinary(_ data: Data) {
        guard data.count >= 2, let kind = data.first else { return }
        let flags = data[data.startIndex + 1]
        let body = data.subdata(in: (data.startIndex + 2)..<data.endIndex)
        byteCount += data.count
        if kind == 0 {
            guard body.count >= 4 else { return }
            let spsLen = Int(body[body.startIndex]) << 8 | Int(body[body.startIndex + 1])
            let spsStart = body.startIndex + 2
            guard spsStart + spsLen + 2 <= body.endIndex else { return }
            let sps = body.subdata(in: spsStart..<(spsStart + spsLen))
            let ppsLenIndex = spsStart + spsLen
            let ppsLen = Int(body[ppsLenIndex]) << 8 | Int(body[ppsLenIndex + 1])
            let ppsStart = ppsLenIndex + 2
            guard ppsStart + ppsLen <= body.endIndex else { return }
            renderer.setParameterSets(sps: sps, pps: body.subdata(in: ppsStart..<(ppsStart + ppsLen)))
        } else if kind == 1 {
            frameCount += 1
            renderer.decode(avcc: body, keyframe: flags & 1 == 1)
            if phase != .streaming { phase = .streaming }
        }
    }

    private struct Message: Decodable {
        struct Region: Decodable {
            var width: Double
            var height: Double
        }

        var type: String
        var message: String?
        var width: Double?
        var height: Double?
        var region: Region?
        var encoder: String?
        var quality: String?
        var output: Int?
        var outputs: [StreamOutput]?
        var x: Double?
        var y: Double?
    }

    private func handleText(_ text: String) {
        guard let m = try? JSONDecoder().decode(Message.self, from: Data(text.utf8)) else { return }
        switch m.type {
        case "status":
            status = m.message ?? status
            if phase == .streaming, let message = m.message { flash(message) }
        case "meta":
            if let w = m.width, let h = m.height { videoSize = CGSize(width: w, height: h) }
            if let r = m.region { regionSize = CGSize(width: r.width, height: r.height) }
            encoder = m.encoder ?? ""
            if let q = m.quality.flatMap(StreamQuality.init(rawValue:)) { quality = q }
            outputs = m.outputs ?? outputs
            output = m.output ?? output
        case "cursor":
            if let x = m.x, let y = m.y { cursor = CGPoint(x: x, y: y) }
        case "congested":
            if let lower = quality.lower, Date().timeIntervalSince(lastAutoLower) > 8 {
                lastAutoLower = Date()
                setQuality(lower)
                flash("Weak connection, lowering quality")
            }
        case "error":
            phase = .failed(m.message ?? "Screen streaming failed.")
        case "ended":
            phase = .ended(m.message ?? "The stream ended.")
        default:
            break
        }
    }

    private func flash(_ message: String) {
        notice = message
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            if self?.notice == message { self?.notice = nil }
        }
    }

    // MARK: Sending

    func send(_ object: [String: Any]) {
        guard let task, let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { _ in }
    }

    func setQuality(_ q: StreamQuality) {
        quality = q
        send(["t": "quality", "q": q.rawValue])
    }

    func selectOutput(_ index: Int) {
        output = index
        renderer.reset()
        send(["t": "output", "i": index])
    }

    func keys(_ names: [String]) {
        send(["t": "keys", "keys": names])
    }

    func type(_ text: String) {
        send(["t": "text", "s": text])
    }
}
