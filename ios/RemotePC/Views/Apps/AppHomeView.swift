import SwiftUI
import UIKit

/// The phone's home screen for the PC: every open Windows app as an icon that opens natively,
/// apps made with the SDK, and the PC's system tools. The live screen is just one more tool.
struct AppHomeView: View {
    @Environment(AppModel.self) private var model
    @State private var apps: [PhoneAppSummary] = []
    @State private var startApps: [AppEntry] = []
    @State private var search = ""
    @State private var opened: PhoneAppSummary?
    @State private var tool: Tool?
    @State private var launching: String?
    @State private var message: String?
    @State private var loaded = false
    @FocusState private var searching: Bool

    enum Tool: String, Identifiable {
        case start, tasks, clipboard, control
        var id: String { rawValue }
    }

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 4)

    private var windows: [PhoneAppSummary] { apps.filter { $0.kind == "window" } }
    private var sdkApps: [PhoneAppSummary] { apps.filter { $0.kind == "sdk" } }

    var body: some View {
        ZStack {
            WallpaperBackground()
            if model.client == nil || model.connection == .idle {
                NotConnectedView()
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        header
                        searchField
                        if !search.isEmpty {
                            results
                        } else {
                            if model.info?.windows != false {
                                grid(title: "On your PC", items: windows, empty: loaded ? "No apps are open on your PC. Search to start one." : nil)
                            }
                            if !sdkApps.isEmpty { grid(title: "Made for iPhone", items: sdkApps, empty: nil) }
                            tools
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                }
                .scrollDismissesKeyboard(.immediately)
                .refreshable { await load() }
            }
            if let message {
                VStack {
                    Spacer()
                    Text(message)
                        .font(.footnote.weight(.medium))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.thickMaterial, in: Capsule())
                        .padding(.bottom, 24)
                }
                .task(id: message) {
                    try? await Task.sleep(for: .seconds(2.5))
                    if self.message == message { self.message = nil }
                }
            }
        }
        .task { await refreshLoop() }
        .fullScreenCover(item: $opened) { app in
            NativeAppView(summary: app)
                .environment(model)
        }
        .sheet(item: $tool) { tool in
            toolView(tool).environment(model)
        }
    }

    // MARK: Pieces

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(model.selectedPC?.name ?? "Your PC")
                .font(.largeTitle.bold())
            HStack(spacing: 6) {
                Circle().fill(model.connection == .connected ? Color.green : Color.orange).frame(width: 8, height: 8)
                Text(model.connection == .connected ? "Connected" : model.connection.label)
            }
            .font(.subheadline)
            .opacity(0.85)
        }
        .foregroundStyle(.white)
        .shadow(color: .black.opacity(0.35), radius: 6)
        .padding(.top, 8)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
            TextField("Search apps", text: $search)
                .focused($searching)
                .submitLabel(.search)
                .autocorrectionDisabled()
            if !search.isEmpty {
                Button {
                    search = ""
                    searching = false
                } label: {
                    Image(systemName: "xmark.circle.fill")
                }
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial, in: Capsule())
        .environment(\.colorScheme, .dark)
        .onChange(of: searching) { _, now in if now, startApps.isEmpty { Task { await loadStartApps() } } }
    }

    private func grid(title: String, items: [PhoneAppSummary], empty: String?) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.headline).foregroundStyle(.white).shadow(color: .black.opacity(0.3), radius: 4)
            if items.isEmpty, let empty {
                Text(empty).font(.footnote).foregroundStyle(.white.opacity(0.8))
            }
            LazyVGrid(columns: columns, spacing: 18) {
                ForEach(items) { app in
                    AppIconCell(title: label(for: app, among: items), badge: app.focused == true) {
                        appIcon(app)
                    } action: {
                        opened = app
                    }
                    .contextMenu { appMenu(app) }
                }
            }
        }
    }

    /// Two windows of the same app are told apart by their document.
    private func label(for app: PhoneAppSummary, among items: [PhoneAppSummary]) -> String {
        let twins = items.filter { $0.name == app.name }.count > 1
        return twins ? (app.title ?? app.name) : app.name
    }

    @ViewBuilder
    private func appIcon(_ app: PhoneAppSummary) -> some View {
        if app.kind == "window", let image = app.icon?.image {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.ultraThinMaterial)
                .overlay(
                    RemoteImage(source: image) {
                        LetterTile(name: app.name, size: 44)
                    }
                    .frame(width: 42, height: 42)
                )
                .environment(\.colorScheme, .light)
        } else if let icon = app.icon {
            PhoneIconView(icon: icon, size: 60)
        } else {
            LetterTile(name: app.name, size: 60)
        }
    }

    @ViewBuilder
    private func appMenu(_ app: PhoneAppSummary) -> some View {
        Button {
            opened = app
        } label: {
            Label("Open", systemImage: "iphone")
        }
        if app.kind == "window", let hwnd = Int64(app.id.dropFirst()) {
            Button {
                Task { await windowAction(hwnd, "focus") }
            } label: {
                Label("Bring to Front on PC", systemImage: "macwindow")
            }
            Button {
                model.streamTarget = .window(hwnd: hwnd, title: app.name, fit: false)
            } label: {
                Label("Live View", systemImage: "display")
            }
            Button(role: .destructive) {
                Task { await windowAction(hwnd, "close") }
            } label: {
                Label("Close on PC", systemImage: "xmark")
            }
        }
    }

    private var results: some View {
        let open = apps.filter { $0.name.localizedCaseInsensitiveContains(search) || ($0.title ?? "").localizedCaseInsensitiveContains(search) }
        let installed = startApps.filter { $0.name.localizedCaseInsensitiveContains(search) }.prefix(30)
        return VStack(alignment: .leading, spacing: 16) {
            if !open.isEmpty { grid(title: "Open", items: open, empty: nil) }
            VStack(alignment: .leading, spacing: 0) {
                Text("Start on your PC").font(.headline).foregroundStyle(.white).padding(.bottom, 10)
                if installed.isEmpty {
                    Text(startApps.isEmpty ? "Loading apps…" : "No matching apps.").font(.footnote).foregroundStyle(.white.opacity(0.8))
                }
                ForEach(Array(installed)) { app in
                    Button {
                        Task { await launch(app) }
                    } label: {
                        HStack(spacing: 12) {
                            AuthImage(path: "/api/apps/icon", query: ["id": app.id]) {
                                LetterTile(name: app.name, size: 36)
                            }
                            .frame(width: 36, height: 36)
                            Text(app.name).foregroundStyle(.white)
                            Spacer()
                            if launching == app.id { ProgressView().tint(.white) } else { Image(systemName: "arrow.up.forward.app").foregroundStyle(.white.opacity(0.8)) }
                        }
                        .padding(.vertical, 8)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(launching != nil)
                    Divider().overlay(Color.white.opacity(0.2))
                }
            }
            .padding(14)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .environment(\.colorScheme, .dark)
        }
    }

    private var tools: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Tools").font(.headline).foregroundStyle(.white).shadow(color: .black.opacity(0.3), radius: 4)
            LazyVGrid(columns: columns, spacing: 18) {
                toolIcon("Agents", "sparkles", .purple) { model.selectedTab = .agents }
                toolIcon("Files", "folder.fill", .blue) { model.selectedTab = .files }
                toolIcon("Start", "square.grid.3x3.fill", .indigo) { tool = .start }
                toolIcon("Task Manager", "gauge.with.dots.needle.67percent", .green) { tool = .tasks }
                toolIcon("Clipboard", "doc.on.clipboard.fill", .orange) { tool = .clipboard }
                toolIcon("Control Center", "switch.2", .gray) { tool = .control }
                toolIcon("Screen", "display", .teal) { model.streamTarget = .desktop(output: nil) }
            }
        }
    }

    private func toolIcon(_ title: String, _ symbol: String, _ color: Color, action: @escaping () -> Void) -> some View {
        AppIconCell(title: title, badge: false) {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(color.gradient)
                .overlay(Image(systemName: symbol).font(.system(size: 26, weight: .medium)).foregroundStyle(.white))
        } action: {
            action()
        }
    }

    @ViewBuilder
    private func toolView(_ tool: Tool) -> some View {
        switch tool {
        case .control:
            ControlCenterView()
        case .start:
            ToolSheet(title: "Start") { StartMenuView() }
        case .tasks:
            ToolSheet(title: "Task Manager") { TaskManagerView() }
        case .clipboard:
            ToolSheet(title: "Clipboard") { ClipboardView() }
        }
    }

    // MARK: Data

    private func refreshLoop() async {
        await load()
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(3))
            if Task.isCancelled { break }
            if opened == nil { await load() }
        }
    }

    private func load() async {
        guard let client = model.client else { return }
        let fetched = try? await client.get("/api/ui/apps", as: [PhoneAppSummary].self)
        if let list = fetched {
            if list != apps { withAnimation(.spring(duration: 0.35)) { apps = list } }
            loaded = true
        }
    }

    private func loadStartApps() async {
        guard let client = model.client else { return }
        let list = try? await client.get("/api/apps", as: [AppEntry].self)
        if let list { startApps = list }
    }

    private func launch(_ app: AppEntry) async {
        guard let client = model.client else { return }
        struct Launched: Decodable { var app: PhoneAppSummary? }
        launching = app.id
        defer { launching = nil }
        do {
            let result = try await client.send("POST", "/api/ui/launch", json: ["id": app.id], as: Launched.self, timeout: 30)
            search = ""
            searching = false
            if let opened = result.app {
                self.opened = opened
            } else {
                message = "\(app.name) is starting on your PC"
            }
            await load()
        } catch {
            message = error.localizedDescription
        }
    }

    private func windowAction(_ hwnd: Int64, _ action: String) async {
        guard let client = model.client else { return }
        _ = try? await client.send("POST", "/api/windows/\(hwnd)/\(action)")
        Haptics.tap()
        await load()
    }
}

/// An app icon with its name, like the iOS home screen.
struct AppIconCell<Icon: View>: View {
    let title: String
    let badge: Bool
    @ViewBuilder var icon: () -> Icon
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                icon()
                    .frame(width: 60, height: 60)
                    .shadow(color: .black.opacity(0.25), radius: 6, y: 3)
                    .overlay(alignment: .topTrailing) {
                        if badge {
                            Circle().fill(.white).frame(width: 10, height: 10).offset(x: 3, y: -3)
                        }
                    }
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .shadow(color: .black.opacity(0.5), radius: 3)
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(IconPressStyle())
    }
}

struct IconPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.9 : 1)
            .animation(.spring(duration: 0.25), value: configuration.isPressed)
    }
}

/// System tools shown as sheets from the home screen.
struct ToolSheet<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            content()
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                }
        }
    }
}

/// Your actual Windows wallpaper, softened, behind the home screen.
struct WallpaperBackground: View {
    var body: some View {
        GeometryReader { geo in
            AuthImage(path: "/api/desktop/wallpaper", contentMode: .fill) {
                LinearGradient(colors: [Color(red: 0.15, green: 0.2, blue: 0.45), Color(red: 0.05, green: 0.4, blue: 0.6)], startPoint: .topLeading, endPoint: .bottomTrailing)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
            .blur(radius: 18)
            .overlay(Color.black.opacity(0.3))
        }
        .ignoresSafeArea()
    }
}
