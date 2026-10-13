import SwiftUI
import UIKit

/// Full-screen live view of the PC (whole desktop or one app), with touch, trackpad and keyboard control.
struct RemoteDesktopView: View {
    let target: StreamTarget
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @AppStorage("touchMode") private var touchModeRaw = TouchMode.touch.rawValue
    @AppStorage("streamQuality") private var qualityRaw = StreamQuality.balanced.rawValue
    @AppStorage("showStreamStats") private var showStats = false
    @AppStorage("seenStreamTips") private var seenTips = false
    @State private var client: StreamClient?
    @State private var controlsVisible = true
    @State private var keyboardVisible = false
    @State private var showControlCenter = false
    @State private var showTips = false
    @State private var zoomResetToken = 0
    @State private var hideTask: Task<Void, Never>?

    private var touchMode: TouchMode { TouchMode(rawValue: touchModeRaw) ?? .touch }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            if let client {
                RemoteScreen(
                    client: client,
                    mode: touchMode,
                    videoSize: client.videoSize,
                    cursor: client.cursor,
                    keyboardVisible: $keyboardVisible,
                    zoomResetToken: zoomResetToken
                )
                .ignoresSafeArea()

                if client.phase != .streaming {
                    statusOverlay(client)
                }
                if let notice = client.notice {
                    Text(notice)
                        .font(.footnote.weight(.medium))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(.top, 70)
                        .transition(.opacity)
                }
            }
            if controlsVisible {
                controlBar
                    .transition(.move(edge: .top).combined(with: .opacity))
            } else {
                Button {
                    showControls()
                } label: {
                    Image(systemName: "chevron.compact.down")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.85))
                        .frame(width: 64, height: 26)
                        .background(.black.opacity(0.35), in: Capsule())
                }
                .padding(.top, 2)
            }
            if showStats, let client, client.phase == .streaming {
                Text("\(client.fps) fps · \(client.kbps) kbps · \(client.encoder)")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.white)
                    .padding(6)
                    .background(.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 6))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                    .padding(10)
                    .allowsHitTesting(false)
            }
        }
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        .preferredColorScheme(.dark)
        .task { start() }
        .onDisappear {
            client?.stop()
            hideTask?.cancel()
        }
        .onChange(of: client?.phase) { _, phase in
            if phase == .streaming {
                scheduleHide()
                if !seenTips {
                    seenTips = true
                    showTips = true
                }
            }
        }
        .sheet(isPresented: $showControlCenter) {
            ControlCenterView()
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showTips) {
            GestureTipsView()
                .presentationDetents([.medium])
        }
    }

    private func start() {
        guard client == nil, let api = model.client else { return }
        let size = UIScreen.main.bounds.size
        let aspect = Double(min(size.width, size.height) / max(size.width, size.height))
        let c = StreamClient(client: api, target: target, quality: StreamQuality(rawValue: qualityRaw) ?? .balanced, aspect: aspect)
        client = c
        c.start()
    }

    private func showControls() {
        withAnimation(.snappy) { controlsVisible = true }
        scheduleHide()
    }

    private func scheduleHide() {
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(for: .seconds(4))
            if !Task.isCancelled, client?.phase == .streaming {
                withAnimation(.snappy) { controlsVisible = false }
            }
        }
    }

    private var controlBar: some View {
        HStack(spacing: 6) {
            barButton("xmark") { dismiss() }
            VStack(alignment: .leading, spacing: 1) {
                Text(target.title).font(.footnote.weight(.semibold)).lineLimit(1)
                if let client, !client.encoder.isEmpty {
                    Text("\(model.selectedPC?.name ?? "PC") · \(client.quality.title)")
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(1)
                }
            }
            .foregroundStyle(.white)
            Spacer(minLength: 4)
            barButton(touchMode == .touch ? "hand.tap" : "cursorarrow.motionlines") {
                touchModeRaw = touchMode == .touch ? TouchMode.trackpad.rawValue : TouchMode.touch.rawValue
                model.flash(touchMode == .touch ? "Touch: tap where you want to click" : "Trackpad: drag to move the pointer")
            }
            barButton(keyboardVisible ? "keyboard.chevron.compact.down" : "keyboard") {
                keyboardVisible.toggle()
            }
            barButton("slider.horizontal.3") { showControlCenter = true }
            Menu {
                if let client {
                    Section("Quality") {
                        ForEach(StreamQuality.allCases) { q in
                            Button {
                                qualityRaw = q.rawValue
                                client.setQuality(q)
                            } label: {
                                if client.quality == q { Label(q.title, systemImage: "checkmark") } else { Text(q.title) }
                            }
                        }
                    }
                    if client.outputs.count > 1 {
                        Section("Screen") {
                            ForEach(client.outputs) { o in
                                Button {
                                    client.selectOutput(o.index)
                                } label: {
                                    if client.output == o.index { Label(o.label, systemImage: "checkmark") } else { Text(o.label) }
                                }
                            }
                        }
                    }
                    Section("Shortcuts") {
                        Button { client.keys(["win"]) } label: { Label("Start menu", systemImage: "square.grid.2x2") }
                        Button { client.keys(["alt", "tab"]) } label: { Label("Switch app (Alt+Tab)", systemImage: "rectangle.stack") }
                        Button { client.keys(["win", "d"]) } label: { Label("Show desktop", systemImage: "menubar.dock.rectangle") }
                        Button { client.keys(["win", "shift", "s"]) } label: { Label("Snip screenshot", systemImage: "scissors") }
                    }
                    Section {
                        Button { zoomResetToken += 1 } label: { Label("Reset zoom", systemImage: "arrow.down.right.and.arrow.up.left") }
                        Toggle(isOn: $showStats) { Label("Show stats", systemImage: "speedometer") }
                        Button { showTips = true } label: { Label("Gestures", systemImage: "hand.draw") }
                        Button { client.restart() } label: { Label("Reconnect", systemImage: "arrow.clockwise") }
                    }
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(.white.opacity(0.12), in: Circle())
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .environment(\.colorScheme, .dark)
        .padding(.horizontal, 8)
        .padding(.top, 4)
        .simultaneousGesture(TapGesture().onEnded { scheduleHide() })
    }

    private func barButton(_ symbol: String, action: @escaping () -> Void) -> some View {
        Button {
            action()
            scheduleHide()
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 38, height: 38)
                .background(.white.opacity(0.12), in: Circle())
        }
    }

    @ViewBuilder
    private func statusOverlay(_ client: StreamClient) -> some View {
        VStack(spacing: 14) {
            switch client.phase {
            case .connecting:
                ProgressView().controlSize(.large).tint(.white)
                Text(client.status).font(.callout).foregroundStyle(.white.opacity(0.85)).multilineTextAlignment(.center)
            case .failed(let message), .ended(let message):
                Image(systemName: "display.trianglebadge.exclamationmark")
                    .font(.system(size: 44))
                    .foregroundStyle(.white.opacity(0.8))
                Text(message).font(.callout).foregroundStyle(.white).multilineTextAlignment(.center)
                HStack {
                    Button("Close") { dismiss() }.buttonStyle(.bordered)
                    Button("Try again") { client.restart() }.buttonStyle(.borderedProminent)
                }
            case .streaming:
                EmptyView()
            }
        }
        .padding(30)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct GestureTipsView: View {
    @Environment(\.dismiss) private var dismiss

    private struct Tip: Identifiable {
        var symbol: String
        var title: String
        var detail: String
        var id: String { title }
    }

    private let tips: [Tip] = [
        Tip(symbol: "hand.tap", title: "Tap", detail: "Click (tap twice to double-click)"),
        Tip(symbol: "hand.point.up.left", title: "Touch and hold", detail: "Right-click"),
        Tip(symbol: "hand.draw", title: "Drag", detail: "Select or drag things"),
        Tip(symbol: "arrow.up.and.down", title: "Two-finger drag", detail: "Scroll, with momentum"),
        Tip(symbol: "plus.magnifyingglass", title: "Pinch", detail: "Zoom in, and pan while zoomed"),
        Tip(symbol: "cursorarrow.motionlines", title: "Trackpad mode", detail: "Drag anywhere to move the pointer; hold, then drag to drag"),
        Tip(symbol: "keyboard", title: "Keyboard", detail: "Types on the PC; the bar above has Ctrl, Alt, Win, arrows and shortcuts"),
    ]

    var body: some View {
        NavigationStack {
            List(tips) { tip in
                Label {
                    VStack(alignment: .leading) {
                        Text(tip.title).font(.headline)
                        Text(tip.detail).font(.subheadline).foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: tip.symbol).foregroundStyle(.tint)
                }
            }
            .navigationTitle("Controlling your PC")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Got it") { dismiss() } } }
        }
    }
}

struct SystemStatus: Codable {
    var volume: Int
    var muted: Bool
    var hasBattery: Bool
    var battery: Int
    var charging: Bool
    var user: String?
    var uptimeSeconds: Int64
}

/// Volume, media, and power for the PC — like iPhone's Control Center, for your computer.
struct ControlCenterView: View {
    @Environment(AppModel.self) private var model
    @State private var status: SystemStatus?
    @State private var volume: Double = 50
    @State private var editingVolume = false
    @State private var confirm: String?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 12) {
                        Button {
                            Task { await setMute(!(status?.muted ?? false)) }
                        } label: {
                            Image(systemName: (status?.muted ?? false) || volume == 0 ? "speaker.slash.fill" : "speaker.wave.2.fill")
                                .font(.title3)
                                .frame(width: 32)
                        }
                        .buttonStyle(.borderless)
                        Slider(value: $volume, in: 0...100, step: 1, onEditingChanged: { editing in
                            editingVolume = editing
                            if !editing { Task { await setVolume(volume) } }
                        })
                        Text("\(Int(volume))").font(.footnote.monospacedDigit()).frame(width: 30)
                    }
                    HStack {
                        Spacer()
                        mediaButton("backward.fill", "prev")
                        Spacer()
                        mediaButton("playpause.fill", "playpause")
                        Spacer()
                        mediaButton("forward.fill", "next")
                        Spacer()
                    }
                    .padding(.vertical, 4)
                } header: {
                    Text("Sound")
                }

                Section("Power") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 90), spacing: 10)], spacing: 10) {
                        powerButton("Lock", "lock.fill", "lock")
                        powerButton("Screen off", "display", "displayoff")
                        powerButton("Sleep", "moon.fill", "sleep")
                        powerButton("Restart", "arrow.clockwise", "restart")
                        powerButton("Shut down", "power", "shutdown")
                    }
                    .padding(.vertical, 4)
                }

                if let status {
                    Section {
                        if status.hasBattery {
                            LabeledContent("Battery", value: "\(status.battery)%\(status.charging ? " · charging" : "")")
                        }
                        if let user = status.user { LabeledContent("Signed in", value: user) }
                        LabeledContent("Up for", value: uptime(status.uptimeSeconds))
                    }
                }
                if let error {
                    Section { Text(error).font(.footnote).foregroundStyle(.red) }
                }
            }
            .navigationTitle(model.selectedPC?.name ?? "PC")
            .navigationBarTitleDisplayMode(.inline)
            .task { await load() }
            .confirmationDialog(confirmTitle, isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible) {
                if let action = confirm {
                    Button(confirmButton(action), role: .destructive) { Task { await power(action) } }
                }
            } message: {
                Text(confirmMessage)
            }
        }
    }

    private var confirmTitle: String {
        switch confirm {
        case "restart": return "Restart the PC?"
        case "shutdown": return "Shut down the PC?"
        case "sleep": return "Put the PC to sleep?"
        case "lock": return "Lock the PC?"
        default: return ""
        }
    }

    private var confirmMessage: String {
        switch confirm {
        case "lock": return "You can't unlock it from the phone; the live desktop stops working until you sign in at the PC."
        case "sleep", "shutdown": return "The phone loses its connection until the PC is woken or turned back on."
        default: return "It happens in 10 seconds. Unsaved work may be lost."
        }
    }

    private func confirmButton(_ action: String) -> String {
        switch action {
        case "restart": return "Restart"
        case "shutdown": return "Shut down"
        case "sleep": return "Sleep"
        default: return "Lock"
        }
    }

    private func uptime(_ seconds: Int64) -> String {
        let formatter = DateComponentsFormatter()
        formatter.allowedUnits = seconds > 86400 ? [.day, .hour] : [.hour, .minute]
        formatter.unitsStyle = .abbreviated
        return formatter.string(from: TimeInterval(seconds)) ?? "–"
    }

    private func mediaButton(_ symbol: String, _ action: String) -> some View {
        Button {
            Task {
                if let client = model.client {
                    try? await client.send("POST", "/api/system/media", json: ["action": action])
                }
                Haptics.tap()
            }
        } label: {
            Image(systemName: symbol).font(.title2)
        }
        .buttonStyle(.borderless)
    }

    private func powerButton(_ title: String, _ symbol: String, _ action: String) -> some View {
        Button {
            if action == "displayoff" {
                Task { await power(action) }
            } else {
                confirm = action
            }
        } label: {
            VStack(spacing: 6) {
                Image(systemName: symbol).font(.title3)
                Text(title).font(.caption)
            }
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        guard let client = model.client else { return }
        do {
            let s = try await client.get("/api/system/status", as: SystemStatus.self)
            status = s
            if !editingVolume, s.volume >= 0 { volume = Double(s.volume) }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func setVolume(_ value: Double) async {
        guard let client = model.client else { return }
        let s = try? await client.send("POST", "/api/system/volume", json: ["level": Int(value)], as: SystemStatus.self)
        if let s { status = s }
    }

    private func setMute(_ muted: Bool) async {
        guard let client = model.client else { return }
        let s = try? await client.send("POST", "/api/system/volume", json: ["muted": muted], as: SystemStatus.self)
        if let s { status = s }
        Haptics.tap()
    }

    private func power(_ action: String) async {
        guard let client = model.client else { return }
        do {
            try await client.send("POST", "/api/system/power", json: ["action": action])
            Haptics.success()
            model.flash(action == "restart" || action == "shutdown" ? "Happening in 10 seconds" : "Done")
        } catch {
            self.error = error.localizedDescription
        }
    }
}
