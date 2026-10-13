import SwiftUI

/// The PC tab's home: your wallpaper, a live look at your screen, quick controls and open apps.
struct DesktopHomeView: View {
    @Environment(AppModel.self) private var model
    @AppStorage("homeOutput") private var outputIndex = -1
    @State private var outputs: [StreamOutput] = []
    @State private var stamp = 0
    @State private var status: SystemStatus?
    @State private var volume: Double = 50
    @State private var editingVolume = false
    @State private var windows: [WindowInfo] = []
    @State private var previewError = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                preview
                if outputs.count > 1 {
                    Picker("Screen", selection: $outputIndex) {
                        ForEach(outputs) { o in Text(o.primary ? "Main" : "Screen \(o.index + 1)").tag(o.index) }
                    }
                    .pickerStyle(.segmented)
                }
                controls
                openApps
            }
            .padding()
        }
        .background { WallpaperBackground() }
        .task { await refreshLoop() }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(model.selectedPC?.name ?? "Your PC")
                    .font(.largeTitle.bold())
                    .foregroundStyle(.white)
                HStack(spacing: 6) {
                    Circle().fill(model.connection == .connected ? Color.green : Color.orange).frame(width: 8, height: 8)
                    Text(model.connection == .connected ? "Online" : "Offline")
                    if let status, status.hasBattery {
                        Text("·")
                        Image(systemName: status.charging ? "battery.100.bolt" : "battery.75")
                        Text("\(status.battery)%")
                    }
                }
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.8))
            }
            Spacer()
        }
        .shadow(color: .black.opacity(0.4), radius: 6)
    }

    private var preview: some View {
        Button {
            model.streamTarget = .desktop(output: outputIndex >= 0 ? outputIndex : nil)
        } label: {
            ZStack(alignment: .bottom) {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(.black.opacity(0.55))
                    .aspectRatio(16 / 10, contentMode: .fit)
                    .overlay {
                        AuthImage(
                            path: "/api/screen/thumbnail",
                            query: ["output": String(outputIndex), "width": "900", "t": String(stamp)],
                            contentMode: .fit,
                            cache: false
                        ) {
                            VStack(spacing: 8) {
                                Image(systemName: "display").font(.system(size: 40))
                                Text(previewError ? "Preview unavailable" : "Loading your screen…").font(.footnote)
                            }
                            .foregroundStyle(.white.opacity(0.7))
                        }
                        .padding(6)
                    }
                HStack(spacing: 8) {
                    Circle().fill(.red).frame(width: 8, height: 8)
                    Text("LIVE").font(.caption.bold())
                    Spacer()
                    Label("Take control", systemImage: "hand.tap.fill")
                        .font(.subheadline.weight(.semibold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.ultraThinMaterial, in: Capsule())
                .environment(\.colorScheme, .dark)
                .padding(12)
            }
            .shadow(color: .black.opacity(0.35), radius: 14, y: 6)
        }
        .buttonStyle(.plain)
        .disabled(model.connection != .connected)
    }

    private var controls: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Button {
                    Task { await setMuted(!(status?.muted ?? false)) }
                } label: {
                    Image(systemName: (status?.muted ?? false) ? "speaker.slash.fill" : "speaker.wave.2.fill")
                        .frame(width: 28)
                }
                Slider(value: $volume, in: 0...100, step: 1, onEditingChanged: { editing in
                    editingVolume = editing
                    if !editing { Task { await setVolume(volume) } }
                })
                .tint(.white)
            }
            HStack {
                media("backward.fill", "prev")
                Spacer()
                media("playpause.fill", "playpause")
                Spacer()
                media("forward.fill", "next")
                Spacer()
                quick("keyboard", "Keyboard") { model.streamTarget = .desktop(output: outputIndex >= 0 ? outputIndex : nil) }
            }
        }
        .font(.title3)
        .foregroundStyle(.white)
        .padding(16)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .environment(\.colorScheme, .dark)
    }

    private var openApps: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Open on your phone")
                .font(.headline)
                .foregroundStyle(.white)
            Text("Each app is resized to fit your phone while you use it, then put back.")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.75))
            if windows.isEmpty {
                Text("No open windows.")
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.7))
            }
            ForEach(windows.prefix(10)) { w in
                Button {
                    model.streamTarget = .window(hwnd: w.hwnd, title: w.title, fit: true)
                } label: {
                    HStack(spacing: 12) {
                        LetterTile(name: w.process.isEmpty ? w.title : w.process, size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(w.title).font(.subheadline.weight(.medium)).lineLimit(1)
                            Text(w.process).font(.caption).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
                        }
                        Spacer()
                        Image(systemName: "iphone.gen3").font(.title3)
                    }
                    .foregroundStyle(.white)
                    .padding(10)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .environment(\.colorScheme, .dark)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func media(_ symbol: String, _ action: String) -> some View {
        Button {
            Task {
                if let client = model.client { try? await client.send("POST", "/api/system/media", json: ["action": action]) }
                Haptics.tap()
            }
        } label: {
            Image(systemName: symbol)
        }
    }

    private func quick(_ symbol: String, _ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
        }
        .accessibilityLabel(title)
    }

    private func refreshLoop() async {
        await loadOnce()
        var tick = 0
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(2.5))
            if Task.isCancelled { break }
            stamp += 1
            tick += 1
            if tick % 4 == 0 { await loadOnce() }
        }
    }

    private func loadOnce() async {
        guard let client = model.client else { return }
        let screens = try? await client.get("/api/screen/outputs", as: [StreamOutput].self)
        if let screens { outputs = screens }
        let latest = try? await client.get("/api/system/status", as: SystemStatus.self)
        if let latest {
            status = latest
            if !editingVolume, latest.volume >= 0 { volume = Double(latest.volume) }
        }
        let open = try? await client.get("/api/windows", as: [WindowInfo].self)
        if let open { windows = open }
        previewError = model.connection == .connected && outputs.isEmpty
    }

    private func setVolume(_ value: Double) async {
        guard let client = model.client else { return }
        let s = try? await client.send("POST", "/api/system/volume", json: ["level": Int(value)], as: SystemStatus.self)
        if let s { status = s }
    }

    private func setMuted(_ muted: Bool) async {
        guard let client = model.client else { return }
        let s = try? await client.send("POST", "/api/system/volume", json: ["muted": muted], as: SystemStatus.self)
        if let s { status = s }
        Haptics.tap()
    }
}

/// Your actual Windows wallpaper, softened, behind the PC tab.
struct WallpaperBackground: View {
    var body: some View {
        GeometryReader { geo in
            AuthImage(path: "/api/desktop/wallpaper", contentMode: .fill) {
                LinearGradient(colors: [Color(red: 0.15, green: 0.2, blue: 0.45), Color(red: 0.05, green: 0.4, blue: 0.6)], startPoint: .topLeading, endPoint: .bottomTrailing)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
            .blur(radius: 18)
            .overlay(Color.black.opacity(0.35))
        }
        .ignoresSafeArea()
    }
}
