import SwiftUI
import UIKit

/// Draws one protocol item with the matching native control.
struct ItemView: View {
    let item: UIItem

    var body: some View {
        switch item.kind {
        case "nav": NavRow(item: item)
        case "toggle": ToggleRow(item: item)
        case "choice": ChoiceRow(item: item)
        case "slider": SliderRow(item: item)
        case "stepper": StepperRow(item: item)
        case "field": FieldRow(item: item)
        case "button": ButtonItemView(item: item)
        case "check": CheckRow(item: item)
        case "text": TextRow(item: item)
        case "heading": HeadingRow(item: item)
        case "paragraph": ParagraphRow(item: item)
        case "image": ImageRow(item: item)
        case "progress": ProgressRow(item: item)
        case "item": ListRow(item: item)
        case "tile": TileView(item: item)
        case "message": MessageBubble(item: item)
        case "record": RecordCard(item: item)
        case "keypad": KeypadView(item: item)
        case "buttons": ButtonsRow(item: item)
        case "profile": ProfileRow(item: item)
        case "live": LiveItemView(item: item)
        case "divider": Divider()
        default: EmptyView()
        }
    }
}

/// The ⋯ menus, context menus and submenus, built from protocol menu items.
struct MenuContent: View {
    let items: [UIMenuItem]
    @Environment(AppSession.self) private var session

    var body: some View {
        ForEach(items) { m in
            if let children = m.children, !children.isEmpty {
                if m.title.isEmpty {
                    Section { MenuContent(items: children) }
                } else {
                    Menu {
                        MenuContent(items: children)
                    } label: {
                        MenuLabel(title: m.title, symbol: m.symbol, checked: m.checked == true)
                    }
                }
            } else if let load = m.load {
                Button {
                    session.perform(load)
                } label: {
                    MenuLabel(title: m.title, symbol: m.symbol ?? "ellipsis", checked: false)
                }
                .disabled(m.disabled == true)
            } else if let action = m.action {
                Button(role: m.role == "destructive" ? .destructive : nil) {
                    session.perform(action)
                } label: {
                    MenuLabel(title: m.title, symbol: m.symbol, checked: m.checked == true)
                }
                .disabled(m.disabled == true || action.disabled == true)
            } else {
                Text(m.title)
            }
        }
    }
}

struct MenuLabel: View {
    let title: String
    let symbol: String?
    let checked: Bool

    var body: some View {
        if checked {
            Label(title, systemImage: "checkmark")
        } else if let symbol, !symbol.isEmpty {
            Label(title, systemImage: symbol)
        } else {
            Text(title)
        }
    }
}

// MARK: - Rows

struct RowLabel: View {
    let title: String
    var subtitle: String?
    var icon: UIIcon?

    var body: some View {
        HStack(spacing: 12) {
            if let icon { UIIconView(icon: icon) }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.footnote).foregroundStyle(.secondary).lineLimit(3)
                }
            }
        }
    }
}

struct NavRow: View {
    let item: UIItem
    @Environment(AppSession.self) private var session

    var body: some View {
        Button {
            if let tap = item.tap { session.perform(tap) }
        } label: {
            HStack(spacing: 12) {
                RowLabel(title: item.title ?? "", subtitle: item.subtitle, icon: item.icon)
                Spacer(minLength: 8)
                if let value = item.stringValue, !value.isEmpty {
                    Text(value).foregroundStyle(.secondary).lineLimit(1)
                }
                if let badge = item.badge {
                    Text(badge)
                        .font(.caption.bold())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(Color.red, in: Capsule())
                }
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.leading, CGFloat(item.level ?? 0) * 16)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(item.tap == nil)
    }
}

struct ToggleRow: View {
    let item: UIItem
    @Environment(AppSession.self) private var session

    var body: some View {
        let ref = item.ref ?? ""
        Toggle(isOn: Binding(
            get: { (session.pending[ref] as? Bool) ?? (item.on ?? false) },
            set: { session.set(ref, $0) }
        )) {
            RowLabel(title: item.title ?? "", subtitle: item.subtitle, icon: item.icon)
        }
        .disabled(item.disabled == true)
    }
}

struct CheckRow: View {
    let item: UIItem
    @Environment(AppSession.self) private var session

    var body: some View {
        let ref = item.ref ?? ""
        let on = (session.pending[ref] as? Bool) ?? (item.on ?? false)
        Button {
            session.set(ref, item.radio == true ? true : !on)
        } label: {
            HStack {
                RowLabel(title: item.title ?? "", subtitle: item.subtitle)
                Spacer()
                if on { Image(systemName: "checkmark").font(.body.weight(.semibold)).foregroundStyle(.tint) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(item.disabled == true)
    }
}

struct ChoiceRow: View {
    let item: UIItem
    @Environment(AppSession.self) private var session
    @State private var picking = false

    private var current: String {
        if let p = session.pending[item.ref ?? ""] as? String { return p }
        if let options = item.options {
            if let sel = item.selected?.optionID, options.contains(where: { $0.id == sel }) { return sel }
            if let v = item.stringValue, let match = options.first(where: { $0.title == v }) { return match.id }
        }
        return ""
    }

    private func choose(_ option: UIChoice) {
        if let own = option.ref {
            session.pending[item.ref ?? ""] = option.id
            session.perform(own)
        } else {
            session.set(item.ref ?? "", option.id)
        }
    }

    var body: some View {
        if let options = item.options, !options.isEmpty {
            switch item.style {
            case "segmented":
                VStack(alignment: .leading, spacing: 8) {
                    if let title = item.title, !title.isEmpty { Text(title) }
                    Picker(item.title ?? "", selection: Binding(get: { current }, set: { id in if let o = options.first(where: { $0.id == id }) { choose(o) } })) {
                        ForEach(options) { o in Text(o.title).tag(o.id) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }
                .disabled(item.disabled == true)
            case "inline":
                VStack(alignment: .leading, spacing: 0) {
                    if let title = item.title, !title.isEmpty {
                        Text(title).font(.footnote).foregroundStyle(.secondary).padding(.bottom, 6)
                    }
                    ForEach(options) { o in
                        Button {
                            choose(o)
                        } label: {
                            HStack {
                                Text(o.title).foregroundStyle(.primary)
                                Spacer()
                                if o.id == current { Image(systemName: "checkmark").foregroundStyle(.tint) }
                            }
                            .padding(.vertical, 8)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if o.id != options.last?.id { Divider() }
                    }
                }
                .disabled(item.disabled == true)
            default:
                Picker(selection: Binding(get: { current }, set: { id in if let o = options.first(where: { $0.id == id }) { choose(o) } })) {
                    ForEach(options) { o in Text(o.title).tag(o.id) }
                } label: {
                    RowLabel(title: item.title ?? "", subtitle: item.subtitle, icon: item.icon)
                }
                .pickerStyle(.menu)
                .disabled(item.disabled == true)
            }
        } else {
            // Options unknown until the PC opens the dropdown: ask for them, then show a picker.
            Button {
                if let load = item.load { session.perform(load) }
                picking = true
            } label: {
                HStack {
                    RowLabel(title: item.title ?? "", subtitle: item.subtitle, icon: item.icon)
                    Spacer()
                    Text(item.stringValue ?? "").foregroundStyle(.secondary).lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down").font(.footnote).foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(item.disabled == true || item.load == nil)
            .sheet(isPresented: $picking) {
                OptionsSheet(itemID: item.id, title: item.title ?? "", current: item.stringValue)
                    .environment(session)
                    .presentationDetents([.medium, .large])
            }
        }
    }
}

/// Options that arrive after asking the PC for them.
struct OptionsSheet: View {
    let itemID: String
    let title: String
    let current: String?
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    private var item: UIItem? {
        let screens = (session.view?.screens ?? []) + (session.view?.sheet.map { [$0] } ?? [])
        for s in screens {
            for sec in s.sections {
                if let i = sec.items.first(where: { $0.id == itemID }) { return i }
            }
        }
        return nil
    }

    var body: some View {
        NavigationStack {
            Group {
                if let options = item?.options {
                    if options.isEmpty {
                        ContentUnavailableView("No choices", systemImage: "list.bullet", description: Text("The PC didn't offer any options here."))
                    } else {
                        List(options) { o in
                            Button {
                                if let own = o.ref { session.perform(own) } else { session.set(item?.ref ?? "", o.id) }
                                dismiss()
                            } label: {
                                HStack {
                                    Text(o.title).foregroundStyle(.primary)
                                    Spacer()
                                    if o.title == current { Image(systemName: "checkmark").foregroundStyle(.tint) }
                                }
                            }
                        }
                    }
                } else {
                    ProgressView("Getting choices…")
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

struct SliderRow: View {
    let item: UIItem
    @Environment(AppSession.self) private var session
    @State private var value: Double = 0
    @State private var editing = false

    var body: some View {
        let lo = item.min ?? 0
        let hi = Swift.max(item.max ?? 100, lo + 0.0001)
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                RowLabel(title: item.title ?? "", icon: item.icon)
                Spacer()
                Text(format(value)).font(.footnote.monospacedDigit()).foregroundStyle(.secondary)
            }
            Slider(value: $value, in: lo...hi, onEditingChanged: { now in
                editing = now
                if !now { session.set(item.ref ?? "", value) }
            })
        }
        .disabled(item.disabled == true)
        .onAppear { value = item.numberValue ?? lo }
        .onChange(of: item.numberValue) { _, new in if !editing, let new { value = new } }
    }

    private func format(_ v: Double) -> String {
        v.rounded() == v || (item.max ?? 100) - (item.min ?? 0) > 20 ? String(Int(v.rounded())) : String(format: "%.1f", v)
    }
}

struct StepperRow: View {
    let item: UIItem
    @Environment(AppSession.self) private var session

    var body: some View {
        let ref = item.ref ?? ""
        let current = (session.pending[ref] as? Double) ?? item.numberValue ?? 0
        Stepper(value: Binding(get: { current }, set: { session.set(ref, $0) }), in: (item.min ?? -Double.greatestFiniteMagnitude)...(item.max ?? Double.greatestFiniteMagnitude), step: item.step ?? 1) {
            HStack {
                Text(item.title ?? "")
                Spacer()
                Text(current.rounded() == current ? String(Int(current)) : String(current)).foregroundStyle(.secondary).monospacedDigit()
            }
        }
    }
}

struct FieldRow: View {
    let item: UIItem
    @Environment(AppSession.self) private var session
    @State private var text = ""
    @State private var sent = ""
    @FocusState private var focused: Bool

    private var keyboard: UIKeyboardType {
        switch item.keyboard {
        case "number": return .numberPad
        case "decimal": return .decimalPad
        case "email": return .emailAddress
        case "url": return .URL
        case "phone": return .phonePad
        default: return .default
        }
    }

    private func commit(submit: Bool) {
        guard let ref = item.ref else { return }
        if text != sent {
            sent = text
            session.set(ref, text)
        }
        if submit, let s = item.submit { session.perform(s) }
    }

    var body: some View {
        Group {
            if item.readOnly == true {
                LabeledContent(item.title ?? "", value: item.stringValue ?? "")
                    .textSelection(.enabled)
            } else if item.multiline == true {
                VStack(alignment: .leading, spacing: 6) {
                    if let title = item.title { Text(title).font(.footnote).foregroundStyle(.secondary) }
                    TextField(item.placeholder ?? "", text: $text, axis: .vertical)
                        .lineLimit(3...10)
                        .focused($focused)
                }
            } else {
                HStack {
                    if let title = item.title, !title.isEmpty {
                        Text(title)
                        Spacer(minLength: 12)
                    }
                    Group {
                        if item.secure == true {
                            SecureField(item.placeholder ?? "Required", text: $text)
                        } else {
                            TextField(item.placeholder ?? "", text: $text)
                        }
                    }
                    .multilineTextAlignment(item.title == nil ? .leading : .trailing)
                    .keyboardType(keyboard)
                    .textInputAutocapitalization(item.keyboard == nil ? .sentences : .never)
                    .autocorrectionDisabled(item.keyboard != nil || item.secure == true)
                    .submitLabel(item.submit != nil ? .go : .done)
                    .focused($focused)
                    .onSubmit { commit(submit: true) }
                }
            }
        }
        .onAppear {
            text = item.stringValue ?? ""
            sent = text
        }
        .onChange(of: item.stringValue) { _, new in
            if !focused {
                text = new ?? ""
                sent = text
            }
        }
        .onChange(of: focused) { _, now in if !now { commit(submit: false) } }
    }
}

struct ButtonItemView: View {
    let item: UIItem
    @Environment(AppSession.self) private var session
    @State private var confirming = false

    var body: some View {
        if let action = item.action {
            let role: ButtonRole? = action.role == "destructive" ? .destructive : nil
            let button = Button(role: role) {
                if action.confirm != nil { confirming = true } else { session.perform(action) }
            } label: {
                if let symbol = action.symbol, item.style != "row" || action.title == nil {
                    Label(action.title ?? "", systemImage: symbol)
                } else {
                    Text(action.title ?? "")
                }
            }
            .disabled(action.disabled == true)
            .confirmationDialog(action.confirm ?? "", isPresented: $confirming, titleVisibility: .visible) {
                Button(action.title ?? "OK", role: role) { session.perform(action) }
            }
            switch item.style {
            case "prominent":
                button.buttonStyle(.borderedProminent).controlSize(.large).frame(maxWidth: .infinity)
            case "bordered":
                button.buttonStyle(.bordered)
            case "link":
                button.buttonStyle(.borderless)
            default:
                button
            }
        }
    }
}

struct TextRow: View {
    let item: UIItem

    var body: some View {
        let text = item.text ?? ""
        if let label = item.label {
            LabeledContent(label) {
                Text(text).multilineTextAlignment(.trailing)
            }
            .textSelection(.enabled)
        } else {
            switch item.style {
            case "display":
                Text(text)
                    .font(.system(size: 72, weight: .light))
                    .minimumScaleFactor(0.3)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .textSelection(.enabled)
            case "secondary":
                Text(text).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .trailing)
            case "caption":
                Text(text).font(.caption).foregroundStyle(.secondary)
            case "footnote":
                Text(text).font(.footnote).foregroundStyle(.secondary)
            case "headline":
                Text(text).font(.headline)
            case "title":
                Text(text).font(.title2.bold())
            case "largeTitle":
                Text(text).font(.largeTitle.bold())
            case "mono":
                Text(text).font(.body.monospaced())
            default:
                Text(text).textSelection(.enabled)
            }
        }
    }
}

struct HeadingRow: View {
    let item: UIItem

    var body: some View {
        let font: Font = {
            switch item.level ?? 2 {
            case 1: return .largeTitle.bold()
            case 2: return .title2.bold()
            case 3: return .title3.bold()
            default: return .headline
            }
        }()
        Text(item.text ?? "")
            .font(font)
            .padding(.top, (item.level ?? 2) <= 2 ? 8 : 2)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Links inside text use this scheme; the screen's openURL handler turns them into actions.
enum ActionLink {
    static let scheme = "remotepc-action"

    static func url(_ ref: String) -> URL? {
        var comps = URLComponents()
        comps.scheme = scheme
        comps.host = "a"
        comps.queryItems = [URLQueryItem(name: "ref", value: ref)]
        return comps.url
    }

    static func ref(from url: URL) -> String? {
        guard url.scheme == scheme else { return nil }
        return URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "ref" }?.value
    }
}

struct ParagraphRow: View {
    let item: UIItem

    private var attributed: AttributedString {
        var out = AttributedString()
        for run in item.runs ?? [] {
            var part = AttributedString(run.text)
            if let link = run.link, let url = ActionLink.url(link.ref) {
                part.link = url
            }
            if run.bold == true { part.font = .body.bold() }
            if run.italic == true { part.font = .body.italic() }
            if run.code == true { part.font = .body.monospaced() }
            out.append(part)
        }
        return out
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            if item.quote == true {
                RoundedRectangle(cornerRadius: 2).fill(.tertiary).frame(width: 3)
            }
            if let bullet = item.bullet { Text(bullet).foregroundStyle(.secondary) }
            Text(attributed)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct ImageRow: View {
    let item: UIItem
    @Environment(AppSession.self) private var session

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let src = item.image {
                RemoteImage(source: src) {
                    Rectangle().fill(Color(.secondarySystemFill)).aspectRatio(item.aspect ?? 1.6, contentMode: .fit)
                }
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .onTapGesture { if let tap = item.tap { session.perform(tap) } }
            }
            if let caption = item.caption { Text(caption).font(.footnote).foregroundStyle(.secondary) }
        }
    }
}

struct ProgressRow: View {
    let item: UIItem

    var body: some View {
        if let v = item.numberValue {
            ProgressView(value: Swift.min(Swift.max(v, 0), 1)) {
                if let title = item.title { Text(title) }
            } currentValueLabel: {
                Text(item.label ?? "\(Int(v * 100))%")
            }
        } else {
            HStack {
                ProgressView()
                if let title = item.title { Text(title).foregroundStyle(.secondary) }
            }
        }
    }
}

struct ListRow: View {
    let item: UIItem
    @Environment(AppSession.self) private var session

    var body: some View {
        HStack(spacing: 8) {
            if let expanded = item.expanded, let expand = item.expand {
                Button {
                    session.perform(expand)
                } label: {
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 20, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
            }
            Button {
                if let tap = item.tap { session.perform(tap) }
            } label: {
                content
            }
            .buttonStyle(.plain)
        }
        .padding(.leading, CGFloat(item.level ?? 0) * 18)
        .listRowBackground(item.selected?.isOn == true ? Color.accentColor.opacity(0.12) : nil)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            ForEach(item.swipe ?? [], id: \.ref) { a in
                Button(role: a.role == "destructive" ? .destructive : nil) { session.perform(a) } label: { MenuLabel(title: a.title ?? "", symbol: a.symbol, checked: false) }
            }
        }
        .swipeActions(edge: .leading) {
            ForEach(item.leadingSwipe ?? [], id: \.ref) { a in
                Button { session.perform(a) } label: { MenuLabel(title: a.title ?? "", symbol: a.symbol, checked: false) }.tint(.blue)
            }
        }
        .contextMenu {
            if let menu = item.menu, !menu.isEmpty { MenuContent(items: menu) }
        }
    }

    private var content: some View {
        HStack(alignment: item.detail == nil ? .center : .top, spacing: 12) {
            if item.unread == true {
                Circle().fill(Color.accentColor).frame(width: 9, height: 9).padding(.top, item.detail == nil ? 0 : 6)
            }
            if let icon = item.icon { UIIconView(icon: icon, size: item.detail == nil ? 30 : 40) }
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(item.title ?? "")
                        .fontWeight(item.unread == true ? .semibold : .regular)
                        .lineLimit(1)
                    Spacer(minLength: 6)
                    if let meta = item.meta {
                        Text(meta).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                if let subtitle = item.subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.subheadline).foregroundStyle(item.detail == nil ? .secondary : .primary).lineLimit(1)
                }
                if let detail = item.detail, !detail.isEmpty {
                    Text(detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            if item.checked == true { Image(systemName: "checkmark").foregroundStyle(.tint) }
            if item.chevron == true {
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
        }
        .contentShape(Rectangle())
    }
}

struct TileView: View {
    let item: UIItem
    @Environment(AppSession.self) private var session

    var body: some View {
        Button {
            if let tap = item.tap { session.perform(tap) }
        } label: {
            VStack(spacing: 6) {
                Group {
                    if let image = item.image {
                        RemoteImage(source: image, contentMode: .fill) { Color(.secondarySystemFill) }
                            .frame(height: 84)
                            .frame(maxWidth: .infinity)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    } else if let icon = item.icon {
                        UIIconView(icon: icon, size: 56).frame(height: 84)
                    } else {
                        RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(.secondarySystemFill)).frame(height: 84)
                    }
                }
                Text(item.title ?? "").font(.caption).lineLimit(2).multilineTextAlignment(.center).foregroundStyle(.primary)
                if let s = item.subtitle { Text(s).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            if let menu = item.menu, !menu.isEmpty { MenuContent(items: menu) }
        }
    }
}

struct MessageBubble: View {
    let item: UIItem

    var body: some View {
        if item.system == true {
            Text(item.text ?? "")
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
        } else {
            let outgoing = item.outgoing == true
            HStack(alignment: .bottom, spacing: 8) {
                if outgoing { Spacer(minLength: 48) }
                if !outgoing {
                    if let avatar = item.avatar { UIIconView(icon: avatar, size: 30) } else { Color.clear.frame(width: 30, height: 1) }
                }
                VStack(alignment: outgoing ? .trailing : .leading, spacing: 3) {
                    if let author = item.author, !outgoing {
                        HStack(spacing: 6) {
                            Text(author).font(.caption.weight(.semibold))
                            if let time = item.time { Text(time).font(.caption2).foregroundStyle(.secondary) }
                        }
                        .padding(.leading, 4)
                    }
                    if !(item.text ?? "").isEmpty {
                        Text(item.text ?? "")
                            .textSelection(.enabled)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .foregroundStyle(outgoing ? Color.white : Color.primary)
                            .background(outgoing ? Color.accentColor : Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }
                    ForEach(item.images ?? [], id: \.self) { src in
                        RemoteImage(source: src) { Color(.secondarySystemFill).frame(height: 160) }
                            .frame(maxWidth: 240)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    if let reactions = item.reactions, !reactions.isEmpty {
                        HStack(spacing: 4) {
                            ForEach(reactions, id: \.self) { r in
                                Text(r).font(.caption).padding(.horizontal, 7).padding(.vertical, 3).background(Color(.tertiarySystemFill), in: Capsule())
                            }
                        }
                    }
                    if outgoing, let time = item.time { Text(time).font(.caption2).foregroundStyle(.secondary) }
                }
                if !outgoing { Spacer(minLength: 48) }
            }
            .padding(.top, item.author == nil ? 0 : 6)
        }
    }
}

struct RecordCard: View {
    let item: UIItem
    @Environment(AppSession.self) private var session

    var body: some View {
        Button {
            if let tap = item.tap { session.perform(tap) }
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                Text(item.title ?? "").font(.headline)
                ForEach(Array((item.fields ?? []).enumerated()), id: \.offset) { _, f in
                    HStack(alignment: .firstTextBaseline) {
                        Text(f.label).font(.subheadline).foregroundStyle(.secondary)
                        Spacer(minLength: 12)
                        Text(f.value).font(.subheadline).multilineTextAlignment(.trailing)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            if let menu = item.menu, !menu.isEmpty { MenuContent(items: menu) }
        }
    }
}

/// Calculator-style keys in the original layout.
struct KeypadView: View {
    let item: UIItem
    @Environment(AppSession.self) private var session

    var body: some View {
        let rows = item.rows ?? []
        let columns = rows.map { $0.reduce(0) { $0 + ($1?.span ?? 1) } }.max() ?? 4
        GeometryReader { geo in
            let gap: CGFloat = 12
            let size = (geo.size.width - gap * CGFloat(columns - 1)) / CGFloat(columns)
            VStack(spacing: gap) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    HStack(spacing: gap) {
                        ForEach(Array(row.enumerated()), id: \.offset) { _, key in
                            if let key {
                                let span = CGFloat(key.span ?? 1)
                                Button {
                                    session.perform(key.ref)
                                } label: {
                                    Group {
                                        if let symbol = key.symbol { Image(systemName: symbol) } else { Text(key.title ?? "") }
                                    }
                                    .font(.system(size: size * 0.38, weight: .medium))
                                    .frame(width: size * span + gap * (span - 1), height: size)
                                    .foregroundStyle(key.tone == "secondary" ? Color.black : Color.white)
                                    .background(color(key.tone), in: Capsule())
                                }
                                .buttonStyle(KeyPressStyle())
                                .disabled(key.disabled == true)
                                .opacity(key.disabled == true ? 0.4 : 1)
                            } else {
                                Color.clear.frame(width: size, height: size)
                            }
                        }
                    }
                }
            }
        }
        .aspectRatio(CGFloat(columns) / CGFloat(max(rows.count, 1)) * 0.98, contentMode: .fit)
        .listRowBackground(Color.clear)
        .padding(.vertical, 6)
    }

    private func color(_ tone: String?) -> Color {
        switch tone {
        case "accent": return .orange
        case "secondary": return Color(white: 0.65)
        default: return Color(white: 0.2)
        }
    }
}

struct KeyPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brightness(configuration.isPressed ? 0.25 : 0)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

struct ButtonsRow: View {
    let item: UIItem
    @Environment(AppSession.self) private var session

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(item.actions ?? [], id: \.ref) { a in
                    Button(role: a.role == "destructive" ? .destructive : nil) {
                        session.perform(a)
                    } label: {
                        if let symbol = a.symbol, a.title == nil { Image(systemName: symbol) } else { Text(a.title ?? "") }
                    }
                    .buttonStyle(.bordered)
                    .tint(a.role == "primary" ? .accentColor : nil)
                    .disabled(a.disabled == true)
                }
            }
        }
    }
}

struct ProfileRow: View {
    let item: UIItem
    @Environment(AppSession.self) private var session

    var body: some View {
        Button {
            if let tap = item.tap { session.perform(tap) }
        } label: {
            HStack(spacing: 14) {
                UIIconView(icon: item.icon ?? UIIcon(symbol: "person.crop.circle.fill", color: "gray", style: "plain"), size: 60)
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.title ?? "").font(.title3.weight(.semibold))
                    if let s = item.subtitle { Text(s).font(.footnote).foregroundStyle(.secondary) }
                }
                Spacer()
                if item.tap != nil { Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary) }
            }
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(item.tap == nil)
    }
}
