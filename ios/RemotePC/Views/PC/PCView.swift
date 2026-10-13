import SwiftUI

enum PCSection: String, CaseIterable, Identifiable {
    case start = "Start"
    case windows = "Windows"
    case tasks = "Tasks"
    case clipboard = "Clipboard"

    var id: String { rawValue }
}

/// The "mobile Windows" shell: phone-native Start menu, window switcher, Task Manager and clipboard.
struct PCView: View {
    @Environment(AppModel.self) private var model
    @AppStorage("pcSection") private var sectionRaw = PCSection.start.rawValue

    private var section: PCSection { PCSection(rawValue: sectionRaw) ?? .start }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Section", selection: $sectionRaw) {
                    ForEach(PCSection.allCases) { s in Text(s.rawValue).tag(s.rawValue) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.bottom, 8)

                Group {
                    if model.client == nil || model.connection == .idle {
                        NotConnectedView()
                    } else if model.info?.windows == false {
                        WindowsOnlyView()
                    } else {
                        switch section {
                        case .start: StartMenuView()
                        case .windows: WindowSwitcherView()
                        case .tasks: TaskManagerView()
                        case .clipboard: ClipboardView()
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .navigationTitle(model.selectedPC?.name ?? "PC")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
