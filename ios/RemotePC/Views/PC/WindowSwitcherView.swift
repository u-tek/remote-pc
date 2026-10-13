import SwiftUI

/// Alt-Tab for your phone: live thumbnails of open windows; tap to bring one to the front.
struct WindowSwitcherView: View {
    @Environment(AppModel.self) private var model
    @State private var windows: [WindowInfo] = []
    @State private var error: String?
    @State private var thumbStamp = Int(Date().timeIntervalSince1970)
    @State private var confirmClose: WindowInfo?

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: 12)]

    var body: some View {
        ScrollView {
            if let error {
                Label(error, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.secondary).padding()
            }
            LazyVGrid(columns: columns, spacing: 14) {
                ForEach(windows) { window in
                    card(window)
                }
            }
            .padding()
        }
        .overlay {
            if windows.isEmpty && error == nil {
                ContentUnavailableView("No open windows", systemImage: "macwindow.on.rectangle", description: Text("Windows on the PC's desktop show up here."))
            }
        }
        .refreshable { await load() }
        .task {
            // Refresh while visible; thumbnails every ~8 seconds to keep it light.
            var tick = 0
            while !Task.isCancelled {
                await load()
                if tick % 4 == 0 { thumbStamp = Int(Date().timeIntervalSince1970) }
                tick += 1
                try? await Task.sleep(for: .seconds(2))
            }
        }
        .confirmationDialog("Close \(confirmClose?.title ?? "window")?", isPresented: Binding(get: { confirmClose != nil }, set: { if !$0 { confirmClose = nil } }), titleVisibility: .visible) {
            Button("Close window", role: .destructive) {
                if let w = confirmClose { Task { await act(w, "close") } }
            }
        } message: {
            Text("The app may ask to save changes on the PC.")
        }
    }

    private func card(_ window: WindowInfo) -> some View {
        Button {
            Task { await act(window, "focus") }
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color(.secondarySystemBackground))
                    if window.minimized {
                        VStack(spacing: 4) {
                            Image(systemName: "arrow.down.right.and.arrow.up.left").font(.title3)
                            Text("Minimized").font(.caption2)
                        }
                        .foregroundStyle(.secondary)
                    } else {
                        AuthImage(path: "/api/windows/\(window.hwnd)/thumbnail", query: ["width": "480", "t": String(thumbStamp)], contentMode: .fit, cache: false) {
                            Image(systemName: "macwindow").font(.largeTitle).foregroundStyle(.tertiary)
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .padding(4)
                    }
                }
                .frame(height: 110)
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(window.foreground ? Color.accentColor : Color.clear, lineWidth: 2)
                )
                Text(window.title)
                    .font(.caption.weight(.medium))
                    .lineLimit(2)
                    .foregroundStyle(.primary)
                Text(window.process)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button { Task { await act(window, "focus") } } label: { Label("Bring to front", systemImage: "macwindow") }
            if window.minimized || window.maximized {
                Button { Task { await act(window, "restore") } } label: { Label("Restore", systemImage: "arrow.up.left.and.arrow.down.right") }
            }
            if !window.maximized {
                Button { Task { await act(window, "maximize") } } label: { Label("Maximize", systemImage: "arrow.up.left.and.arrow.down.right") }
            }
            if !window.minimized {
                Button { Task { await act(window, "minimize") } } label: { Label("Minimize", systemImage: "minus.rectangle") }
            }
            Button(role: .destructive) { confirmClose = window } label: { Label("Close", systemImage: "xmark.rectangle") }
        }
    }

    private func load() async {
        guard let client = model.client else { return }
        do {
            windows = try await client.get("/api/windows", as: [WindowInfo].self)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func act(_ window: WindowInfo, _ action: String) async {
        guard let client = model.client else { return }
        do {
            try await client.send("POST", "/api/windows/\(window.hwnd)/\(action)")
            Haptics.success()
            if action == "focus" { model.flash("Brought \(window.process) to the front") }
            await load()
            thumbStamp = Int(Date().timeIntervalSince1970)
        } catch {
            Haptics.error()
            model.flash(error.localizedDescription)
        }
    }
}
