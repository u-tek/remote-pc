import SwiftUI

enum AgentRoute: Hashable {
    case session(String)
    case inbox
}

struct SessionsView: View {
    @Environment(AppModel.self) private var model
    @State private var path = NavigationPath()
    @State private var filter: AgentKind?
    @State private var showNew = false
    @State private var search = ""

    private var visible: [SessionSummary] {
        model.sessions.filter { s in
            (filter == nil || s.agent == filter) &&
                (search.isEmpty || s.title.localizedCaseInsensitiveContains(search) || s.cwd.localizedCaseInsensitiveContains(search))
        }
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                ConnectionRow()
                if model.pendingCount > 0 {
                    Section {
                        NavigationLink(value: AgentRoute.inbox) {
                            Label("\(model.pendingCount) waiting for you", systemImage: "bell.badge.fill")
                                .foregroundStyle(.orange)
                                .font(.headline)
                        }
                    }
                }
                ForEach(model.sessionErrors.keys.sorted(), id: \.self) { agent in
                    Label("\(AgentKind(rawValue: agent)?.displayName ?? agent): \(model.sessionErrors[agent] ?? "")", systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                let live = visible.filter(\.live)
                if !live.isEmpty {
                    Section("Running") {
                        ForEach(live, id: \.key) { s in
                            NavigationLink(value: AgentRoute.session(s.key)) { SessionRow(session: s) }
                        }
                    }
                }
                Section(live.isEmpty ? "Sessions" : "Recent") {
                    ForEach(visible.filter { !$0.live }, id: \.key) { s in
                        NavigationLink(value: AgentRoute.session(s.key)) { SessionRow(session: s) }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .searchable(text: $search, prompt: "Search sessions")
            .refreshable {
                await model.refreshSessions()
                await model.refreshPending()
            }
            .overlay {
                if model.sessions.isEmpty && !model.sessionsLoading && model.connection == .connected {
                    ContentUnavailableView {
                        Label("No sessions yet", systemImage: "sparkles")
                    } description: {
                        Text("Start Claude Code or OpenCode in one of your project folders.")
                    } actions: {
                        Button("New session") { showNew = true }.buttonStyle(.borderedProminent)
                    }
                }
            }
            .navigationTitle("Agents")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Picker("Agent", selection: $filter) {
                            Text("All agents").tag(AgentKind?.none)
                            ForEach(AgentKind.allCases) { kind in
                                Label(kind.displayName, systemImage: kind.symbol).tag(AgentKind?.some(kind))
                            }
                        }
                    } label: {
                        Image(systemName: filter == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showNew = true } label: { Image(systemName: "plus") }
                        .disabled(model.connection != .connected)
                }
            }
            .navigationDestination(for: AgentRoute.self) { route in
                switch route {
                case .session(let key): ChatView(sessionKey: key)
                case .inbox: InboxView()
                }
            }
            .sheet(isPresented: $showNew) {
                NewSessionView { created in
                    path.append(AgentRoute.session(created.key))
                }
            }
            .onChange(of: model.pendingNavigation) { _, key in
                guard let key else { return }
                path = NavigationPath()
                path.append(AgentRoute.session(key))
                model.pendingNavigation = nil
            }
        }
    }
}

struct ConnectionRow: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if model.connection != .connected {
            HStack(spacing: 10) {
                if model.connection == .connecting {
                    ProgressView()
                } else {
                    Image(systemName: "wifi.exclamationmark").foregroundStyle(.orange)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.selectedPC?.name ?? "PC").font(.subheadline.bold())
                    Text(model.connection.label).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                Spacer()
                Button("Retry") { model.reconnect() }
                    .buttonStyle(.bordered)
            }
        }
    }
}

struct SessionRow: View {
    var session: SessionSummary

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                Image(systemName: session.agent.symbol)
                    .font(.title3)
                    .frame(width: 36, height: 36)
                    .background(session.agent == .claude ? Color.orange.opacity(0.15) : Color.blue.opacity(0.15), in: RoundedRectangle(cornerRadius: 9))
                    .foregroundStyle(session.agent == .claude ? Color.orange : Color.blue)
                StatusDot(status: session.status)
                    .offset(x: 3, y: 3)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(session.title)
                    .font(.body)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    Label(session.folderName, systemImage: "folder")
                    if let branch = session.branch, !branch.isEmpty {
                        Label(branch, systemImage: "arrow.triangle.branch")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                Text(session.updatedDate, format: .relative(presentation: .named))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            Spacer(minLength: 0)
            if session.pending > 0 {
                Text("\(session.pending)")
                    .font(.caption.bold())
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(.orange, in: Capsule())
                    .foregroundStyle(.white)
            }
        }
        .padding(.vertical, 2)
    }
}

struct StatusDot: View {
    var status: String

    var color: Color {
        switch status {
        case "running": return .green
        case "waiting": return .orange
        case "error": return .red
        default: return .clear
        }
    }

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 11, height: 11)
            .overlay(Circle().stroke(Color(.systemBackground), lineWidth: status == "idle" ? 0 : 2))
    }
}

struct InboxView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 14) {
                ForEach(model.questions) { q in
                    VStack(alignment: .leading, spacing: 6) {
                        Button { model.open(sessionKey: q.sessionKey) } label: {
                            Label(q.sessionTitle, systemImage: q.agent.symbol).font(.caption).lineLimit(1)
                        }
                        QuestionCard(question: q)
                    }
                }
                ForEach(model.approvals) { a in
                    VStack(alignment: .leading, spacing: 6) {
                        Button { model.open(sessionKey: a.sessionKey) } label: {
                            Label(a.sessionTitle, systemImage: a.agent.symbol).font(.caption).lineLimit(1)
                        }
                        ApprovalCard(approval: a)
                    }
                }
            }
            .padding()
        }
        .overlay {
            if model.pendingCount == 0 {
                ContentUnavailableView("All caught up", systemImage: "checkmark.circle", description: Text("Nothing is waiting for your approval."))
            }
        }
        .navigationTitle("Waiting for you")
        .navigationBarTitleDisplayMode(.inline)
    }
}
