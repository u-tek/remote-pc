import AudioToolbox
import Foundation
import Observation
import SwiftUI
import UIKit
import UserNotifications

struct PCProfile: Codable, Identifiable, Hashable {
    var id: UUID
    var name: String
    var host: String
    var port: Int
}

enum ConnectionState: Equatable {
    case idle
    case connecting
    case connected
    case offline(String)

    var label: String {
        switch self {
        case .idle: return "Not connected"
        case .connecting: return "Connecting…"
        case .connected: return "Connected"
        case .offline(let reason): return "Offline — \(reason)"
        }
    }
}

enum AppTab: Hashable {
    case agents, pc, files, web, settings
}

struct Banner: Identifiable, Equatable {
    let id = UUID()
    var title: String
    var message: String
    var symbol: String
    var sessionKey: String?
}

/// Parses `remotepc://pair?host=…&port=…&token=…&name=…` from the agent's QR code.
struct PairingLink {
    var host: String
    var port: Int
    var token: String
    var name: String

    init?(url: URL) {
        guard url.scheme?.lowercased() == "remotepc",
              let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let items = Dictionary((comps.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
        guard let host = items["host"], !host.isEmpty, let token = items["token"], !token.isEmpty else { return nil }
        self.host = host
        self.port = Int(items["port"] ?? "") ?? 8787
        self.token = token
        self.name = (items["name"]?.isEmpty == false ? items["name"] : nil) ?? host
    }

    init?(string: String) {
        guard let url = URL(string: string.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        self.init(url: url)
    }
}

@Observable
@MainActor
final class AppModel {
    private(set) var pcs: [PCProfile] = []
    private(set) var selectedID: UUID?
    private(set) var client: APIClient?
    var connection: ConnectionState = .idle
    var info: AgentInfo?

    var sessions: [SessionSummary] = []
    var sessionErrors: [String: String] = [:]
    var sessionsLoading = false
    var transcripts: [String: [ChatItem]] = [:]
    var approvals: [Approval] = []
    var questions: [QuestionPrompt] = []

    var banner: Banner?
    var toast: String?
    var selectedTab: AppTab = .pc
    /// Live desktop / app currently shown full screen.
    var streamTarget: StreamTarget?
    /// Session currently on screen; no banner is shown for it.
    var openSessionKey: String?
    /// Set to open a session from a banner or notification.
    var pendingNavigation: String?
    var isForeground = true

    @ObservationIgnored private var stream: EventStream?
    @ObservationIgnored private var toastTask: Task<Void, Never>?
    @ObservationIgnored private let defaults = UserDefaults.standard

    init() {
        loadPCs()
        if selectedID != nil { connect() }
    }

    var selectedPC: PCProfile? { pcs.first { $0.id == selectedID } }
    var pendingCount: Int { approvals.count + questions.count }

    func session(_ key: String) -> SessionSummary? { sessions.first { $0.key == key } }

    // MARK: Paired PCs

    private func loadPCs() {
        if let data = defaults.data(forKey: "pcs"), let list = try? JSONDecoder().decode([PCProfile].self, from: data) {
            pcs = list
        }
        if let raw = defaults.string(forKey: "selectedPC"), let id = UUID(uuidString: raw), pcs.contains(where: { $0.id == id }) {
            selectedID = id
        } else {
            selectedID = pcs.first?.id
        }
    }

    private func savePCs() {
        defaults.set(try? JSONEncoder().encode(pcs), forKey: "pcs")
        defaults.set(selectedID?.uuidString, forKey: "selectedPC")
    }

    func addPC(name: String, host: String, port: Int, token: String) {
        let cleanHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        var pc = pcs.first { $0.host == cleanHost && $0.port == port } ?? PCProfile(id: UUID(), name: cleanName, host: cleanHost, port: port)
        pc.name = cleanName.isEmpty ? cleanHost : cleanName
        if let i = pcs.firstIndex(where: { $0.id == pc.id }) {
            pcs[i] = pc
        } else {
            pcs.append(pc)
        }
        Keychain.set(token.trimmingCharacters(in: .whitespacesAndNewlines), for: pc.id.uuidString)
        select(pc.id, force: true)
        flash("Paired with \(pc.name)")
    }

    func removePC(_ id: UUID) {
        Keychain.delete(id.uuidString)
        pcs.removeAll { $0.id == id }
        if selectedID == id {
            select(pcs.first?.id, force: true)
        } else {
            savePCs()
        }
    }

    func select(_ id: UUID?, force: Bool = false) {
        if id == selectedID && !force { return }
        disconnect()
        selectedID = id
        savePCs()
        sessions = []
        transcripts = [:]
        approvals = []
        questions = []
        info = nil
        if id != nil { connect() }
    }

    @discardableResult
    func handleOpenURL(_ url: URL) -> Bool {
        guard let link = PairingLink(url: url) else { return false }
        addPC(name: link.name, host: link.host, port: link.port, token: link.token)
        selectedTab = .agents
        return true
    }

    // MARK: Connection

    func connect() {
        guard let pc = selectedPC else { return }
        guard let token = Keychain.get(pc.id.uuidString) else {
            connection = .offline("missing token, pair again")
            return
        }
        let client = APIClient(host: pc.host, port: pc.port, token: token)
        self.client = client
        connection = .connecting
        stream?.stop()
        let stream = EventStream(request: client.webSocketRequest())
        stream.onMessage = { [weak self] data in self?.handleEvent(data) }
        stream.onDisconnect = { [weak self] reason in
            guard let self else { return }
            if self.connection == .connected || self.connection == .connecting {
                self.connection = .offline(reason)
            }
        }
        self.stream = stream
        stream.start()
        Task { await refreshSessions() }
    }

    func disconnect() {
        stream?.stop()
        stream = nil
        client = nil
        connection = .idle
    }

    func reconnect() {
        if stream == nil {
            connect()
        } else {
            connection = .connecting
            stream?.restart()
        }
        Task {
            await refreshSessions()
            await refreshPending()
        }
    }

    func sceneBecameActive() {
        isForeground = true
        if selectedID != nil, connection != .connected { reconnect() }
    }

    func sceneEnteredBackground() {
        isForeground = false
    }

    // MARK: Events

    private func handleEvent(_ data: Data) {
        guard let event = try? JSONDecoder().decode(EventEnvelope.self, from: data) else { return }
        switch event.type {
        case "hello":
            connection = .connected
            info = event.info
            approvals = event.approvals ?? []
            questions = event.questions ?? []
        case "session":
            if let s = event.session { upsertSession(s) }
        case "items":
            if let key = event.sessionKey, let items = event.items { upsertItems(key, items) }
        case "approval":
            if let a = event.approval, !approvals.contains(where: { $0.id == a.id }) {
                approvals.append(a)
                alert(title: a.title, message: a.sessionTitle, symbol: "hand.raised.fill", sessionKey: a.sessionKey, important: true)
            }
        case "approval_done":
            approvals.removeAll { $0.id == event.id }
        case "question":
            if let q = event.question, !questions.contains(where: { $0.id == q.id }) {
                questions.append(q)
                let title = q.questions.first?.question ?? "\(q.agent.displayName) has a question"
                alert(title: title, message: q.sessionTitle, symbol: "questionmark.bubble.fill", sessionKey: q.sessionKey, important: true)
            }
        case "question_done":
            questions.removeAll { $0.id == event.id }
        case "notice":
            if let message = event.message { flash(message) }
        default:
            break
        }
    }

    private func upsertSession(_ s: SessionSummary) {
        if let i = sessions.firstIndex(where: { $0.key == s.key }) {
            let old = sessions[i]
            sessions[i] = s
            if old.isBusy && s.status == "idle" {
                alert(title: "\(s.agent.displayName) finished", message: s.title, symbol: "checkmark.circle.fill", sessionKey: s.key, important: false)
            }
        } else {
            sessions.insert(s, at: 0)
        }
    }

    private func upsertItems(_ key: String, _ items: [ChatItem]) {
        var list = transcripts[key] ?? []
        var index: [String: Int] = [:]
        for (i, item) in list.enumerated() { index[item.id] = i }
        for item in items {
            if let i = index[item.id] {
                list[i] = item
            } else {
                index[item.id] = list.count
                list.append(item)
            }
        }
        transcripts[key] = list
    }

    private func alert(title: String, message: String, symbol: String, sessionKey: String?, important: Bool) {
        if sessionKey != nil && sessionKey == openSessionKey && isForeground {
            if important { Haptics.warning() }
            return
        }
        if isForeground {
            banner = Banner(title: title, message: message, symbol: symbol, sessionKey: sessionKey)
            if important {
                Haptics.warning()
                AudioServicesPlaySystemSound(1007)
            } else {
                Haptics.success()
            }
        } else {
            Notifications.post(title: title, body: message, sessionKey: sessionKey)
        }
    }

    func flash(_ message: String) {
        toast = message
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2.5))
            if !Task.isCancelled { self?.toast = nil }
        }
    }

    func open(sessionKey: String) {
        selectedTab = .agents
        pendingNavigation = sessionKey
    }

    // MARK: Agent actions

    func refreshSessions() async {
        guard let client else { return }
        sessionsLoading = true
        defer { sessionsLoading = false }
        do {
            let list: SessionList = try await client.get("/api/sessions")
            sessions = list.sessions
            sessionErrors = list.errors
        } catch {
            sessionErrors = ["agent": error.localizedDescription]
        }
    }

    func refreshPending() async {
        guard let client, let pending: PendingList = try? await client.get("/api/approvals") else { return }
        approvals = pending.approvals
        questions = pending.questions
    }

    func loadTranscript(_ session: SessionSummary) async throws {
        guard let client else { return }
        let path = "/api/sessions/\(session.agent.rawValue)/\(session.id)/items"
        let loaded: [ChatItem] = try await client.get(path)
        // Keep anything that streamed in while we were loading.
        let loadedIDs = Set(loaded.map(\.id))
        let extra = (transcripts[session.key] ?? []).filter { !loadedIDs.contains($0.id) }
        transcripts[session.key] = loaded + extra
    }

    func send(_ text: String, images: [Data], to session: SessionSummary) async throws {
        guard let client else { return }
        let payload: [String: Any] = [
            "text": text,
            "images": images.map { ["mime": "image/jpeg", "data": $0.base64EncodedString()] },
        ]
        try await client.send("POST", "/api/sessions/\(session.agent.rawValue)/\(session.id)/prompt", json: payload, timeout: 120)
    }

    func createSession(agent: AgentKind, cwd: String, text: String, images: [Data], mode: String?) async throws -> SessionSummary {
        guard let client else { throw APIError(status: 0, message: "Not connected") }
        var payload: [String: Any] = [
            "agent": agent.rawValue,
            "cwd": cwd,
            "text": text,
            "images": images.map { ["mime": "image/jpeg", "data": $0.base64EncodedString()] },
        ]
        if let mode { payload["mode"] = mode }
        let created: SessionSummary = try await client.send("POST", "/api/sessions", json: payload, as: SessionSummary.self, timeout: 120)
        upsertSession(created)
        return created
    }

    func interrupt(_ session: SessionSummary) async {
        guard let client else { return }
        do {
            try await client.send("POST", "/api/sessions/\(session.agent.rawValue)/\(session.id)/interrupt")
        } catch {
            flash(error.localizedDescription)
        }
    }

    func setMode(_ mode: String, for session: SessionSummary) async {
        guard let client else { return }
        do {
            try await client.send("POST", "/api/sessions/\(session.agent.rawValue)/\(session.id)/mode", json: ["mode": mode])
        } catch {
            flash(error.localizedDescription)
        }
    }

    func decide(_ approval: Approval, _ decision: String, message: String? = nil) async {
        guard let client else { return }
        approvals.removeAll { $0.id == approval.id }
        var payload: [String: Any] = ["decision": decision]
        if let message, !message.isEmpty { payload["message"] = message }
        do {
            try await client.send("POST", "/api/approvals/\(approval.id)", json: payload)
            if decision == "deny" { Haptics.tap() } else { Haptics.success() }
        } catch {
            flash(error.localizedDescription)
            await refreshPending()
        }
    }

    func answer(_ question: QuestionPrompt, answers: [[String]]?) async {
        guard let client else { return }
        questions.removeAll { $0.id == question.id }
        do {
            let payload: [String: Any] = ["answers": answers.map { $0 as Any } ?? NSNull()]
            try await client.send("POST", "/api/questions/\(question.id)", json: payload)
            Haptics.success()
        } catch {
            flash(error.localizedDescription)
            await refreshPending()
        }
    }
}

@MainActor
enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
    static func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
}

@MainActor
enum Notifications {
    static func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    /// Only fires while iOS still lets the app run in the background (usually a few seconds to minutes).
    static func post(title: String, body: String, sessionKey: String?) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        if let sessionKey { content.userInfo = ["sessionKey": sessionKey] }
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}
