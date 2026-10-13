import Foundation

// Swift mirror of the Phone UI protocol v1 (agent/src/ui/schema.ts). Every field the phone does
// not strictly need is optional, so newer agents and SDK apps never break older phones.

struct UIAppView: Decodable, Equatable {
    var v: Int?
    var app: UIAppInfo
    var screens: [UIScreen]
    var sheet: UIScreen?
    var alert: UIAlert?
    var toast: String?
}

struct UIAppInfo: Decodable, Equatable {
    var id: String
    var name: String
    var icon: UIIcon?
    var tint: String?
    var source: String?
    var adapter: String?
}

struct UIScreen: Decodable, Equatable, Identifiable, Hashable {
    var id: String
    var title: String
    var subtitle: String?
    var style: String?
    var largeTitle: Bool?
    var search: UISearchField?
    var segments: UISegments?
    var actions: [UIAction]?
    var menu: [UIMenuItem]?
    var bottomBar: [UIAction]?
    var sections: [UISection]
    var composer: UIComposer?
    var more: UIAction?
    var back: UIAction?
    var address: UIAddress?
    var document: UIDocumentBody?
    var empty: UIEmpty?
    var refresh: UIAction?

    static func == (a: UIScreen, b: UIScreen) -> Bool { a.id == b.id && a.sections == b.sections && a.title == b.title && a.document == b.document && a.address == b.address && a.menu == b.menu && a.actions == b.actions && a.bottomBar == b.bottomBar && a.segments == b.segments && a.search == b.search && a.composer == b.composer && a.empty == b.empty }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct UIEmpty: Decodable, Equatable {
    var title: String
    var message: String?
    var symbol: String?
}

struct UISection: Decodable, Equatable, Identifiable {
    var id: String
    var header: String?
    var footer: String?
    var style: String?
    var items: [UIItem]
}

struct UIChoice: Decodable, Equatable, Identifiable, Hashable {
    var id: String
    var title: String
    var symbol: String?
    var ref: String?
}

struct UIRun: Decodable, Equatable {
    var text: String
    var link: UIAction?
    var bold: Bool?
    var italic: Bool?
    var code: Bool?
}

struct UIRecordField: Decodable, Equatable {
    var label: String
    var value: String
}

struct UIKey: Decodable, Equatable {
    var ref: String
    var title: String?
    var symbol: String?
    var disabled: Bool?
    var span: Int?
    var tone: String?
}

struct UIStream: Decodable, Equatable {
    var hwnd: Int64
}

/// One row/control. `kind` says which fields matter (see schema.ts); unknown kinds are skipped.
struct UIItem: Decodable, Equatable, Identifiable {
    var id: String
    var kind: String
    var title: String?
    var subtitle: String?
    var value: UIValue?
    var icon: UIIcon?
    var badge: String?
    /// A flag on rows ("this one is selected"), an option id on choices.
    var selected: UISelected?
    var tap: UIAction?
    var on: Bool?
    var ref: String?
    var disabled: Bool?
    var options: [UIChoice]?
    var load: UIAction?
    var style: String?
    var min: Double?
    var max: Double?
    var step: Double?
    var placeholder: String?
    var secure: Bool?
    var multiline: Bool?
    var readOnly: Bool?
    var keyboard: String?
    var submit: UIAction?
    var action: UIAction?
    var radio: Bool?
    var text: String?
    var label: String?
    var copyable: Bool?
    var level: Int?
    var runs: [UIRun]?
    var bullet: String?
    var quote: Bool?
    var image: String?
    var caption: String?
    var aspect: Double?
    var detail: String?
    var meta: String?
    var unread: Bool?
    var checked: Bool?
    var chevron: Bool?
    var menu: [UIMenuItem]?
    var swipe: [UIAction]?
    var leadingSwipe: [UIAction]?
    var expanded: Bool?
    var expand: UIAction?
    var author: String?
    var time: String?
    var avatar: UIIcon?
    var outgoing: Bool?
    var images: [String]?
    var reactions: [String]?
    var replyTo: String?
    var system: Bool?
    var fields: [UIRecordField]?
    var rows: [[UIKey?]]?
    var actions: [UIAction]?
    var region: String?
    var stream: UIStream?

    var stringValue: String? { value?.string }
    var numberValue: Double? { value?.number }
}

enum UISelected: Decodable, Equatable {
    case flag(Bool)
    case option(String)

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let b = try? c.decode(Bool.self) { self = .flag(b) } else { self = .option(try c.decode(String.self)) }
    }

    var isOn: Bool {
        if case .flag(let b) = self { return b }
        return false
    }

    var optionID: String? {
        if case .option(let id) = self { return id }
        return nil
    }
}

/// `value` is text for most items and a number for sliders and steppers.
enum UIValue: Decodable, Equatable {
    case string(String)
    case number(Double)

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let d = try? c.decode(Double.self) { self = .number(d) } else { self = .string(try c.decode(String.self)) }
    }

    var string: String? {
        switch self {
        case .string(let s): return s
        case .number(let d): return d.rounded() == d ? String(Int(d)) : String(d)
        }
    }

    var number: Double? {
        switch self {
        case .number(let d): return d
        case .string(let s): return Double(s)
        }
    }
}

struct UIIcon: Decodable, Equatable, Hashable {
    var symbol: String?
    var image: String?
    var text: String?
    var color: String?
    var style: String?
}

struct UIAction: Decodable, Equatable, Hashable {
    var ref: String
    var title: String?
    var symbol: String?
    var role: String?
    var disabled: Bool?
    var confirm: String?
    var value: UIActionValue?
}

/// Fixed values an action carries (string, number or bool).
enum UIActionValue: Decodable, Equatable, Hashable {
    case string(String)
    case number(Double)
    case bool(Bool)

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let b = try? c.decode(Bool.self) { self = .bool(b) } else if let d = try? c.decode(Double.self) { self = .number(d) } else { self = .string(try c.decode(String.self)) }
    }

    var any: Any {
        switch self {
        case .string(let s): return s
        case .number(let d): return d
        case .bool(let b): return b
        }
    }
}

struct UIMenuItem: Decodable, Equatable, Hashable, Identifiable {
    var title: String
    var symbol: String?
    var action: UIAction?
    var children: [UIMenuItem]?
    var load: UIAction?
    var checked: Bool?
    var role: String?
    var disabled: Bool?

    var id: String { (action?.ref ?? load?.ref ?? "") + "|" + title }
}

struct UISearchField: Decodable, Equatable {
    var ref: String
    var placeholder: String
    var value: String
    var submit: UIAction?
}

struct UISegments: Decodable, Equatable {
    var items: [UIChoice]
    var selected: String?
    var ref: String?
}

struct UIComposer: Decodable, Equatable {
    var ref: String
    var placeholder: String
    var value: String?
    var attach: UIAction?
}

struct UIAddress: Decodable, Equatable {
    var value: String
    var ref: String
    var secure: Bool?
    var title: String?
}

struct UIDocumentBody: Decodable, Equatable {
    var text: String
    var ref: String?
    var typeRef: String?
    var format: String?
}

struct UIAlert: Decodable, Equatable, Identifiable {
    var title: String
    var message: String?
    var actions: [UIAction]

    var id: String { title + (message ?? "") + actions.map(\.ref).joined() }
}

/// Entry in the phone's app grid.
struct UIAppSummary: Decodable, Equatable, Identifiable, Hashable {
    var id: String
    var name: String
    var title: String?
    var icon: UIIcon?
    var kind: String
    var adapter: String?
    var running: Bool
    var focused: Bool?
}

/// Agent → phone on /api/ui.
struct UIServerMessage: Decodable {
    var type: String
    var view: UIAppView?
    var message: String?
}
