import SwiftUI
import UIKit

@MainActor
enum ImageCache {
    static let shared: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 400
        return cache
    }()
}

/// Loads an image from the agent with the auth header (AsyncImage cannot send one).
/// While a new version loads, the previous image stays on screen.
struct AuthImage<Placeholder: View>: View {
    let path: String
    var query: [String: String] = [:]
    var contentMode: ContentMode = .fit
    var cache = true
    @ViewBuilder var placeholder: () -> Placeholder
    @Environment(AppModel.self) private var model
    @State private var image: UIImage?

    private var key: String {
        path + "?" + query.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: "&")
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
            } else {
                placeholder()
            }
        }
        .task(id: key) { await load() }
    }

    private func load() async {
        if cache, let cached = ImageCache.shared.object(forKey: key as NSString) {
            image = cached
            return
        }
        guard let client = model.client,
              let data = try? await client.data("GET", path, query: query),
              let ui = UIImage(data: data) else { return }
        if cache { ImageCache.shared.setObject(ui, forKey: key as NSString) }
        image = ui
    }
}

/// Rounded tile with the first letter of a name, used when an app has no icon.
struct LetterTile: View {
    let name: String
    var size: CGFloat = 48

    private var color: Color {
        let palette: [Color] = [.blue, .purple, .pink, .orange, .teal, .indigo, .green, .red, .cyan, .mint]
        let sum = name.unicodeScalars.reduce(0) { $0 + Int($1.value) }
        return palette[sum % palette.count]
    }

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
            .fill(color.gradient)
            .frame(width: size, height: size)
            .overlay(
                Text(String(name.prefix(1)).uppercased())
                    .font(.system(size: size * 0.45, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
            )
    }
}

/// UIKit share sheet for files downloaded from the PC.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

struct ShareItem: Identifiable {
    let id = UUID()
    let url: URL
}

enum Format {
    static func bytes(_ value: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: value, countStyle: .file)
    }

    static func memory(_ value: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: value, countStyle: .memory)
    }
}

/// Shown on Windows-only screens when the agent runs on another OS.
struct WindowsOnlyView: View {
    var body: some View {
        ContentUnavailableView(
            "Needs a Windows PC",
            systemImage: "pc",
            description: Text("This screen controls Windows. The agent you are connected to runs on another system.")
        )
    }
}

struct NotConnectedView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ContentUnavailableView {
            Label("Not connected", systemImage: "wifi.slash")
        } description: {
            Text(model.connection.label)
        } actions: {
            Button("Retry") { model.reconnect() }.buttonStyle(.borderedProminent)
        }
    }
}
