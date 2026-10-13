import SwiftUI

struct StartMenuView: View {
    @Environment(AppModel.self) private var model
    @AppStorage("pinnedApps") private var pinnedRaw = "[]"
    @AppStorage("recentApps") private var recentRaw = "[]"
    @State private var apps: [AppEntry] = []
    @State private var search = ""
    @State private var loading = false
    @State private var error: String?

    private var pinned: [String] { decode(pinnedRaw) }
    private var recent: [String] { decode(recentRaw) }

    private var filtered: [AppEntry] {
        search.isEmpty ? apps : apps.filter { $0.name.localizedCaseInsensitiveContains(search) }
    }

    private let columns = [GridItem(.adaptive(minimum: 80, maximum: 110), spacing: 12)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let error {
                    Label(error, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.secondary)
                }
                if search.isEmpty {
                    let pinnedApps = pinned.compactMap { id in apps.first { $0.id == id } }
                    if !pinnedApps.isEmpty { section("Pinned", pinnedApps) }
                    let recentApps = recent.compactMap { id in apps.first { $0.id == id } }.filter { !pinned.contains($0.id) }
                    if !recentApps.isEmpty { section("Recent", Array(recentApps.prefix(8))) }
                }
                section(search.isEmpty ? "All apps" : "Results", filtered)
            }
            .padding()
        }
        .overlay {
            if loading && apps.isEmpty { ProgressView("Loading apps…") }
        }
        .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search apps")
        .refreshable { await load(refresh: true) }
        .task { if apps.isEmpty { await load(refresh: false) } }
    }

    private func section(_ title: String, _ list: [AppEntry]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(list) { app in
                    Button {
                        Task { await launch(app) }
                    } label: {
                        VStack(spacing: 6) {
                            AuthImage(path: "/api/apps/icon", query: ["id": app.id]) {
                                LetterTile(name: app.name)
                            }
                            .frame(width: 48, height: 48)
                            Text(app.name)
                                .font(.caption2)
                                .lineLimit(2)
                                .multilineTextAlignment(.center)
                                .foregroundStyle(.primary)
                                .frame(height: 30, alignment: .top)
                        }
                        .frame(maxWidth: .infinity)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button {
                            Task { await launch(app) }
                        } label: {
                            Label("Open on PC", systemImage: "arrow.up.forward.app")
                        }
                        if pinned.contains(app.id) {
                            Button { setPinned(app.id, false) } label: { Label("Unpin", systemImage: "pin.slash") }
                        } else {
                            Button { setPinned(app.id, true) } label: { Label("Pin to Start", systemImage: "pin") }
                        }
                    }
                }
            }
        }
    }

    private func load(refresh: Bool) async {
        guard let client = model.client else { return }
        loading = true
        defer { loading = false }
        do {
            apps = try await client.get("/api/apps", query: refresh ? ["refresh": "1"] : [:], as: [AppEntry].self)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func launch(_ app: AppEntry) async {
        guard let client = model.client else { return }
        do {
            try await client.send("POST", "/api/apps/launch", json: ["id": app.id])
            Haptics.success()
            model.flash("Opening \(app.name) on \(model.selectedPC?.name ?? "PC")")
            var list = recent.filter { $0 != app.id }
            list.insert(app.id, at: 0)
            recentRaw = encode(Array(list.prefix(12)))
        } catch {
            Haptics.error()
            model.flash(error.localizedDescription)
        }
    }

    private func setPinned(_ id: String, _ pin: Bool) {
        var list = pinned.filter { $0 != id }
        if pin { list.append(id) }
        pinnedRaw = encode(list)
    }

    private func decode(_ raw: String) -> [String] {
        (try? JSONDecoder().decode([String].self, from: Data(raw.utf8))) ?? []
    }

    private func encode(_ list: [String]) -> String {
        (try? String(data: JSONEncoder().encode(list), encoding: .utf8) ?? "[]") ?? "[]"
    }
}
