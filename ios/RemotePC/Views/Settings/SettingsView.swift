import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @AppStorage("faceIDLock") private var faceIDLock = false
    @AppStorage("backgroundAlerts") private var backgroundAlerts = false
    @State private var pairing = false
    @State private var confirmRemove: PCProfile?

    var body: some View {
        NavigationStack {
            Form {
                if let pc = model.selectedPC {
                    Section("Connected PC") {
                        LabeledContent("Name", value: pc.name)
                        LabeledContent("Address", value: "\(pc.host):\(pc.port)")
                        LabeledContent("Status") {
                            HStack(spacing: 6) {
                                Circle()
                                    .fill(model.connection == .connected ? Color.green : Color.orange)
                                    .frame(width: 8, height: 8)
                                Text(model.connection == .connected ? "Connected" : "Offline")
                            }
                        }
                        if let info = model.info {
                            LabeledContent("Agent version", value: info.version)
                            ForEach(AgentKind.allCases) { kind in
                                if let status = info.agents[kind.rawValue] {
                                    LabeledContent(kind.displayName) {
                                        Text(status.available ? "Ready" : (status.detail ?? "Unavailable"))
                                            .foregroundStyle(status.available ? Color.green : Color.secondary)
                                            .multilineTextAlignment(.trailing)
                                    }
                                }
                            }
                        }
                        if model.connection != .connected {
                            Text(model.connection.label).font(.footnote).foregroundStyle(.secondary)
                        }
                        Button("Reconnect") { model.reconnect() }
                    }
                }

                Section {
                    ForEach(model.pcs) { pc in
                        Button {
                            model.select(pc.id)
                        } label: {
                            HStack {
                                Image(systemName: "desktopcomputer")
                                VStack(alignment: .leading) {
                                    Text(pc.name).foregroundStyle(.primary)
                                    Text("\(pc.host):\(pc.port)").font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if pc.id == model.selectedID { Image(systemName: "checkmark").foregroundStyle(.tint) }
                            }
                        }
                        .swipeActions {
                            Button("Remove", role: .destructive) { confirmRemove = pc }
                        }
                    }
                    Button {
                        pairing = true
                    } label: {
                        Label("Add a PC", systemImage: "plus")
                    }
                } header: {
                    Text("PCs")
                } footer: {
                    Text("Swipe left on a PC to remove it.")
                }

                Section {
                    Toggle("Require Face ID", isOn: $faceIDLock)
                    Toggle("Alerts right after leaving the app", isOn: $backgroundAlerts)
                        .onChange(of: backgroundAlerts) { _, on in
                            if on { Notifications.requestPermission() }
                        }
                } header: {
                    Text("Privacy & alerts")
                } footer: {
                    Text("Approval requests always show inside the app. iOS keeps the connection alive briefly after you switch apps, so alerts arriving in that window can still notify you.")
                }

                Section("About") {
                    LabeledContent("App version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "–")
                    Text("Runs Claude Code and OpenCode on your PC and lets you steer them, approve their actions, and use your Windows apps, windows, files and clipboard from your phone.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $pairing) { PairingSheet() }
            .confirmationDialog(
                "Remove \(confirmRemove?.name ?? "PC")?",
                isPresented: Binding(get: { confirmRemove != nil }, set: { if !$0 { confirmRemove = nil } }),
                titleVisibility: .visible
            ) {
                Button("Remove", role: .destructive) {
                    if let pc = confirmRemove { model.removePC(pc.id) }
                }
            }
        }
    }
}
