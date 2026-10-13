import PhotosUI
import SwiftUI

struct NewSessionView: View {
    var onCreated: (SessionSummary) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @AppStorage("lastAgent") private var agentRaw = AgentKind.claude.rawValue
    @AppStorage("lastFolder") private var cwd = ""
    @State private var mode = "default"
    @State private var prompt = ""
    @State private var projects: Projects?
    @State private var starting = false
    @State private var error: String?
    @State private var browsing = false

    private var agent: AgentKind { AgentKind(rawValue: agentRaw) ?? .claude }

    var body: some View {
        NavigationStack {
            Form {
                Section("Agent") {
                    Picker("Agent", selection: $agentRaw) {
                        ForEach(AgentKind.allCases) { kind in
                            Text(kind.displayName).tag(kind.rawValue)
                        }
                    }
                    .pickerStyle(.segmented)
                    if let status = model.info?.agents[agent.rawValue], !status.available {
                        Label(status.detail ?? "Not available on this PC", systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    }
                }

                Section {
                    TextField("C:\\Users\\you\\code\\project", text: $cwd)
                        .font(.body.monospaced())
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button {
                        browsing = true
                    } label: {
                        Label("Browse folders on the PC…", systemImage: "folder.badge.gearshape")
                    }
                    if let projects {
                        ForEach(projects.pinned + Array(projects.recent.prefix(8)), id: \.self) { dir in
                            Button {
                                cwd = dir
                            } label: {
                                HStack {
                                    Image(systemName: projects.pinned.contains(dir) ? "pin.fill" : "clock")
                                        .foregroundStyle(.secondary)
                                    Text(dir).lineLimit(1).truncationMode(.head).foregroundStyle(.primary)
                                    Spacer()
                                    if cwd == dir { Image(systemName: "checkmark").foregroundStyle(.tint) }
                                }
                            }
                            .swipeActions {
                                if projects.pinned.contains(dir) {
                                    Button("Unpin") { Task { await setPinned(dir, false) } }
                                } else {
                                    Button("Pin") { Task { await setPinned(dir, true) } }.tint(.orange)
                                }
                            }
                        }
                    }
                } header: {
                    Text("Project folder")
                } footer: {
                    Text("The agent works inside this folder on your PC. Swipe a folder to pin it.")
                }

                if agent == .claude {
                    Section("Permissions") {
                        Picker("Mode", selection: $mode) {
                            ForEach(PermissionModeOption.all) { option in
                                Text(option.title).tag(option.id)
                            }
                        }
                    }
                }

                Section("First message") {
                    TextField("What should it work on?", text: $prompt, axis: .vertical)
                        .lineLimit(3...10)
                }

                if let error {
                    Section { Text(error).foregroundStyle(.red).font(.footnote) }
                }
            }
            .navigationTitle("New session")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if starting {
                        ProgressView()
                    } else {
                        Button("Start") { Task { await start() } }
                            .disabled(cwd.trimmingCharacters(in: .whitespaces).isEmpty || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
            .navigationDestination(isPresented: $browsing) {
                FolderPickerView(path: cwd.isEmpty ? nil : cwd) { picked in
                    cwd = picked
                    browsing = false
                }
            }
            .task { await loadProjects() }
        }
    }

    private func loadProjects() async {
        guard let client = model.client else { return }
        projects = try? await client.get("/api/projects", as: Projects.self)
        if cwd.isEmpty, let first = projects?.pinned.first ?? projects?.recent.first { cwd = first }
    }

    private func setPinned(_ dir: String, _ pinned: Bool) async {
        guard let client = model.client else { return }
        if pinned {
            try? await client.send("POST", "/api/projects", json: ["path": dir])
        } else {
            try? await client.send("DELETE", "/api/projects", query: ["path": dir])
        }
        await loadProjects()
    }

    private func start() async {
        starting = true
        error = nil
        defer { starting = false }
        do {
            let created = try await model.createSession(
                agent: agent,
                cwd: cwd.trimmingCharacters(in: .whitespaces),
                text: prompt,
                images: [],
                mode: agent == .claude ? mode : nil
            )
            dismiss()
            onCreated(created)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Browse PC folders and pick one (used for choosing a project folder).
struct FolderPickerView: View {
    var path: String?
    var onPick: (String) -> Void
    @Environment(AppModel.self) private var model
    @State private var listing: FileListing?
    @State private var roots: Roots?
    @State private var current: String?
    @State private var error: String?

    var body: some View {
        List {
            if let error {
                Text(error).foregroundStyle(.red).font(.footnote)
            }
            if current == nil, let roots {
                Section("Places") {
                    ForEach(roots.places, id: \.path) { place in
                        Button { Task { await open(place.path) } } label: { Label(place.name, systemImage: place.icon) }
                    }
                }
                Section("Drives") {
                    ForEach(roots.drives, id: \.path) { drive in
                        Button { Task { await open(drive.path) } } label: { Label(drive.name, systemImage: "internaldrive") }
                    }
                }
            } else if let listing {
                Section {
                    Button {
                        Task {
                            if let parent = listing.parent { await open(parent) } else { current = nil }
                        }
                    } label: {
                        Label("Up", systemImage: "arrow.up")
                    }
                }
                Section(listing.path) {
                    ForEach(listing.entries.filter { $0.dir && !$0.hidden }) { entry in
                        Button { Task { await open(entry.path) } } label: { Label(entry.name, systemImage: "folder") }
                    }
                }
            }
        }
        .navigationTitle(current.map { name(of: $0) } ?? "Choose folder")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Use this folder") { if let current { onPick(current) } }
                    .disabled(current == nil)
            }
        }
        .task {
            if let client = model.client { roots = try? await client.get("/api/fs/roots", as: Roots.self) }
            if let path { await open(path) }
        }
    }

    private func name(of path: String) -> String {
        path.split(whereSeparator: { $0 == "\\" || $0 == "/" }).last.map(String.init) ?? path
    }

    private func open(_ dir: String) async {
        guard let client = model.client else { return }
        do {
            listing = try await client.get("/api/fs/list", query: ["path": dir])
            current = listing?.path
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
