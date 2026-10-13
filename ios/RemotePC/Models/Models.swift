import Foundation

// These types mirror the JSON served by the Windows agent (agent/src). Keep them in sync.

enum AgentKind: String, Codable, CaseIterable, Identifiable, Hashable {
    case claude
    case opencode

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .claude: return "Claude Code"
        case .opencode: return "OpenCode"
        }
    }

    var symbol: String {
        switch self {
        case .claude: return "sparkle"
        case .opencode: return "chevron.left.forwardslash.chevron.right"
        }
    }
}

struct AgentStatus: Codable, Hashable {
    var available: Bool
    var detail: String?
}

struct AgentInfo: Codable, Hashable {
    var name: String
    var version: String
    var platform: String
    var hostname: String
    var windows: Bool
    var host: String
    var agents: [String: AgentStatus]
}

struct SessionSummary: Codable, Hashable, Identifiable {
    var key: String
    var agent: AgentKind
    var id: String
    var title: String
    var cwd: String
    var updatedAt: Double
    var status: String
    var live: Bool
    var pending: Int
    var model: String?
    var branch: String?
    var mode: String?

    var isBusy: Bool { status == "running" || status == "waiting" }
    var updatedDate: Date { Date(timeIntervalSince1970: updatedAt / 1000) }
    var folderName: String {
        let parts = cwd.split(whereSeparator: { $0 == "/" || $0 == "\\" })
        return parts.last.map(String.init) ?? cwd
    }
}

struct SessionList: Codable {
    var sessions: [SessionSummary]
    var errors: [String: String]
}

struct ToolInfo: Codable, Hashable {
    var name: String
    var title: String
    var input: String
    var output: String?
    var status: String
}

struct ChatItem: Codable, Hashable, Identifiable {
    var id: String
    var kind: String
    var text: String?
    var tool: ToolInfo?
    var ts: Double
}

struct Approval: Codable, Hashable, Identifiable {
    var id: String
    var agent: AgentKind
    var sessionKey: String
    var sessionTitle: String
    var title: String
    var detail: String?
    var toolName: String
    var input: String
    var canAlways: Bool
    var createdAt: Double
}

struct QuestionOption: Codable, Hashable {
    var label: String
    var description: String?
}

struct Question: Codable, Hashable {
    var question: String
    var header: String
    var options: [QuestionOption]
    var multiple: Bool
    var custom: Bool
}

struct QuestionPrompt: Codable, Hashable, Identifiable {
    var id: String
    var agent: AgentKind
    var sessionKey: String
    var sessionTitle: String
    var questions: [Question]
    var createdAt: Double
}

struct PendingList: Codable {
    var approvals: [Approval]
    var questions: [QuestionPrompt]
}

struct Projects: Codable {
    var pinned: [String]
    var recent: [String]
}

/// Everything the agent can push over the WebSocket; fields are filled depending on `type`.
struct EventEnvelope: Decodable {
    var type: String
    var info: AgentInfo?
    var approvals: [Approval]?
    var questions: [QuestionPrompt]?
    var session: SessionSummary?
    var sessionKey: String?
    var items: [ChatItem]?
    var approval: Approval?
    var question: QuestionPrompt?
    var id: String?
    var level: String?
    var message: String?
}

// MARK: Files

struct FileEntry: Codable, Hashable, Identifiable {
    var name: String
    var path: String
    var dir: Bool
    var size: Int64
    var mtime: Double
    var hidden: Bool

    var id: String { path }
    var modified: Date { Date(timeIntervalSince1970: mtime / 1000) }
}

struct FileListing: Codable {
    var path: String
    var parent: String?
    var entries: [FileEntry]
}

struct Place: Codable, Hashable {
    var name: String
    var path: String
    var icon: String
}

struct Drive: Codable, Hashable {
    var name: String
    var path: String
}

struct Roots: Codable {
    var places: [Place]
    var drives: [Drive]
}

// MARK: Windows shell

struct AppEntry: Codable, Hashable, Identifiable {
    var name: String
    var id: String
}

struct WindowInfo: Codable, Hashable, Identifiable {
    var hwnd: Int64
    var title: String
    var process: String
    var pid: Int
    var minimized: Bool
    var maximized: Bool
    var foreground: Bool

    var id: Int64 { hwnd }
}

struct ProcInfo: Codable, Hashable, Identifiable {
    var pid: Int
    var name: String
    var cpu: Double
    var memory: Int64
    var title: String?
    var hasWindow: Bool

    var id: Int { pid }
}

struct ProcSnapshot: Codable {
    var cpu: Double
    var memTotal: Int64
    var memUsed: Int64
    var cores: Int
    var processes: [ProcInfo]
}

struct ClipContent: Codable {
    var text: String?
    var image: String?
    var files: [String]?
}

// MARK: Web

struct WebItem: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var port: Int
    var path: String
    var url: String
    var up: Bool
    var mode: String
    var error: String?
}

struct ListeningPort: Codable, Hashable {
    var port: Int
    var process: String
}

struct WebList: Codable {
    var host: String
    var items: [WebItem]
    var listening: [ListeningPort]
}

struct Empty: Codable {}
