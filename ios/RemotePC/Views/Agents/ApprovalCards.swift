import SwiftUI

/// A tool call waiting for permission. Allow once, always allow (when the agent offers it), or deny.
struct ApprovalCard: View {
    let approval: Approval
    var showSession = true
    @Environment(AppModel.self) private var model
    @State private var showDetails = false
    @State private var askReason = false
    @State private var reason = ""

    private var isPlan: Bool { approval.toolName == "ExitPlanMode" }
    private var hasDetails: Bool {
        !approval.input.isEmpty && approval.input != "{}" && approval.input != approval.detail
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: isPlan ? "list.bullet.clipboard.fill" : "hand.raised.fill")
                    .foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 2) {
                    Text(isPlan ? "Plan ready for review" : approval.title)
                        .font(.subheadline.bold())
                        .fixedSize(horizontal: false, vertical: true)
                    if showSession {
                        Text(approval.sessionTitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
            if let detail = approval.detail, !detail.isEmpty {
                Text(detail)
                    .font(isPlan ? .footnote : .footnote.monospaced())
                    .lineLimit(5)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .background(Color(.tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
            }
            if hasDetails {
                Button {
                    showDetails = true
                } label: {
                    Label(isPlan ? "Read the plan" : "Show details", systemImage: "doc.text.magnifyingglass")
                        .font(.caption)
                }
            }
            HStack(spacing: 8) {
                Menu {
                    Button(role: .destructive) { decide("deny") } label: { Label(isPlan ? "Keep planning" : "Deny", systemImage: "xmark") }
                    Button { askReason = true } label: { Label("Deny and explain…", systemImage: "text.bubble") }
                } label: {
                    Text(isPlan ? "Keep planning" : "Deny")
                } primaryAction: {
                    decide("deny")
                }
                .menuStyle(.button)
                .buttonStyle(.bordered)
                .tint(.red)
                Spacer(minLength: 0)
                if approval.canAlways {
                    Button("Always") { decide("always") }
                        .buttonStyle(.bordered)
                }
                Button(isPlan ? "Approve" : "Allow") { decide("allow") }
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(12)
        .background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.orange.opacity(0.4)))
        .alert("Tell the agent why", isPresented: $askReason) {
            TextField("What should it do instead?", text: $reason)
            Button("Deny", role: .destructive) { decide("deny", message: reason) }
            Button("Cancel", role: .cancel) {}
        }
        .sheet(isPresented: $showDetails) {
            NavigationStack {
                ScrollView {
                    if isPlan {
                        MarkdownText(approval.input).padding()
                    } else {
                        Text(approval.input)
                            .font(.footnote.monospaced())
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding()
                    }
                }
                .navigationTitle(approval.toolName)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Close") { showDetails = false } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(isPlan ? "Approve" : "Allow") {
                            showDetails = false
                            decide("allow")
                        }
                    }
                }
            }
        }
    }

    private func decide(_ decision: String, message: String? = nil) {
        Task { await model.decide(approval, decision, message: message) }
    }
}

/// One or more multiple-choice questions from the agent (Claude's AskUserQuestion, OpenCode's question tool).
struct QuestionCard: View {
    let question: QuestionPrompt
    var onDone: (() -> Void)?
    @Environment(AppModel.self) private var model
    @State private var selections: [Int: Set<String>] = [:]
    @State private var custom: [Int: String] = [:]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(Array(question.questions.enumerated()), id: \.offset) { index, q in
                VStack(alignment: .leading, spacing: 8) {
                    if !q.header.isEmpty {
                        Text(q.header.uppercased())
                            .font(.caption2.bold())
                            .foregroundStyle(.secondary)
                    }
                    Text(q.question)
                        .font(.subheadline.bold())
                        .fixedSize(horizontal: false, vertical: true)
                    ForEach(q.options, id: \.label) { option in
                        optionRow(option, index: index, multiple: q.multiple)
                    }
                    if q.custom {
                        TextField("Other answer…", text: Binding(
                            get: { custom[index] ?? "" },
                            set: { custom[index] = $0 }
                        ))
                        .textFieldStyle(.roundedBorder)
                    }
                }
            }
            HStack {
                Button("Skip") {
                    onDone?()
                    Task { await model.answer(question, answers: nil) }
                }
                .buttonStyle(.bordered)
                Spacer()
                Button("Send answer") {
                    let result = answers()
                    onDone?()
                    Task { await model.answer(question, answers: result) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!answers().allSatisfy { !$0.isEmpty })
            }
        }
        .padding(12)
        .background(Color.blue.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.blue.opacity(0.35)))
    }

    private func optionRow(_ option: QuestionOption, index: Int, multiple: Bool) -> some View {
        let selected = selections[index, default: []].contains(option.label)
        let symbol = multiple ? (selected ? "checkmark.square.fill" : "square") : (selected ? "largecircle.fill.circle" : "circle")
        return Button {
            var set = selections[index, default: []]
            if multiple {
                if set.contains(option.label) { set.remove(option.label) } else { set.insert(option.label) }
            } else {
                set = [option.label]
                custom[index] = nil
            }
            selections[index] = set
            Haptics.tap()
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: symbol)
                    .foregroundStyle(selected ? Color.accentColor : Color.secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(option.label).font(.subheadline)
                    if let description = option.description, !description.isEmpty {
                        Text(description).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func answers() -> [[String]] {
        question.questions.indices.map { i in
            let chosen = selections[i, default: []]
            var list = question.questions[i].options.map(\.label).filter { chosen.contains($0) }
            if let other = custom[i]?.trimmingCharacters(in: .whitespacesAndNewlines), !other.isEmpty {
                if !question.questions[i].multiple { list = [] }
                list.append(other)
            }
            return list
        }
    }
}
