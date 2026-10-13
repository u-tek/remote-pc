import SwiftUI
import UIKit

/// The quiet fallback for things that can't be rebuilt natively (video, canvases, games): a live
/// picture of just that part of the window that you can tap, scroll and type into.
struct LiveItemView: View {
    let item: PhoneItem
    @Environment(AppSession.self) private var session
    @Environment(AppModel.self) private var model

    var body: some View {
        if let stream = item.stream {
            LiveWindowStream(hwnd: stream.hwnd, aspect: item.aspect ?? 16 / 9)
        } else {
            LiveRegion(item: item)
        }
    }
}

/// A part of a window refreshed several times a second, with touches sent to that spot.
struct LiveRegion: View {
    let item: PhoneItem
    @Environment(AppSession.self) private var session
    @Environment(AppModel.self) private var model
    @State private var image: UIImage?
    @State private var scrollAccum: CGFloat = 0

    private var ref: String { "live:" + (item.region ?? "") }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color.black
                if let image {
                    Image(uiImage: image).resizable().aspectRatio(contentMode: .fit)
                } else {
                    ProgressView().tint(.white)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture(count: 2) { point in send(point, geo.size, "double") }
            .onTapGesture { point in send(point, geo.size, "tap") }
            .gesture(
                DragGesture(minimumDistance: 8)
                    .onChanged { value in
                        let dy = value.translation.height - scrollAccum
                        if abs(dy) > 24 {
                            scrollAccum = value.translation.height
                            let x = Double(value.startLocation.x / max(geo.size.width, 1))
                            let y = Double(value.startLocation.y / max(geo.size.height, 1))
                            let payload: [String: Any] = ["x": x, "y": y, "kind": "scroll", "dy": dy > 0 ? 120 : -120]
                            session.perform(ref, value: payload)
                        }
                    }
                    .onEnded { _ in scrollAccum = 0 }
            )
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.5).onEnded { _ in
                    let payload: [String: Any] = ["x": 0.5, "y": 0.5, "kind": "secondary"]
                    session.perform(ref, value: payload)
                }
            )
        }
        .aspectRatio(item.aspect ?? 16 / 9, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .task(id: item.region) { await refreshLoop() }
    }

    private func send(_ point: CGPoint, _ size: CGSize, _ kind: String) {
        let payload: [String: Any] = ["x": Double(point.x / max(size.width, 1)), "y": Double(point.y / max(size.height, 1)), "kind": kind]
        session.perform(ref, value: payload)
    }

    private func refreshLoop() async {
        guard let region = item.region, let client = model.client else { return }
        while !Task.isCancelled {
            let width = Int(UIScreen.main.bounds.width * UIScreen.main.scale)
            if let data = try? await client.data("GET", "/api/ui/region", query: ["app": session.summary.id, "rect": region, "w": String(width)]),
               let ui = UIImage(data: data) {
                image = ui
            }
            try? await Task.sleep(for: .milliseconds(250))
        }
    }
}

/// A whole window that can only be shown live: real-time video with touch control, in place.
struct LiveWindowStream: View {
    let hwnd: Int64
    let aspect: Double
    @Environment(AppModel.self) private var model
    @State private var client: StreamClient?
    @State private var keyboard = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Color.black
            if let client {
                RemoteScreen(client: client, mode: .touch, videoSize: client.videoSize, cursor: nil, keyboardVisible: $keyboard, zoomResetToken: 0)
                if client.phase != .streaming {
                    Text(client.status).font(.footnote).foregroundStyle(.white.opacity(0.8)).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            Button {
                keyboard.toggle()
            } label: {
                Image(systemName: "keyboard")
                    .padding(10)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .padding(10)
        }
        .aspectRatio(aspect, contentMode: .fit)
        .onAppear {
            guard client == nil, let api = model.client else { return }
            let c = StreamClient(client: api, target: .window(hwnd: hwnd, title: "", fit: false), quality: .balanced, aspect: aspect)
            client = c
            c.start()
        }
        .onDisappear {
            client?.stop()
            client = nil
        }
    }
}
