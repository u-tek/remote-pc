import SwiftUI
import UIKit

/// A PC app open on the phone, full screen, drawn with native controls.
struct NativeAppView: View {
    let summary: UIAppSummary
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var session: AppSession?

    var body: some View {
        Group {
            if let session {
                AppContainer(session: session, close: { dismiss() })
                    .environment(session)
            } else {
                ProgressView()
            }
        }
        .onAppear {
            guard session == nil, let client = model.client else { return }
            let s = AppSession(client: client, summary: summary)
            session = s
            s.start()
        }
        .onDisappear { session?.stop() }
    }
}

struct AppContainer: View {
    @Bindable var session: AppSession
    let close: () -> Void
    @Environment(\.openURL) private var openURL
    @State private var path: [String] = []
    @State private var applyingServer = false

    var body: some View {
        ZStack {
            if let view = session.view, let root = view.screens.first {
                NavigationStack(path: $path) {
                    ScreenHost(id: root.id, close: close)
                        .navigationDestination(for: String.self) { id in
                            ScreenHost(id: id, close: nil)
                        }
                }
                .tint(Color.ui(view.app.tint) ?? .accentColor)
                .onAppear { path = Array(view.screens.dropFirst().map(\.id)) }
                .onChange(of: view.screens.map(\.id)) { _, ids in
                    let wanted = Array(ids.dropFirst())
                    guard wanted != path else { return }
                    applyingServer = true
                    path = wanted
                    DispatchQueue.main.async { applyingServer = false }
                }
                .onChange(of: path) { old, new in
                    // The user went back (button or swipe): tell the PC how deep we are now.
                    if !applyingServer, new.count < old.count { session.pop(toDepth: new.count + 1) }
                }
            } else {
                loading
            }
            if let toast = session.toast {
                VStack {
                    Spacer()
                    Text(toast)
                        .font(.footnote.weight(.medium))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.thickMaterial, in: Capsule())
                        .padding(.bottom, 90)
                }
                .transition(.opacity)
                .allowsHitTesting(false)
            }
            if let error = session.error {
                VStack {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .padding(12)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .padding(.horizontal)
                        .onTapGesture { session.error = nil }
                    Spacer()
                }
                .padding(.top, 50)
                .task(id: error) {
                    try? await Task.sleep(for: .seconds(4))
                    if session.error == error { session.error = nil }
                }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: session.toast)
        .sheet(item: Binding(
            get: { session.view?.sheet },
            set: { new in if new == nil, session.view?.sheet != nil { session.dismiss() } }
        )) { sheet in
            NavigationStack {
                ScreenView(screen: liveSheet(sheet), isSheet: true)
            }
            .environment(session)
            .presentationDetents(sheet.style == "list" && sheet.sections.flatMap(\.items).count <= 8 ? [.medium, .large] : [.large])
        }
        .alert(
            session.view?.alert?.title ?? "",
            isPresented: Binding(get: { session.view?.alert != nil }, set: { _ in }),
            presenting: session.view?.alert
        ) { alert in
            ForEach(alert.actions, id: \.ref) { a in
                let role: ButtonRole? = a.role == "destructive" ? .destructive : (a.role == "cancel" ? .cancel : nil)
                Button(a.title ?? "OK", role: role) {
                    session.perform(a)
                }
            }
        } message: { alert in
            if let m = alert.message { Text(m) }
        }
        .sheet(item: $session.shareItem) { item in
            ShareSheet(items: [item.url])
        }
        .onChange(of: session.openURL) { _, url in
            if let url {
                openURL(url)
                session.openURL = nil
            }
        }
    }

    /// The sheet as the PC currently has it (the presented copy would otherwise go stale).
    private func liveSheet(_ sheet: UIScreen) -> UIScreen {
        if let current = session.view?.sheet, current.id == sheet.id { return current }
        return sheet
    }

    @ViewBuilder
    private var loading: some View {
        switch session.phase {
        case .ended(let message):
            ContentUnavailableView {
                Label(session.summary.name, systemImage: "app.dashed")
            } description: {
                Text(message)
            } actions: {
                Button("Back to Home") { close() }.buttonStyle(.borderedProminent)
            }
        default:
            VStack(spacing: 16) {
                if let icon = session.summary.icon {
                    UIIconView(icon: icon, size: 72)
                } else {
                    LetterTile(name: session.summary.name, size: 72)
                }
                Text(session.summary.name).font(.title3.weight(.semibold))
                ProgressView(session.status ?? "Opening…")
                Button("Cancel") { close() }.padding(.top, 8)
            }
        }
    }
}

/// Looks up a screen of the stack by id, so every level stays current as the PC changes.
struct ScreenHost: View {
    let id: String
    let close: (() -> Void)?
    @Environment(AppSession.self) private var session

    var body: some View {
        if let screen = session.view?.screens.first(where: { $0.id == id }) {
            ScreenView(screen: screen, close: close)
        } else {
            ProgressView()
        }
    }
}
