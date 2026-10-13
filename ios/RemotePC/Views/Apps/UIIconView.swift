import SwiftUI
import UIKit

extension Color {
    /// Protocol colors: iOS system color names or #RRGGBB.
    static func ui(_ name: String?) -> Color? {
        guard let name, !name.isEmpty else { return nil }
        switch name.lowercased() {
        case "blue": return .blue
        case "green": return .green
        case "red": return .red
        case "orange": return .orange
        case "yellow": return .yellow
        case "pink": return .pink
        case "purple": return .purple
        case "indigo": return .indigo
        case "teal": return .teal
        case "cyan": return .cyan
        case "mint": return .mint
        case "brown": return .brown
        case "gray", "grey": return .gray
        default: break
        }
        var hex = name.trimmingCharacters(in: .whitespaces)
        if hex.hasPrefix("#") { hex.removeFirst() }
        guard hex.count == 6, let v = UInt32(hex, radix: 16) else { return nil }
        return Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}

/// Image bytes for a protocol image source: agent paths ("/api/…", sent with the token), web URLs, or data: URLs.
@MainActor
func loadImageData(_ source: String, client: APIClient?) async -> Data? {
    if source.hasPrefix("data:") || source.hasPrefix("http://") || source.hasPrefix("https://") {
        guard let url = URL(string: source) else { return nil }
        return try? await URLSession.shared.data(from: url).0
    }
    guard let client, let comps = URLComponents(string: source) else { return nil }
    let query = Dictionary((comps.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
    return try? await client.data("GET", comps.path, query: query)
}

/// Images from the agent (needs the token), from SDK apps (data: URLs) or the web.
struct RemoteImage<Placeholder: View>: View {
    let source: String
    var contentMode: ContentMode = .fit
    var cache = true
    @ViewBuilder var placeholder: () -> Placeholder
    @Environment(AppModel.self) private var model
    @State private var image: UIImage?

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
        .task(id: source) { await load() }
    }

    private func load() async {
        let key = ((model.client?.host ?? "") + "|" + source) as NSString
        if cache, let cached = ImageCache.shared.object(forKey: key) {
            image = cached
            return
        }
        guard let data = await loadImageData(source, client: model.client), let ui = UIImage(data: data) else { return }
        if cache { ImageCache.shared.setObject(ui, forKey: key) }
        image = ui
    }
}

/// An icon from the protocol: SF Symbol (tile, circle or plain), picture, or initials.
struct UIIconView: View {
    let icon: UIIcon
    var size: CGFloat = 29

    private var tint: Color { Color.ui(icon.color) ?? .accentColor }

    var body: some View {
        if let image = icon.image {
            RemoteImage(source: image, contentMode: .fill) {
                fallback
            }
            .frame(width: size, height: size)
            .clipShape(icon.style == "circle" ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)))
        } else {
            fallback
        }
    }

    @ViewBuilder
    private var fallback: some View {
        if let text = icon.text {
            Circle()
                .fill((Color.ui(icon.color) ?? .gray).gradient)
                .frame(width: size, height: size)
                .overlay(Text(text).font(.system(size: size * 0.4, weight: .semibold, design: .rounded)).foregroundStyle(.white))
        } else if let symbol = icon.symbol {
            switch icon.style {
            case "tile":
                RoundedRectangle(cornerRadius: size * 0.23, style: .continuous)
                    .fill((Color.ui(icon.color) ?? .gray).gradient)
                    .frame(width: size, height: size)
                    .overlay(Image(systemName: symbol).font(.system(size: size * 0.55, weight: .medium)).foregroundStyle(.white))
            case "circle":
                Circle()
                    .fill((Color.ui(icon.color) ?? .gray).gradient)
                    .frame(width: size, height: size)
                    .overlay(Image(systemName: symbol).font(.system(size: size * 0.5)).foregroundStyle(.white))
            default:
                Image(systemName: symbol)
                    .font(.system(size: size * 0.7))
                    .foregroundStyle(tint)
                    .frame(width: size, height: size)
            }
        } else {
            RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
                .fill(Color(.tertiarySystemFill))
                .frame(width: size, height: size)
        }
    }
}
