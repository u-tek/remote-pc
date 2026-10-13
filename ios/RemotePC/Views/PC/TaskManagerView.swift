import SwiftUI

/// Processes grouped by name, like Task Manager's "Processes" tab.
struct ProcessGroup: Identifiable, Hashable {
    var name: String
    var pids: [Int]
    var cpu: Double
    var memory: Int64
    var title: String?
    var hasWindow: Bool

    var id: String { name }
}

enum ProcessSort: String, CaseIterable, Identifiable {
    case cpu = "CPU"
    case memory = "Memory"
    case name = "Name"

    var id: String { rawValue }
}

struct TaskManagerView: View {
    @Environment(AppModel.self) private var model
    @State private var snapshot: ProcSnapshot?
    @State private var error: String?
    @State private var sort: ProcessSort = .cpu
    @State private var search = ""
    @State private var confirmKill: ProcessGroup?

    private var groups: [ProcessGroup] {
        guard let snapshot else { return [] }
        var byName: [String: ProcessGroup] = [:]
        for p in snapshot.processes {
            var g = byName[p.name] ?? ProcessGroup(name: p.name, pids: [], cpu: 0, memory: 0, title: nil, hasWindow: false)
            g.pids.append(p.pid)
            g.cpu += p.cpu
            g.memory += p.memory
            if p.hasWindow {
                g.hasWindow = true
                if g.title == nil { g.title = p.title }
            }
            byName[p.name] = g
        }
        var list = Array(byName.values)
        if !search.isEmpty { list = list.filter { $0.name.localizedCaseInsensitiveContains(search) || ($0.title ?? "").localizedCaseInsensitiveContains(search) } }
        switch sort {
        case .cpu: list.sort { ($0.cpu, $0.memory) > ($1.cpu, $1.memory) }
        case .memory: list.sort { $0.memory > $1.memory }
        case .name: list.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        }
        return list
    }

    var body: some View {
        let all = groups
        List {
            if let snapshot {
                Section {
                    HStack(spacing: 16) {
                        meter(title: "CPU", value: snapshot.cpu / 100, label: String(format: "%.0f%%", snapshot.cpu), tint: .blue)
                        meter(
                            title: "Memory",
                            value: snapshot.memTotal > 0 ? Double(snapshot.memUsed) / Double(snapshot.memTotal) : 0,
                            label: "\(Format.memory(snapshot.memUsed)) of \(Format.memory(snapshot.memTotal))",
                            tint: .purple
                        )
                    }
                    .padding(.vertical, 4)
                }
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.secondary)
            }
            let apps = all.filter(\.hasWindow)
            if !apps.isEmpty {
                Section("Apps (\(apps.count))") {
                    ForEach(apps) { row($0) }
                }
            }
            Section("Background processes (\(all.count - apps.count))") {
                ForEach(all.filter { !$0.hasWindow }) { row($0) }
            }
        }
        .listStyle(.insetGrouped)
        .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search processes")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Sort by", selection: $sort) {
                        ForEach(ProcessSort.allCases) { Text($0.rawValue).tag($0) }
                    }
                } label: {
                    Image(systemName: "arrow.up.arrow.down.circle")
                }
            }
        }
        .overlay {
            if snapshot == nil && error == nil { ProgressView("Measuring…") }
        }
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(2.5))
            }
        }
        .confirmationDialog(
            confirmKill.map { $0.pids.count > 1 ? "End \($0.pids.count) \($0.name) processes?" : "End \($0.name)?" } ?? "",
            isPresented: Binding(get: { confirmKill != nil }, set: { if !$0 { confirmKill = nil } }),
            titleVisibility: .visible
        ) {
            Button("End task", role: .destructive) {
                if let g = confirmKill { Task { await kill(g) } }
            }
        } message: {
            Text("Unsaved work in that app will be lost.")
        }
    }

    private func meter(title: String, value: Double, label: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption.bold()).foregroundStyle(.secondary)
            Gauge(value: min(max(value, 0), 1)) { EmptyView() }
                .gaugeStyle(.linearCapacity)
                .tint(tint)
            Text(label).font(.caption.monospacedDigit())
        }
        .frame(maxWidth: .infinity)
    }

    private func row(_ g: ProcessGroup) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(g.name).font(.subheadline.weight(.medium)).lineLimit(1)
                    if g.pids.count > 1 {
                        Text("\(g.pids.count)")
                            .font(.caption2.bold())
                            .padding(.horizontal, 5)
                            .background(Color(.tertiarySystemFill), in: Capsule())
                    }
                }
                if let title = g.title, !title.isEmpty {
                    Text(title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(String(format: "%.1f%%", g.cpu))
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(g.cpu > 20 ? .orange : .primary)
                Text(Format.memory(g.memory))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .swipeActions {
            Button("End task", role: .destructive) { confirmKill = g }
        }
        .contextMenu {
            Button(role: .destructive) { confirmKill = g } label: { Label("End task", systemImage: "xmark.octagon") }
        }
    }

    private func load() async {
        guard let client = model.client else { return }
        do {
            snapshot = try await client.get("/api/processes", as: ProcSnapshot.self)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func kill(_ g: ProcessGroup) async {
        guard let client = model.client else { return }
        var failures: [String] = []
        for pid in g.pids {
            do {
                try await client.send("POST", "/api/processes/\(pid)/kill")
            } catch {
                failures.append(error.localizedDescription)
            }
        }
        if failures.isEmpty {
            Haptics.success()
            model.flash("Ended \(g.name)")
        } else {
            Haptics.error()
            model.flash(failures.first ?? "Could not end \(g.name)")
        }
        await load()
    }
}
