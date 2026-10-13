import LocalAuthentication
import SwiftUI
import UIKit

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("faceIDLock") private var faceIDLock = false
    @State private var locked = false
    @State private var backgroundedAt: Date?
    @State private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    var body: some View {
        ZStack {
            if model.pcs.isEmpty {
                OnboardingView()
            } else {
                MainTabView()
            }
            if locked {
                LockView { withAnimation { locked = false } }
                    .transition(.opacity)
                    .zIndex(10)
            }
        }
        .overlay(alignment: .top) { BannerOverlay() }
        .overlay(alignment: .bottom) { ToastOverlay() }
        .onAppear { if faceIDLock { locked = true } }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                endBackgroundTask()
                if faceIDLock, let since = backgroundedAt, Date().timeIntervalSince(since) > 30 { locked = true }
                backgroundedAt = nil
                model.sceneBecameActive()
            case .background:
                backgroundedAt = Date()
                model.sceneEnteredBackground()
                beginBackgroundTask()
            default:
                break
            }
        }
    }

    /// Ask iOS for a little extra time so approvals that arrive right after leaving the app still notify.
    private func beginBackgroundTask() {
        guard backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "keep-connection") {
            endBackgroundTask()
        }
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }
}

struct MainTabView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.selectedTab) {
            PCView()
                .tabItem { Label("PC", systemImage: "pc") }
                .tag(AppTab.pc)
            SessionsView()
                .tabItem { Label("Agents", systemImage: "sparkles") }
                .badge(model.pendingCount)
                .tag(AppTab.agents)
            FilesView()
                .tabItem { Label("Files", systemImage: "folder") }
                .tag(AppTab.files)
            WebListView()
                .tabItem { Label("Web", systemImage: "globe") }
                .tag(AppTab.web)
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(AppTab.settings)
        }
        .fullScreenCover(item: $model.streamTarget) { target in
            RemoteDesktopView(target: target)
                .environment(model)
        }
    }
}

struct LockView: View {
    var onUnlock: () -> Void
    @State private var error: String?

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "lock.fill")
                .font(.system(size: 48))
                .foregroundStyle(.tint)
            Text("Remote PC is locked")
                .font(.title2.bold())
            if let error {
                Text(error).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            Button("Unlock") { authenticate() }
                .buttonStyle(.borderedProminent)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .task { authenticate() }
    }

    private func authenticate() {
        let context = LAContext()
        var policyError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &policyError) else {
            // No passcode on the device: nothing to check against, so don't lock the user out.
            onUnlock()
            return
        }
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock Remote PC") { success, err in
            DispatchQueue.main.async {
                if success {
                    onUnlock()
                } else {
                    error = err?.localizedDescription
                }
            }
        }
    }
}

struct BannerOverlay: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let banner = model.banner {
            Button {
                if let key = banner.sessionKey { model.open(sessionKey: key) }
                model.banner = nil
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: banner.symbol)
                        .font(.title2)
                        .foregroundStyle(.tint)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(banner.title).font(.subheadline.bold()).lineLimit(2)
                        Text(banner.message).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .padding(14)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .shadow(color: .black.opacity(0.15), radius: 12, y: 4)
                .padding(.horizontal)
            }
            .buttonStyle(.plain)
            .transition(.move(edge: .top).combined(with: .opacity))
            .id(banner.id)
            .task(id: banner.id) {
                try? await Task.sleep(for: .seconds(5))
                if model.banner?.id == banner.id {
                    withAnimation { model.banner = nil }
                }
            }
            .gesture(DragGesture().onEnded { value in
                if value.translation.height < -10 { withAnimation { model.banner = nil } }
            })
        }
    }
}

struct ToastOverlay: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let toast = model.toast {
            Text(toast)
                .font(.footnote.weight(.medium))
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.thickMaterial, in: Capsule())
                .padding(.bottom, 70)
                .transition(.opacity)
                .allowsHitTesting(false)
        }
    }
}
