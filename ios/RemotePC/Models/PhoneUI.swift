import Foundation

// Swift mirror of the Phone UI protocol v1 (agent/src/ui/schema.ts). Every field the phone does
// not strictly need is optional, so newer agents and SDK apps never break older phones.

struct PhoneAppView: Decodable, Equatable {
    var v: Int?
    var app: PhoneAppInfo
    var screens: [PhoneScreen]
    var sheet: PhoneScreen?
    var alert: PhoneAlert?
    var toast: String?
}

struct PhoneAppInfo: Decodable, Equatable {
    var id: String
    var name: String
    var icon: PhoneIcon?
    var tint: String?
    var source: String?
    var adapter: String?
}

struct PhoneScreen: Decodable, Equatable, Identifiable, Hashable {
    var id: String
    var title: String
    var subtitle: String?
    var style: String?
    var largeTitle: Bool?
    var search: PhoneSearchField?
    var segments: PhoneSegments?
    var actions: [PhoneAction]?
    var menu: [PhoneMenuItem]?
    var bottomBar: [PhoneAction]?
    var sections: [PhoneSection]
    var composer: PhoneComposer?
    var more: PhoneAction?
    var back: PhoneAction?
    var address: PhoneAddress?
    var document: PhoneDocumentBody?
    var empty: PhoneEmpty?
    var refresh: PhoneAction?

    static func == (a: PhoneScreen, b: PhoneScreen) -> Bool { a.id == b.id && a.sections == b.sections && a.title == b.title && a.document == b.document && a.address == b.address && a.menu == b.menu && a.actions == b.actions && a.bottomBar == b.bottomBar && a.segments == b.segments && a.search == b.search && a.composer == b.composer && a.empty == b.empty }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct PhoneEmpty: Decodable, Equatable {
    var title: String
    var message: String?
    var symbol: String?
}

struct PhoneSection: Decodable, Equatable, Identifiable {
    var id: String
    var header: String?
    var footer: String?
    var style: String?
    var items: [PhoneItem]
}

struct PhoneChoice: Decodable, Equatable, Identifiable, Hashable {
    var id: String
    var title: String
    var symbol: String?
    var ref: String?
}

struct PhoneRun: Decodable, Equatable {
    var text: String
    var link: PhoneAction?
    var bold: Bool?
    var italic: Bool?
    var code: Bool?
}

struct PhoneRecordField: Decodable, Equatable {
    var label: String
    var value: String
}

struct PhoneKey: Decodable, Equatable {
    var ref: String
    var title: String?
    var symbol: String?
    var disabled: Bool?
    var span: Int?
    var tone: String?
}

struct PhoneStream: Decodable, Equatable {
    var hwnd: Int64
}

/// One row/control. `kind` says which fields matter (see schema.ts); unknown kinds are skipped.
struct PhoneItem: Decodable, Equatable, Identifiable {
    var id: String
    var kind: String
    var title: String?
    var subtitle: String?
    var value: PhoneValue?
    var icon: PhoneIcon?
    var badge: String?
    /// A flag on rows ("this one is selected"), an option id on choices.
    var selected: PhoneSelected?
    var tap: PhoneAction?
    var on: Bool?
    var ref: String?
    var disabled: Bool?
    var options: [PhoneChoice]?
    var load: PhoneAction?
    var style: String?
    var min: Double?
    var max: Double?
    var step: Double?
    var placeholder: String?
    var secure: Bool?
    var multiline: Bool?
    var readOnly: Bool?
    var keyboard: String?
    var submit: PhoneAction?
    var action: PhoneAction?
    var radio: Bool?
    var text: String?
    var label: String?
    var copyable: Bool?
    var level: Int?
    var runs: [PhoneRun]?
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
    var menu: [PhoneMenuItem]?
    var swipe: [PhoneAction]?
    var leadingSwipe: [PhoneAction]?
    var expanded: Bool?
    var expand: PhoneAction?
    var author: String?
    var time: String?
    var avatar: PhoneIcon?
    var outgoing: Bool?
    var images: [String]?
    var reactions: [String]?
    var replyTo: String?
    var system: Bool?
    var fields: [PhoneRecordField]?
    var rows: [[PhoneKey?]]?
    var actions: [PhoneAction]?
    var region: String?
    var stream: PhoneStream?

    var stringValue: String? { value?.string }
    var numberValue: Double? { value?.number }
}

enum PhoneSelected: Decodable, Equatable {
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
enum PhoneValue: Decodable, Equatable {
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

struct PhoneIcon: Decodable, Equatable, Hashable {
    var symbol: String?
    var image: String?
    var text: String?
    var color: String?
    var style: String?
}

struct PhoneAction: Decodable, Equatable, Hashable {
    var ref: String
    var title: String?
    var symbol: String?
    var role: String?
    var disabled: Bool?
    var confirm: String?
    var value: PhoneActionValue?
}

/// Fixed values an action carries (string, number or bool).
enum PhoneActionValue: Decodable, Equatable, Hashable {
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

struct PhoneMenuItem: Decodable, Equatable, Hashable, Identifiable {
    var title: String
    var symbol: String?
    var action: PhoneAction?
    var children: [PhoneMenuItem]?
    var load: PhoneAction?
    var checked: Bool?
    var role: String?
    var disabled: Bool?

    var id: String { (action?.ref ?? load?.ref ?? "") + "|" + title }
}

struct PhoneSearchField: Decodable, Equatable {
    var ref: String
    var placeholder: String
    var value: String
    var submit: PhoneAction?
}

struct PhoneSegments: Decodable, Equatable {
    var items: [PhoneChoice]
    var selected: String?
    var ref: String?
}

struct PhoneComposer: Decodable, Equatable {
    var ref: String
    var placeholder: String
    var value: String?
    var attach: PhoneAction?
}

struct PhoneAddress: Decodable, Equatable {
    var value: String
    var ref: String
    var secure: Bool?
    var title: String?
}

struct PhoneDocumentBody: Decodable, Equatable {
    var text: String
    var ref: String?
    var typeRef: String?
    var format: String?
}

struct PhoneAlert: Decodable, Equatable, Identifiable {
    var title: String
    var message: String?
    var actions: [PhoneAction]

    var id: String { title + (message ?? "") + actions.map(\.ref).joined() }
}

/// Entry in the phone's app grid.
struct PhoneAppSummary: Decodable, Equatable, Identifiable, Hashable {
    var id: String
    var name: String
    var title: String?
    var icon: PhoneIcon?
    var kind: String
    var adapter: String?
    var running: Bool
    var focused: Bool?
}

/// Agent → phone on /api/ui.
struct PhoneServerMessage: Decodable {
    var type: String
    var view: PhoneAppView?
    var message: String?
}
