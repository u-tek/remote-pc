import SwiftUI
import WebKit

struct WebListView: View {
    @Environment(AppModel.self) private var model
    @State private var list: WebList?
    @State private var error: String?
    @State private var adding = false
    @State private var newName = ""
    @State private var newPort = ""
    @State private var newPath = ""

    private var savedPorts: Set<Int> { Set((list?.items ?? []).map(\.port)) }

    var body: some View {
        NavigationStack {
            List {
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
                if let list {
                    Section {
                        ForEach(list.items) { item in
                            NavigationLink {
                                WebBrowserView(title: item.name, url: URL(string: item.url))
                            } label: {
                                WebItemRow(item: item)
                            }
                            .swipeActions {
                                Button("Remove", role: .destructive) { Task { await remove(item) } }
                            }
                        }
                    } header: {
                        Text("Saved")
                    } footer: {
                        if list.items.isEmpty {
                            Text("Save web apps running on your PC, like a dev server, ComfyUI or Jupyter, to open them here.")
                        }
                    }
                    let unsaved = list.listening.filter { !savedPorts.contains($0.port) }
                    if !unsaved.isEmpty {
                        Section("Listening on your PC") {
                            ForEach(unsaved, id: \.port) { port in
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text("Port \(port.port)").font(.body.monospacedDigit())
                                        Text(port.process).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Button {
                                        Task { await add(name: port.process, port: port.port, path: "") }
                                    } label: {
                                        Image(systemName: "plus.circle.fill").font(.title3)
                                    }
                                    .buttonStyle(.borderless)
                                }
                            }
                        }
                    }
                }
            }
            .overlay {
                if model.client == nil { NotConnectedView() } else if list == nil && error == nil { ProgressView() }
            }
            .navigationTitle("Web")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { adding = true } label: { Image(systemName: "plus") }
                        .disabled(model.client == nil)
                }
            }
            .refreshable { await load() }
            .task(id: model.selectedID) { await load() }
            .alert("Add a web app", isPresented: $adding) {
                TextField("Name", text: $newName)
                TextField("Port, e.g. 3000", text: $newPort).keyboardType(.numberPad)
                TextField("Path (optional)", text: $newPath)
                Button("Add") {
                    let name = newName, port = Int(newPort) ?? 0, path = newPath
                    newName = ""; newPort = ""; newPath = ""
                    Task { await add(name: name, port: port, path: path) }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Anything on localhost works; the agent forwards it over Tailscale.")
            }
        }
    }

    private func load() async {
        guard let client = model.client else { return }
        do {
            list = try await client.get("/api/web", as: WebList.self)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func add(name: String, port: Int, path: String) async {
        guard let client = model.client else { return }
        do {
            try await client.send("POST", "/api/web", json: ["name": name, "port": port, "path": path])
            await load()
        } catch {
            model.flash(error.localizedDescription)
        }
    }

    private func remove(_ item: WebItem) async {
        guard let client = model.client else { return }
        try? await client.send("DELETE", "/api/web/\(item.id)")
        await load()
    }
}

struct WebItemRow: View {
    let item: WebItem

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(item.up ? Color.green : Color.secondary.opacity(0.4))
                .frame(width: 10, height: 10)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.name)
                Text(item.url).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1)
                if let error = item.error, item.mode == "failed" {
                    Text(error).font(.caption2).foregroundStyle(.red)
                }
            }
        }
    }
}

struct WebBrowserView: View {
    let title: String
    let url: URL?
    @State private var store = WebViewStore()

    var body: some View {
        Group {
            if let url {
                WebView(url: url, store: store)
                    .ignoresSafeArea(edges: .bottom)
            } else {
                ContentUnavailableView("Invalid address", systemImage: "globe")
            }
        }
        .navigationTitle(store.title.isEmpty ? title : store.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .bottomBar) {
                Button { store.webView?.goBack() } label: { Image(systemName: "chevron.backward") }
                    .disabled(!store.canGoBack)
                Button { store.webView?.goForward() } label: { Image(systemName: "chevron.forward") }
                    .disabled(!store.canGoForward)
                Spacer()
                if store.loading { ProgressView() }
                Spacer()
                Button { store.webView?.reload() } label: { Image(systemName: "arrow.clockwise") }
                if let current = store.webView?.url ?? url {
                    ShareLink(item: current) { Image(systemName: "square.and.arrow.up") }
                }
            }
        }
    }
}

@Observable
final class WebViewStore {
    var title = ""
    var loading = false
    var canGoBack = false
    var canGoForward = false
    @ObservationIgnored weak var webView: WKWebView?
}

struct WebView: UIViewRepresentable {
    let url: URL
    let store: WebViewStore

    func makeCoordinator() -> Coordinator { Coordinator(store: store) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        view.isInspectable = true
        store.webView = view
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let store: WebViewStore

        init(store: WebViewStore) {
            self.store = store
        }

        private func sync(_ view: WKWebView) {
            store.title = view.title ?? ""
            store.canGoBack = view.canGoBack
            store.canGoForward = view.canGoForward
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            store.loading = true
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            store.loading = false
            sync(webView)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            store.loading = false
            sync(webView)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            store.loading = false
            let html = "<html><body style='font-family:-apple-system;padding:24px'><h3>Could not load the page</h3><p>\(error.localizedDescription)</p><p>Is the app running on the PC?</p></body></html>"
            webView.loadHTMLString(html, baseURL: nil)
        }
    }
}
