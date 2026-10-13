import PhotosUI
import SwiftUI
import UIKit

struct ChatView: View {
    let sessionKey: String
    @Environment(AppModel.self) private var model
    @State private var draft = ""
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var images: [Data] = []
    @State private var loading = false
    @State private var loadError: String?
    @State private var sending = false
    @State private var answering: QuestionPrompt?
    @State private var showInbox = false
    @FocusState private var focused: Bool

    private var session: SessionSummary? { model.session(sessionKey) }
    private var items: [ChatItem] { model.transcripts[sessionKey] ?? [] }
    private var approvals: [Approval] { model.approvals.filter { $0.sessionKey == sessionKey } }
    private var questions: [QuestionPrompt] { model.questions.filter { $0.sessionKey == sessionKey } }
    private var canSend: Bool {
        !sending && session != nil && (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !images.isEmpty)
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if loading && items.isEmpty {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                    }
                    if let loadError {
                        Label(loadError, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    ForEach(items) { item in
                        ChatItemView(item: item).id(item.id)
                    }
                    if session?.status == "running" {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("Working…").font(.footnote).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.bottom)
            .onChange(of: items.last) { _, _ in
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .onChange(of: approvals.count + questions.count) { _, _ in
                withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
            }
        }
        .safeAreaInset(edge: .bottom) { bottomBar }
        .navigationTitle(session?.title ?? "Session")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbarContent }
        .task(id: sessionKey) { await load() }
        .onAppear { model.openSessionKey = sessionKey }
        .onDisappear { if model.openSessionKey == sessionKey { model.openSessionKey = nil } }
        .sheet(item: $answering) { question in
            NavigationStack {
                ScrollView {
                    QuestionCard(question: question) { answering = nil }
                        .padding()
                }
                .navigationTitle(question.sessionTitle)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Later") { answering = nil } }
                }
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showInbox) {
            NavigationStack { InboxView() }
        }
        .onChange(of: photoItems) { _, newItems in
            guard !newItems.isEmpty else { return }
            Task { await loadPhotos(newItems) }
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            if let session {
                Menu {
                    Section {
                        Label(session.agent.displayName, systemImage: session.agent.symbol)
                        Label(session.cwd, systemImage: "folder")
                        if let m = session.model { Label(m, systemImage: "cpu") }
                    }
                    if session.agent == .claude {
                        Section("Permission mode") {
                            ForEach(PermissionModeOption.all) { option in
                                Button {
                                    Task { await model.setMode(option.id, for: session) }
                                } label: {
                                    if (session.mode ?? "default") == option.id {
                                        Label(option.title, systemImage: "checkmark")
                                    } else {
                                        Text(option.title)
                                    }
                                }
                            }
                        }
                    }
                    Button {
                        UIPasteboard.general.string = session.cwd
                        model.flash("Folder path copied")
                    } label: {
                        Label("Copy folder path", systemImage: "doc.on.doc")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
    }

    private var bottomBar: some View {
        VStack(spacing: 10) {
            if let question = questions.first {
                Button {
                    answering = question
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "questionmark.bubble.fill").font(.title3)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(question.agent.displayName) has a question").font(.subheadline.bold())
                            Text(question.questions.first?.question ?? "").font(.caption).lineLimit(2)
                        }
                        Spacer(minLength: 0)
                        Text("Answer").font(.subheadline.bold())
                    }
                    .padding(12)
                    .foregroundStyle(.white)
                    .background(Color.blue, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
            } else if let approval = approvals.first {
                ApprovalCard(approval: approval, showSession: false)
            }
            if approvals.count + questions.count > 1 {
                Button("\(approvals.count + questions.count - 1) more waiting") { showInbox = true }
                    .font(.footnote)
            }
            if !images.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(images.indices, id: \.self) { i in
                            ZStack(alignment: .topTrailing) {
                                if let ui = UIImage(data: images[i]) {
                                    Image(uiImage: ui)
                                        .resizable()
                                        .scaledToFill()
                                        .frame(width: 64, height: 64)
                                        .clipShape(RoundedRectangle(cornerRadius: 10))
                                }
                                Button {
                                    images.remove(at: i)
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .symbolRenderingMode(.palette)
                                        .foregroundStyle(.white, .black.opacity(0.6))
                                }
                                .offset(x: 6, y: -6)
                            }
                        }
                    }
                    .padding(.top, 6)
                }
            }
            HStack(alignment: .bottom, spacing: 10) {
                PhotosPicker(selection: $photoItems, maxSelectionCount: 4, matching: .images) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.title3)
                        .frame(height: 36)
                }
                TextField("Message \(session?.agent.displayName ?? "agent")…", text: $draft, axis: .vertical)
                    .lineLimit(1...6)
                    .focused($focused)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                if session?.isBusy == true && draft.isEmpty && images.isEmpty {
                    Button {
                        if let session { Task { await model.interrupt(session) } }
                    } label: {
                        Image(systemName: "stop.circle.fill").font(.system(size: 32))
                    }
                    .tint(.red)
                } else {
                    Button(action: send) {
                        Image(systemName: "arrow.up.circle.fill").font(.system(size: 32))
                    }
                    .disabled(!canSend)
                }
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.bar)
    }

    private func load() async {
        loading = true
        defer { loading = false }
        if session == nil { await model.refreshSessions() }
        guard let session else {
            loadError = "This session is no longer available."
            return
        }
        do {
            try await model.loadTranscript(session)
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func send() {
        guard let session else { return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let attached = images
        draft = ""
        images = []
        sending = true
        Task {
            do {
                try await model.send(text, images: attached, to: session)
            } catch {
                model.flash(error.localizedDescription)
                draft = text
                images = attached
            }
            sending = false
        }
    }

    private func loadPhotos(_ picked: [PhotosPickerItem]) async {
        for item in picked {
            guard let data = try? await item.loadTransferable(type: Data.self),
                  let image = UIImage(data: data),
                  let jpeg = image.downscaled(maxDimension: 1600).jpegData(compressionQuality: 0.8) else { continue }
            images.append(jpeg)
        }
        photoItems = []
    }
}

struct PermissionModeOption: Identifiable {
    var id: String
    var title: String

    static let all = [
        PermissionModeOption(id: "default", title: "Ask before changes"),
        PermissionModeOption(id: "acceptEdits", title: "Auto-accept edits"),
        PermissionModeOption(id: "plan", title: "Plan first"),
    ]
}

extension UIImage {
    func downscaled(maxDimension: CGFloat) -> UIImage {
        let largest = max(size.width, size.height)
        guard largest > maxDimension else { return self }
        let scale = maxDimension / largest
        let newSize = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: newSize, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: newSize))
        }
    }
}

// MARK: Transcript rows

struct ChatItemView: View {
    let item: ChatItem
    @State private var expanded = false

    var body: some View {
        switch item.kind {
        case "user":
            HStack {
                Spacer(minLength: 48)
                Text(item.text ?? "")
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .foregroundStyle(.white)
                    .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .textSelection(.enabled)
            }
        case "text":
            MarkdownText(item.text ?? "")
        case "thinking":
            DisclosureGroup(isExpanded: $expanded) {
                Text(item.text ?? "")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } label: {
                Label("Thinking", systemImage: "brain")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        case "tool":
            ToolRow(item: item)
        case "error":
            Label(item.text ?? "Error", systemImage: "exclamationmark.octagon.fill")
                .font(.footnote)
                .foregroundStyle(.red)
                .textSelection(.enabled)
        case "result":
            Text(item.text ?? "")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
        default:
            Text(item.text ?? "")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}

struct ToolRow: View {
    let item: ChatItem
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.snappy) { expanded.toggle() }
            } label: {
                HStack(spacing: 8) {
                    statusIcon.frame(width: 18)
                    Text(item.tool?.title ?? "Tool")
                        .font(.footnote.monospaced())
                        .lineLimit(expanded ? 4 : 1)
                        .foregroundStyle(.primary)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if expanded, let tool = item.tool {
                CodeBlock(title: "Input", text: tool.input)
                if let output = tool.output, !output.isEmpty {
                    CodeBlock(title: tool.status == "error" ? "Error" : "Output", text: output)
                }
            }
        }
        .padding(10)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch item.tool?.status ?? "done" {
        case "running", "pending":
            ProgressView().controlSize(.small)
        case "error":
            Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
        default:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        }
    }
}

struct CodeBlock: View {
    let title: String
    let text: String
    @State private var full = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(title).font(.caption2.bold()).foregroundStyle(.secondary)
                Spacer()
                Button {
                    UIPasteboard.general.string = text
                } label: {
                    Image(systemName: "doc.on.doc").font(.caption2)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
            Text(text)
                .font(.caption.monospaced())
                .lineLimit(full ? nil : 24)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(Color(.tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
            if !full && text.split(separator: "\n", omittingEmptySubsequences: false).count > 24 {
                Button("Show all") { full = true }.font(.caption)
            }
        }
    }
}

/// Renders agent replies: inline Markdown, simple headings and bullets, and fenced code blocks.
struct MarkdownText: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    private struct Segment: Identifiable {
        var id: Int
        var code: Bool
        var text: String
    }

    private var segments: [Segment] {
        var result: [Segment] = []
        let parts = text.components(separatedBy: "```")
        for (index, part) in parts.enumerated() {
            if index % 2 == 1 {
                // Drop the language tag on the opening fence line.
                var lines = part.components(separatedBy: "\n")
                if let first = lines.first, !first.contains(" ") { lines.removeFirst() }
                let code = lines.joined(separator: "\n").trimmingCharacters(in: .newlines)
                result.append(Segment(id: index, code: true, text: code))
            } else {
                let prose = part.trimmingCharacters(in: .newlines)
                if !prose.isEmpty { result.append(Segment(id: index, code: false, text: prose)) }
            }
        }
        return result
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(segments) { segment in
                if segment.code {
                    ScrollView(.horizontal, showsIndicators: false) {
                        Text(segment.text)
                            .font(.caption.monospaced())
                            .textSelection(.enabled)
                            .padding(10)
                    }
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
                } else {
                    Text(Self.render(segment.text))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    static func render(_ prose: String) -> AttributedString {
        let lines = prose.components(separatedBy: "\n").map { line -> String in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("#") {
                let title = trimmed.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces)
                return title.isEmpty ? line : "**\(title)**"
            }
            if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") {
                let indent = String(line.prefix(while: { $0 == " " }))
                return indent + "• " + String(trimmed.dropFirst(2))
            }
            return line
        }
        let joined = lines.joined(separator: "\n")
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: joined, options: options)) ?? AttributedString(joined)
    }
}
