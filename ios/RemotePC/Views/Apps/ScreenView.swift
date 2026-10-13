import SwiftUI
import UIKit

/// One screen of a PC app, drawn the way iOS would draw that kind of screen.
struct ScreenView: View {
    let screen: UIScreen
    /// Shown on the first screen of an app: goes back to the home screen.
    var close: (() -> Void)?
    /// Sheets put Cancel/Done in the navigation bar.
    var isSheet = false
    @Environment(AppSession.self) private var session

    var body: some View {
        content
            .navigationTitle(screen.title)
            .navigationBarTitleDisplayMode(screen.largeTitle == true ? .large : .inline)
            .toolbar { toolbar }
            .modifier(SearchModifier(field: screen.search))
            .safeAreaInset(edge: .top, spacing: 0) { topAccessory }
            .safeAreaInset(edge: .bottom, spacing: 0) { bottomAccessory }
            .environment(\.openURL, OpenURLAction { url in
                if let ref = ActionLink.ref(from: url) {
                    session.perform(ref)
                    return .handled
                }
                return .systemAction
            })
    }

    // MARK: Content by style

    @ViewBuilder
    private var content: some View {
        if let empty = screen.empty, screen.sections.isEmpty, screen.document == nil {
            ContentUnavailableView(empty.title, systemImage: empty.symbol ?? "tray", description: empty.message.map { Text($0) })
        } else if let only = onlyLive {
            ZStack {
                Color.black.ignoresSafeArea()
                LiveItemView(item: only)
            }
        } else {
            switch screen.style {
            case "chat": ChatContent(screen: screen)
            case "article", "browser": ArticleContent(screen: screen)
            case "document": DocumentContent(screen: screen)
            case "grid": GridContent(screen: screen)
            default: ListContent(screen: screen)
            }
        }
    }

    private var onlyLive: UIItem? {
        let all = screen.sections.flatMap(\.items)
        return all.count == 1 && all[0].kind == "live" ? all[0] : nil
    }

    // MARK: Bars

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if let close {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    close()
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.body.weight(.semibold))
                }
                .accessibilityLabel("Home")
            }
        }
        if let subtitle = screen.subtitle, screen.largeTitle != true {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 0) {
                    Text(screen.title).font(.headline).lineLimit(1)
                    Text(subtitle).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
        if isSheet, let cancel = (screen.actions ?? []).first(where: { $0.role == "cancel" }) {
            ToolbarItem(placement: .cancellationAction) {
                Button(cancel.title ?? "Cancel") { session.perform(cancel) }
            }
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            ForEach((screen.actions ?? []).filter { !(isSheet && ($0.role == "cancel" || $0.role == "primary")) }.prefix(2), id: \.ref) { a in
                Button {
                    session.perform(a)
                } label: {
                    if let symbol = a.symbol { Image(systemName: symbol) } else { Text(a.title ?? "") }
                }
                .disabled(a.disabled == true)
                .accessibilityLabel(a.title ?? "")
            }
            if let menu = screen.menu, !menu.isEmpty {
                Menu {
                    MenuContent(items: menu)
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        if isSheet, let primary = (screen.actions ?? []).first(where: { $0.role == "primary" }) {
            ToolbarItem(placement: .confirmationAction) {
                Button(primary.title ?? "Done") { session.perform(primary) }
                    .fontWeight(.semibold)
                    .disabled(primary.disabled == true)
            }
        }
        if let bar = screen.bottomBar, !bar.isEmpty {
            ToolbarItemGroup(placement: .bottomBar) {
                ForEach(Array(bar.enumerated()), id: \.element.ref) { index, a in
                    if index > 0 { Spacer() }
                    Button {
                        session.perform(a)
                    } label: {
                        if let symbol = a.symbol {
                            if a.ref == "browser-tabs" {
                                // Safari-style tab count.
                                Image(systemName: symbol).overlay(Text(a.title ?? "").font(.system(size: 9, weight: .bold)))
                            } else {
                                Image(systemName: symbol)
                            }
                        } else {
                            Text(a.title ?? "")
                        }
                    }
                    .tint(a.role == "primary" ? .accentColor : nil)
                    .fontWeight(a.role == "primary" ? .bold : .regular)
                    .disabled(a.disabled == true)
                    .accessibilityLabel(a.title ?? "")
                }
            }
        }
    }

    @ViewBuilder
    private var topAccessory: some View {
        VStack(spacing: 8) {
            if let address = screen.address { AddressBar(address: address) }
            if let segments = screen.segments, segments.items.count > 1 { SegmentsBar(segments: segments) }
        }
        .padding(.bottom, screen.address != nil || (screen.segments?.items.count ?? 0) > 1 ? 8 : 0)
        .background(screen.address != nil || (screen.segments?.items.count ?? 0) > 1 ? AnyShapeStyle(Material.bar) : AnyShapeStyle(Color.clear))
    }

    @ViewBuilder
    private var bottomAccessory: some View {
        if let composer = screen.composer { ComposerBar(composer: composer) }
    }
}

// MARK: - Search

struct SearchModifier: ViewModifier {
    let field: UISearchField?
    @Environment(AppSession.self) private var session
    @State private var text = ""
    @State private var debounce: Task<Void, Never>?

    @ViewBuilder
    func body(content: Content) -> some View {
        if let field {
            content
                .searchable(text: $text, prompt: field.placeholder)
                .onAppear { text = field.value }
                .onChange(of: text) { _, new in
                    debounce?.cancel()
                    debounce = Task {
                        try? await Task.sleep(for: .milliseconds(450))
                        if !Task.isCancelled, new != field.value { session.perform(field.ref, value: new) }
                    }
                }
                .onSubmit(of: .search) {
                    debounce?.cancel()
                    session.perform(field.ref, value: text)
                    if let submit = field.submit { session.perform(submit) }
                }
        } else {
            content
        }
    }
}

// MARK: - Accessories

struct SegmentsBar: View {
    let segments: UISegments
    @Environment(AppSession.self) private var session
    @State private var selection = ""

    var body: some View {
        Picker("", selection: Binding(get: { selection.isEmpty ? (segments.selected ?? "") : selection }, set: { id in
            selection = id
            if let choice = segments.items.first(where: { $0.id == id }) {
                if let own = choice.ref { session.perform(own) } else if let ref = segments.ref { session.perform(ref, value: id) }
            }
        })) {
            ForEach(segments.items) { c in Text(c.title).tag(c.id) }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .padding(.horizontal)
        .onChange(of: segments.selected) { _, _ in selection = "" }
    }
}

struct AddressBar: View {
    let address: UIAddress
    @Environment(AppSession.self) private var session
    @State private var text = ""
    @FocusState private var editing: Bool

    private var host: String {
        let shown = address.value.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: "")
        return shown.split(separator: "/").first.map(String.init) ?? shown
    }

    var body: some View {
        HStack(spacing: 6) {
            if !editing {
                Image(systemName: address.secure == false ? "exclamationmark.triangle.fill" : "lock.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            TextField("Search or enter website", text: $text)
                .focused($editing)
                .keyboardType(.webSearch)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .multilineTextAlignment(editing ? .leading : .center)
                .onSubmit { session.perform(address.ref, value: text) }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.horizontal)
        .onAppear { text = host }
        .onChange(of: editing) { _, now in text = now ? address.value : host }
        .onChange(of: address.value) { _, _ in if !editing { text = host } }
    }
}

struct ComposerBar: View {
    let composer: UIComposer
    @Environment(AppSession.self) private var session
    @State private var text = ""

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if let attach = composer.attach {
                Button {
                    session.perform(attach)
                } label: {
                    Image(systemName: attach.symbol ?? "plus").font(.title3).frame(width: 34, height: 34)
                }
            }
            TextField(composer.placeholder, text: $text, axis: .vertical)
                .lineLimit(1...6)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            Button {
                let message = text
                text = ""
                session.perform(composer.ref, value: message)
            } label: {
                Image(systemName: "arrow.up.circle.fill").font(.system(size: 30))
            }
            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.bar)
    }
}

// MARK: - Styles

/// Settings-style grouped lists and plain lists (files, mail).
struct ListContent: View {
    let screen: UIScreen
    @Environment(AppSession.self) private var session

    var body: some View {
        List {
            ForEach(screen.sections) { section in
                if section.style == "grid" {
                    Section {
                        TileGrid(items: section.items)
                            .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                            .listRowBackground(Color.clear)
                    } header: {
                        if let h = section.header { Text(h) }
                    }
                } else {
                    Section {
                        ForEach(section.items) { item in
                            ItemView(item: item)
                                .listRowSeparator(item.kind == "keypad" || item.kind == "live" ? .hidden : .automatic)
                                .onAppear {
                                    if let more = screen.more, item.id == screen.sections.last?.items.last?.id { session.perform(more) }
                                }
                        }
                    } header: {
                        if let h = section.header { Text(h) }
                    } footer: {
                        if let f = section.footer { Text(f) }
                    }
                }
            }
        }
        .listStyleKind(screen.style == "list" ? .plain : .insetGrouped)
        .refreshable { await pullToRefresh(session: session, screen: screen) }
    }
}

/// SwiftUI list styles are distinct types; this picks one at runtime.
enum ListStyleKind {
    case plain, insetGrouped
}

extension View {
    @ViewBuilder
    func listStyleKind(_ kind: ListStyleKind) -> some View {
        switch kind {
        case .plain: self.listStyle(PlainListStyle())
        case .insetGrouped: self.listStyle(InsetGroupedListStyle())
        }
    }
}

@MainActor
func pullToRefresh(session: AppSession, screen: UIScreen) async {
    if let r = screen.refresh { session.perform(r) } else { session.refresh() }
    try? await Task.sleep(for: .milliseconds(700))
}

struct TileGrid: View {
    let items: [UIItem]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 96, maximum: 140), spacing: 12)], spacing: 16) {
            ForEach(items) { ItemView(item: $0) }
        }
    }
}

struct GridContent: View {
    let screen: UIScreen
    @Environment(AppSession.self) private var session

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                ForEach(screen.sections) { section in
                    if let h = section.header { Text(h).font(.title3.bold()).padding(.horizontal) }
                    TileGrid(items: section.items).padding(.horizontal)
                }
            }
            .padding(.vertical)
        }
        .refreshable { await pullToRefresh(session: session, screen: screen) }
    }
}

/// Web pages, mail and help: readable flowing text.
struct ArticleContent: View {
    let screen: UIScreen
    @Environment(AppSession.self) private var session

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                ForEach(screen.sections) { section in
                    if let h = section.header { Text(h).font(.title3.bold()).padding(.top, 8) }
                    ForEach(section.items) { item in
                        ItemView(item: item)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if let f = section.footer { Text(f).font(.footnote).foregroundStyle(.secondary) }
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .frame(maxWidth: 700)
            .frame(maxWidth: .infinity)
        }
        .refreshable { await pullToRefresh(session: session, screen: screen) }
    }
}

/// Chat: bubbles from the bottom up; the composer sits in the bottom inset.
struct ChatContent: View {
    let screen: UIScreen

    var body: some View {
        let items = screen.sections.flatMap(\.items)
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 4) {
                    ForEach(items) { ItemView(item: $0) }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: items.last?.id) { _, id in
                if let id { withAnimation { proxy.scrollTo(id, anchor: .bottom) } }
            }
        }
    }
}

/// Text documents: edit in place (plain text) or type at the PC's cursor (rich documents).
struct DocumentContent: View {
    let screen: UIScreen
    @Environment(AppSession.self) private var session
    @State private var text = ""
    @State private var lastSent = ""
    @State private var typing = ""
    @State private var debounce: Task<Void, Never>?
    @FocusState private var focused: Bool

    private var body_: UIDocumentBody? { screen.document }

    var body: some View {
        VStack(spacing: 0) {
            if let ref = body_?.ref {
                TextEditor(text: $text)
                    .font(.body.monospaced())
                    .focused($focused)
                    .padding(.horizontal, 8)
                    .onChange(of: text) { _, new in
                        guard new != lastSent else { return }
                        debounce?.cancel()
                        debounce = Task {
                            try? await Task.sleep(for: .milliseconds(700))
                            if Task.isCancelled { return }
                            lastSent = new
                            session.perform(ref, value: new)
                        }
                    }
            } else {
                ScrollView {
                    Text(body_?.text ?? "")
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                }
                if let typeRef = body_?.typeRef { typeBar(typeRef) }
            }
        }
        .onAppear {
            text = body_?.text ?? ""
            lastSent = text
        }
        .onChange(of: body_?.text) { _, new in
            if !focused, let new {
                text = new
                lastSent = new
            }
        }
    }

    /// Typing for rich documents goes to wherever the cursor is on the PC.
    private func typeBar(_ typeRef: String) -> some View {
        let keysRef: String? = typeRef.hasPrefix("type:") ? "keys:" + String(typeRef.dropFirst(5)) : nil
        return HStack(spacing: 8) {
            TextField("Type at the cursor", text: $typing)
                .textFieldStyle(.roundedBorder)
                .onSubmit {
                    session.perform(typeRef, value: typing + "\n")
                    typing = ""
                }
            Button {
                session.perform(typeRef, value: typing)
                typing = ""
            } label: {
                Image(systemName: "arrow.up.circle.fill").font(.title2)
            }
            .disabled(typing.isEmpty)
            if let keysRef {
                Button {
                    session.perform(keysRef, value: "8")
                } label: {
                    Image(systemName: "delete.left").font(.title3)
                }
            }
        }
        .padding(10)
        .background(.bar)
    }
}
