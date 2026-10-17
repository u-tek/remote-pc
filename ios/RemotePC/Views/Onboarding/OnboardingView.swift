import AVFoundation
import SwiftUI

struct OnboardingView: View {
    @State private var pairing = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 10) {
                    Image(systemName: "laptopcomputer.and.iphone")
                        .font(.system(size: 54))
                        .foregroundStyle(.tint)
                    Text("Your PC, in your pocket")
                        .font(.largeTitle.bold())
                    Text("Drive Claude Code and OpenCode, approve what they do, and use your Windows apps, files and clipboard from your iPhone.")
                        .foregroundStyle(.secondary)
                }
                VStack(alignment: .leading, spacing: 18) {
                    step(1, "Install Tailscale", "Install it on your PC and your iPhone and sign in to the same account. That gives you a private connection that also works away from home.")
                    step(2, "Start the agent on your PC", "Install Node.js, then in the agent folder run:\nnpm install\nnpm run build\nnpm start")
                    step(3, "Scan the QR code", "The agent shows a QR code in its window. Scan it here, or with the iPhone Camera app.")
                }
                Button {
                    pairing = true
                } label: {
                    Label("Pair with my PC", systemImage: "qrcode.viewfinder")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
            .padding(24)
        }
        .sheet(isPresented: $pairing) { PairingSheet() }
    }

    private func step(_ n: Int, _ title: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Text("\(n)")
                .font(.headline)
                .frame(width: 32, height: 32)
                .background(Color.accentColor.opacity(0.15), in: Circle())
                .foregroundStyle(.tint)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(text).font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }
}

/// Pair by scanning the agent's QR code, or by typing the details in.
struct PairingSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var manual = false
    @State private var name = ""
    @State private var host = ""
    @State private var port = "8787"
    @State private var token = ""
    @State private var testing = false
    @State private var error: String?
    @State private var scanned = false

    var body: some View {
        NavigationStack {
            Group {
                if manual {
                    Form {
                        Section {
                            TextField("Name (e.g. Gaming PC)", text: $name)
                            TextField("PC address, e.g. desk.tail1234.ts.net", text: $host)
                                .keyboardType(.URL)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                            TextField("Port", text: $port).keyboardType(.numberPad)
                            TextField("Token", text: $token)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .font(.body.monospaced())
                        } footer: {
                            Text("The PC's Connect your iPhone page (Start menu → Remote PC) shows these details. A ….ts.net address connects over HTTPS. Tip: paste a whole remotepc:// link into the Token field.")
                        }
                        if let error {
                            Section { Text(error).foregroundStyle(.red).font(.footnote) }
                        }
                        Section {
                            Button {
                                Task { await connectManually() }
                            } label: {
                                if testing { ProgressView() } else { Text("Connect") }
                            }
                            .disabled(host.isEmpty || token.isEmpty || testing)
                        }
                    }
                } else {
                    ZStack(alignment: .bottom) {
                        QRScannerView { code in
                            guard !scanned else { return }
                            if let link = PairingLink(string: code) {
                                scanned = true
                                Haptics.success()
                                model.addPC(name: link.name, host: link.host, port: link.port, token: link.token, secure: link.secure)
                                dismiss()
                            } else {
                                error = "That QR code is not a Remote PC pairing code."
                            }
                        }
                        .ignoresSafeArea()
                        VStack(spacing: 8) {
                            if let error {
                                Text(error).font(.footnote).padding(8).background(.thinMaterial, in: Capsule())
                            }
                            Text("Point the camera at the QR code shown by the agent on your PC.")
                                .font(.footnote)
                                .multilineTextAlignment(.center)
                                .padding(12)
                                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
                        }
                        .padding()
                    }
                }
            }
            .navigationTitle(manual ? "Enter details" : "Scan QR code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button(manual ? "Scan instead" : "Type instead") {
                        error = nil
                        manual.toggle()
                    }
                }
            }
        }
    }

    private func connectManually() async {
        if let link = PairingLink(string: token) {
            model.addPC(name: link.name, host: link.host, port: link.port, token: link.token, secure: link.secure)
            dismiss()
            return
        }
        testing = true
        defer { testing = false }
        let portNumber = Int(port) ?? 8787
        let cleanHost = host.trimmingCharacters(in: .whitespaces)
        // The PC's Tailscale HTTPS name (pc.tailnet.ts.net) means HTTPS.
        let secure = cleanHost.lowercased().hasSuffix(".ts.net")
        let client = APIClient(host: cleanHost, port: portNumber, token: token.trimmingCharacters(in: .whitespacesAndNewlines), secure: secure)
        do {
            let info = try await client.get("/api/info", as: AgentInfo.self)
            model.addPC(name: name.isEmpty ? info.name : name, host: cleanHost, port: portNumber, token: token, secure: secure)
            dismiss()
        } catch {
            self.error = "Could not reach the agent: \(error.localizedDescription)"
        }
    }
}

/// Camera view that reports the first QR code it sees.
struct QRScannerView: UIViewControllerRepresentable {
    var onCode: (String) -> Void

    func makeUIViewController(context: Context) -> ScannerController {
        let controller = ScannerController()
        controller.onCode = onCode
        return controller
    }

    func updateUIViewController(_ controller: ScannerController, context: Context) {
        controller.onCode = onCode
    }

    final class ScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
        var onCode: ((String) -> Void)?
        private let session = AVCaptureSession()
        private var preview: AVCaptureVideoPreviewLayer?
        private let message = UILabel()

        override func viewDidLoad() {
            super.viewDidLoad()
            view.backgroundColor = .black
            message.textColor = .white
            message.numberOfLines = 0
            message.textAlignment = .center
            message.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(message)
            NSLayoutConstraint.activate([
                message.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                message.centerYAnchor.constraint(equalTo: view.centerYAnchor),
                message.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
                message.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
            ])
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    if granted {
                        self.configure()
                    } else {
                        self.message.text = "Camera access is off. Allow it in Settings › Remote PC, or tap \"Type instead\"."
                    }
                }
            }
        }

        private func configure() {
            guard let device = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device),
                  session.canAddInput(input) else {
                message.text = "No camera available. Tap \"Type instead\"."
                return
            }
            session.addInput(input)
            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else { return }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]
            let layer = AVCaptureVideoPreviewLayer(session: session)
            layer.videoGravity = .resizeAspectFill
            layer.frame = view.bounds
            view.layer.insertSublayer(layer, at: 0)
            preview = layer
            let session = self.session
            DispatchQueue.global(qos: .userInitiated).async { session.startRunning() }
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            preview?.frame = view.bounds
        }

        override func viewWillDisappear(_ animated: Bool) {
            super.viewWillDisappear(animated)
            let session = self.session
            DispatchQueue.global(qos: .userInitiated).async { session.stopRunning() }
        }

        func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
            guard let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
                  let value = object.stringValue else { return }
            onCode?(value)
        }
    }
}
