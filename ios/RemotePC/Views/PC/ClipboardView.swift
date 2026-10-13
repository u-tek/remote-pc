import PhotosUI
import SwiftUI
import UIKit

/// Two-way clipboard: pull the PC's clipboard to the phone, or push text and photos to it.
struct ClipboardView: View {
    @Environment(AppModel.self) private var model
    @State private var content: ClipContent?
    @State private var pcImage: UIImage?
    @State private var draft = ""
    @State private var photoItem: PhotosPickerItem?
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                if loading && content == nil {
                    ProgressView()
                } else if let content {
                    if let text = content.text, !text.isEmpty {
                        Text(text)
                            .font(.callout)
                            .lineLimit(12)
                            .textSelection(.enabled)
                        Button {
                            UIPasteboard.general.string = text
                            Haptics.success()
                            model.flash("Copied to iPhone")
                        } label: {
                            Label("Copy to iPhone", systemImage: "doc.on.doc")
                        }
                    }
                    if let pcImage {
                        Image(uiImage: pcImage)
                            .resizable()
                            .scaledToFit()
                            .frame(maxHeight: 240)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        Button {
                            UIPasteboard.general.image = pcImage
                            Haptics.success()
                            model.flash("Image copied to iPhone")
                        } label: {
                            Label("Copy image to iPhone", systemImage: "photo.on.rectangle")
                        }
                    }
                    if let files = content.files, !files.isEmpty {
                        ForEach(files, id: \.self) { f in
                            Label(f, systemImage: "doc").font(.footnote).lineLimit(1).truncationMode(.middle)
                        }
                    }
                    if (content.text ?? "").isEmpty && pcImage == nil && (content.files ?? []).isEmpty {
                        Text("The PC clipboard is empty.").foregroundStyle(.secondary)
                    }
                }
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
            } header: {
                HStack {
                    Text("PC clipboard")
                    Spacer()
                    Button {
                        Task { await load() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }

            Section {
                TextField("Type or paste text…", text: $draft, axis: .vertical)
                    .lineLimit(3...8)
                HStack {
                    Button {
                        draft = UIPasteboard.general.string ?? draft
                    } label: {
                        Label("Paste", systemImage: "doc.on.clipboard")
                    }
                    .buttonStyle(.borderless)
                    Spacer()
                    Button {
                        Task { await sendText() }
                    } label: {
                        Label("Send to PC", systemImage: "arrow.up.forward.square")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(draft.isEmpty)
                }
                PhotosPicker(selection: $photoItem, matching: .images) {
                    Label("Send a photo to the PC clipboard", systemImage: "photo")
                }
            } header: {
                Text("Send to PC")
            } footer: {
                Text("Then press Ctrl+V on the PC.")
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task { await sendPhoto(item) }
        }
    }

    private func load() async {
        guard let client = model.client else { return }
        loading = true
        defer { loading = false }
        do {
            let clip = try await client.get("/api/clipboard", as: ClipContent.self)
            content = clip
            pcImage = clip.image.flatMap { Data(base64Encoded: $0) }.flatMap { UIImage(data: $0) }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func sendText() async {
        guard let client = model.client else { return }
        do {
            try await client.send("POST", "/api/clipboard", json: ["text": draft])
            Haptics.success()
            model.flash("Sent to the PC clipboard")
            await load()
        } catch {
            model.flash(error.localizedDescription)
        }
    }

    private func sendPhoto(_ item: PhotosPickerItem) async {
        defer { photoItem = nil }
        guard let client = model.client,
              let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data),
              let png = image.downscaled(maxDimension: 3000).pngData() else { return }
        do {
            try await client.send("POST", "/api/clipboard", json: ["image": png.base64EncodedString()], timeout: 120)
            Haptics.success()
            model.flash("Photo is on the PC clipboard")
            await load()
        } catch {
            model.flash(error.localizedDescription)
        }
    }
}
