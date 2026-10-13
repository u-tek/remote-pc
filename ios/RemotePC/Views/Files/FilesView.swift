import PhotosUI
import QuickLook
import SwiftUI
import UniformTypeIdentifiers

struct FolderRoute: Hashable {
    var path: String
}

struct FilesView: View {
    @Environment(AppModel.self) private var model
    @State private var roots: Roots?
    @State private var error: String?
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if let error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
                if let roots {
                    Section("Places") {
                        ForEach(roots.places, id: \.path) { place in
                            NavigationLink(value: FolderRoute(path: place.path)) {
                                Label(place.name, systemImage: place.icon)
                            }
                        }
                    }
                    Section("Drives") {
                        ForEach(roots.drives, id: \.path) { drive in
                            NavigationLink(value: FolderRoute(path: drive.path)) {
                                Label(drive.name, systemImage: "internaldrive")
                            }
                        }
                    }
                }
            }
            .overlay {
                if model.client == nil { NotConnectedView() } else if roots == nil && error == nil { ProgressView() }
            }
            .navigationTitle("Files")
            .navigationDestination(for: FolderRoute.self) { route in
                FolderView(path: route.path)
            }
            .refreshable { await load() }
            .task(id: model.selectedID) { await load() }
        }
    }

    private func load() async {
        guard let client = model.client else { return }
        do {
            roots = try await client.get("/api/fs/roots", as: Roots.self)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct FolderView: View {
    let path: String
    @Environment(AppModel.self) private var model
    @AppStorage("showHiddenFiles") private var showHidden = false
    @State private var listing: FileListing?
    @State private var error: String?
    @State private var search = ""
    @State private var busy: String?
    @State private var previewURL: URL?
    @State private var shareItem: ShareItem?
    @State private var renaming: FileEntry?
    @State private var newName = ""
    @State private var creatingFolder = false
    @State private var folderName = ""
    @State private var deleting: FileEntry?
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var importing = false

    private var entries: [FileEntry] {
        (listing?.entries ?? []).filter { (showHidden || !$0.hidden) && (search.isEmpty || $0.name.localizedCaseInsensitiveContains(search)) }
    }

    var body: some View {
        List {
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            ForEach(entries) { entry in
                if entry.dir {
                    NavigationLink(value: FolderRoute(path: entry.path)) { FileRow(entry: entry) }
                        .contextMenu { menu(for: entry) }
                        .swipeActions { swipe(for: entry) }
                } else {
                    Button { Task { await preview(entry) } } label: { FileRow(entry: entry) }
                        .foregroundStyle(.primary)
                        .contextMenu { menu(for: entry) }
                        .swipeActions { swipe(for: entry) }
                }
            }
        }
        .listStyle(.plain)
        .overlay {
            if listing == nil && error == nil {
                ProgressView()
            } else if listing != nil && entries.isEmpty && search.isEmpty {
                ContentUnavailableView("Empty folder", systemImage: "folder")
            }
        }
        .overlay(alignment: .bottom) {
            if let busy {
                HStack(spacing: 10) {
                    ProgressView()
                    Text(busy).font(.footnote)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.regularMaterial, in: Capsule())
                .padding(.bottom, 12)
            }
        }
        .searchable(text: $search, prompt: "Filter")
        .navigationTitle(displayName(path))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { creatingFolder = true } label: { Label("New folder", systemImage: "folder.badge.plus") }
                    Button { importing = true } label: { Label("Upload files", systemImage: "doc.badge.plus") }
                    PhotosPicker(selection: $photoItems, maxSelectionCount: 20, matching: .any(of: [.images, .videos])) {
                        Label("Upload photos & videos", systemImage: "photo.badge.plus")
                    }
                    Divider()
                    Button {
                        Task { await openOnPC(path) }
                    } label: {
                        Label("Open in Explorer on PC", systemImage: "arrow.up.forward.app")
                    }
                    Toggle(isOn: $showHidden) { Label("Show hidden files", systemImage: "eye") }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .quickLookPreview($previewURL)
        .sheet(item: $shareItem) { item in ShareSheet(items: [item.url]) }
        .alert("Rename", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $newName)
            Button("Rename") { if let r = renaming { Task { await rename(r, to: newName) } } }
            Button("Cancel", role: .cancel) {}
        }
        .alert("New folder", isPresented: $creatingFolder) {
            TextField("Name", text: $folderName)
            Button("Create") { Task { await makeFolder(folderName) } }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog(
            "Delete \(deleting?.name ?? "")?",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible
        ) {
            Button("Move to Recycle Bin", role: .destructive) { if let d = deleting { Task { await delete(d) } } }
        } message: {
            Text("You can restore it from the Recycle Bin on the PC.")
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { Task { await uploadFiles(urls) } }
        }
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            Task { await uploadPhotos(items) }
        }
    }

    @ViewBuilder
    private func menu(for entry: FileEntry) -> some View {
        if !entry.dir {
            Button { Task { await preview(entry) } } label: { Label("Preview", systemImage: "eye") }
            Button { Task { await share(entry) } } label: { Label("Save or share…", systemImage: "square.and.arrow.up") }
        }
        Button { Task { await openOnPC(entry.path) } } label: { Label("Open on PC", systemImage: "arrow.up.forward.app") }
        Button {
            UIPasteboard.general.string = entry.path
            model.flash("Path copied")
        } label: {
            Label("Copy path", systemImage: "doc.on.doc")
        }
        Button {
            newName = entry.name
            renaming = entry
        } label: {
            Label("Rename", systemImage: "pencil")
        }
        Button(role: .destructive) { deleting = entry } label: { Label("Delete", systemImage: "trash") }
    }

    @ViewBuilder
    private func swipe(for entry: FileEntry) -> some View {
        Button(role: .destructive) { deleting = entry } label: { Label("Delete", systemImage: "trash") }
        if !entry.dir {
            Button { Task { await share(entry) } } label: { Label("Share", systemImage: "square.and.arrow.up") }
                .tint(.blue)
        }
    }

    private func displayName(_ p: String) -> String {
        p.split(whereSeparator: { $0 == "\\" || $0 == "/" }).last.map(String.init) ?? p
    }

    private func join(_ name: String) -> String {
        let sep: Character = path.contains("\\") || path.contains(":") ? "\\" : "/"
        return path.hasSuffix(String(sep)) ? path + name : path + String(sep) + name
    }

    private func load() async {
        guard let client = model.client else { return }
        do {
            listing = try await client.get("/api/fs/list", query: ["path": path], as: FileListing.self)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func download(_ entry: FileEntry) async -> URL? {
        guard let client = model.client else { return nil }
        busy = "Downloading \(entry.name)…"
        defer { busy = nil }
        do {
            return try await client.download(pcPath: entry.path)
        } catch {
            model.flash(error.localizedDescription)
            return nil
        }
    }

    private func preview(_ entry: FileEntry) async {
        if let url = await download(entry) { previewURL = url }
    }

    private func share(_ entry: FileEntry) async {
        if let url = await download(entry) { shareItem = ShareItem(url: url) }
    }

    private func openOnPC(_ target: String) async {
        guard let client = model.client else { return }
        do {
            try await client.send("POST", "/api/fs/open", json: ["path": target])
            model.flash("Opened on the PC")
        } catch {
            model.flash(error.localizedDescription)
        }
    }

    private func rename(_ entry: FileEntry, to name: String) async {
        guard let client = model.client else { return }
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean != entry.name else { return }
        do {
            try await client.send("POST", "/api/fs/rename", json: ["from": entry.path, "to": join(clean)])
            await load()
        } catch {
            model.flash(error.localizedDescription)
        }
    }

    private func makeFolder(_ name: String) async {
        guard let client = model.client else { return }
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        folderName = ""
        guard !clean.isEmpty else { return }
        do {
            try await client.send("POST", "/api/fs/mkdir", json: ["path": join(clean)])
            await load()
        } catch {
            model.flash(error.localizedDescription)
        }
    }

    private func delete(_ entry: FileEntry) async {
        guard let client = model.client else { return }
        do {
            try await client.send("POST", "/api/fs/delete", json: ["path": entry.path], timeout: 120)
            Haptics.success()
            await load()
        } catch {
            model.flash(error.localizedDescription)
        }
    }

    private func uniqueName(_ name: String) -> String {
        let existing = Set((listing?.entries ?? []).map { $0.name.lowercased() })
        guard existing.contains(name.lowercased()) else { return name }
        let ext = (name as NSString).pathExtension
        let base = (name as NSString).deletingPathExtension
        var i = 2
        while true {
            let candidate = ext.isEmpty ? "\(base) (\(i))" : "\(base) (\(i)).\(ext)"
            if !existing.contains(candidate.lowercased()) { return candidate }
            i += 1
        }
    }

    private func uploadFiles(_ urls: [URL]) async {
        guard let client = model.client else { return }
        for (i, url) in urls.enumerated() {
            busy = "Uploading \(i + 1) of \(urls.count)…"
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            do {
                try await client.upload(fileURL: url, toPCPath: join(uniqueName(url.lastPathComponent)))
            } catch {
                model.flash("\(url.lastPathComponent): \(error.localizedDescription)")
            }
            await load()
        }
        busy = nil
        Haptics.success()
    }

    private func uploadPhotos(_ items: [PhotosPickerItem]) async {
        guard let client = model.client else { return }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let stamp = formatter.string(from: Date())
        for (i, item) in items.enumerated() {
            busy = "Uploading \(i + 1) of \(items.count)…"
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
            let name = uniqueName("Photo \(stamp)-\(i + 1).\(ext)")
            do {
                try await client.upload(data: data, toPCPath: join(name))
            } catch {
                model.flash(error.localizedDescription)
            }
            await load()
        }
        photoItems = []
        busy = nil
        Haptics.success()
    }
}

struct FileRow: View {
    let entry: FileEntry

    private var icon: String {
        if entry.dir { return "folder.fill" }
        let ext = (entry.name as NSString).pathExtension.lowercased()
        switch ext {
        case "png", "jpg", "jpeg", "gif", "heic", "webp", "bmp": return "photo"
        case "mp4", "mov", "mkv", "avi", "m4v": return "film"
        case "mp3", "wav", "m4a", "flac": return "music.note"
        case "pdf": return "doc.richtext"
        case "zip", "7z", "rar", "tar", "gz": return "doc.zipper"
        case "exe", "msi", "bat", "cmd", "ps1": return "gearshape"
        case "js", "ts", "tsx", "py", "swift", "cs", "json", "html", "css", "md", "go", "rs", "java": return "chevron.left.forwardslash.chevron.right"
        default: return "doc"
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(entry.dir ? Color.accentColor : Color.secondary)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.name)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .opacity(entry.hidden ? 0.6 : 1)
                HStack(spacing: 6) {
                    if !entry.dir { Text(Format.bytes(entry.size)) }
                    if entry.mtime > 0 { Text(entry.modified, format: .dateTime.day().month().year().hour().minute()) }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
    }
}
