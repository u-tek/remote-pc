import UIKit

/// Invisible text field that turns the iPhone keyboard into the PC's keyboard.
final class KeyboardField: UITextField {
    var onBackspace: (() -> Void)?
    var onResign: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        autocorrectionType = .no
        autocapitalizationType = .none
        spellCheckingType = .no
        smartQuotesType = .no
        smartDashesType = .no
        smartInsertDeleteType = .no
        textColor = .clear
        tintColor = .clear
        backgroundColor = .clear
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func deleteBackward() {
        onBackspace?()
    }

    override func resignFirstResponder() -> Bool {
        let resigned = super.resignFirstResponder()
        if resigned { onResign?() }
        return resigned
    }
}

/// The row above the keyboard: Esc, Tab, modifiers, arrows, F-keys and common Windows shortcuts.
final class KeyBar: UIInputView {
    var onKey: ((String) -> Void)?
    var onModifier: ((String) -> Void)?
    var onCombo: (([String]) -> Void)?
    var onHide: (() -> Void)?

    private var modifierButtons: [String: UIButton] = [:]

    init() {
        super.init(frame: CGRect(x: 0, y: 0, width: 320, height: 48), inputViewStyle: .keyboard)
        autoresizingMask = [.flexibleWidth]
        let scroll = UIScrollView()
        scroll.showsHorizontalScrollIndicator = false
        scroll.translatesAutoresizingMaskIntoConstraints = false
        let stack = UIStackView()
        stack.axis = .horizontal
        stack.spacing = 6
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(scroll)
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: trailingAnchor),
            scroll.topAnchor.constraint(equalTo: topAnchor),
            scroll.bottomAnchor.constraint(equalTo: bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 8),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -8),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 6),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -6),
            stack.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor, constant: -12),
        ])

        stack.addArrangedSubview(button("Esc") { [weak self] in self?.onKey?("esc") })
        stack.addArrangedSubview(button("Tab") { [weak self] in self?.onKey?("tab") })
        for (name, title) in [("ctrl", "Ctrl"), ("alt", "Alt"), ("shift", "Shift"), ("win", "⊞ Win")] {
            let b = button(title) { [weak self] in self?.onModifier?(name) }
            modifierButtons[name] = b
            stack.addArrangedSubview(b)
        }
        for (name, title) in [("left", "←"), ("up", "↑"), ("down", "↓"), ("right", "→")] {
            stack.addArrangedSubview(button(title) { [weak self] in self?.onKey?(name) })
        }
        for (name, title) in [("delete", "Del"), ("home", "Home"), ("end", "End"), ("pageup", "PgUp"), ("pagedown", "PgDn")] {
            stack.addArrangedSubview(button(title) { [weak self] in self?.onKey?(name) })
        }
        let fkeys = button("F1–F12") {}
        fkeys.menu = UIMenu(children: (1...12).map { i in
            UIAction(title: "F\(i)") { [weak self] _ in self?.onKey?("f\(i)") }
        })
        fkeys.showsMenuAsPrimaryAction = true
        stack.addArrangedSubview(fkeys)
        let combos: [(String, [String])] = [
            ("Copy", ["ctrl", "c"]),
            ("Paste", ["ctrl", "v"]),
            ("Undo", ["ctrl", "z"]),
            ("Alt+Tab", ["alt", "tab"]),
            ("Start", ["win"]),
            ("Task view", ["win", "tab"]),
            ("Desktop", ["win", "d"]),
            ("Task Mgr", ["ctrl", "shift", "esc"]),
            ("Close app", ["alt", "f4"]),
        ]
        for (title, keys) in combos {
            stack.addArrangedSubview(button(title) { [weak self] in self?.onCombo?(keys) })
        }
        let hide = button("⌄") { [weak self] in self?.onHide?() }
        stack.addArrangedSubview(hide)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    private func button(_ title: String, action: @escaping () -> Void) -> UIButton {
        var config = UIButton.Configuration.gray()
        config.title = title
        config.cornerStyle = .medium
        config.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 10, bottom: 6, trailing: 10)
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = UIFont.systemFont(ofSize: 14, weight: .semibold)
            return outgoing
        }
        let b = UIButton(configuration: config, primaryAction: UIAction { _ in
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            action()
        })
        return b
    }

    /// Highlight the modifiers that will apply to the next key.
    func update(modifiers: [String]) {
        for (name, b) in modifierButtons {
            let on = modifiers.contains(name)
            var config = on ? UIButton.Configuration.filled() : UIButton.Configuration.gray()
            config.title = b.configuration?.title
            config.cornerStyle = .medium
            config.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 10, bottom: 6, trailing: 10)
            config.titleTextAttributesTransformer = b.configuration?.titleTextAttributesTransformer
            b.configuration = config
        }
    }
}
