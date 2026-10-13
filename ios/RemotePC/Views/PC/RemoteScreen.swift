import AVFoundation
import SwiftUI
import UIKit

enum TouchMode: String {
    /// Tap where you want to click, like a touchscreen.
    case touch
    /// The whole screen is a laptop trackpad.
    case trackpad
}

/// SwiftUI wrapper around the live picture and its gestures.
struct RemoteScreen: UIViewRepresentable {
    let client: StreamClient
    var mode: TouchMode
    var videoSize: CGSize
    var cursor: CGPoint?
    @Binding var keyboardVisible: Bool
    var zoomResetToken: Int

    func makeUIView(context: Context) -> RemoteScreenView {
        let view = RemoteScreenView(client: client)
        view.onKeyboardDismissed = { keyboardVisible = false }
        return view
    }

    func updateUIView(_ view: RemoteScreenView, context: Context) {
        view.mode = mode
        view.updateVideoSize(videoSize)
        view.setKeyboard(visible: keyboardVisible)
        if view.zoomResetToken != zoomResetToken {
            view.zoomResetToken = zoomResetToken
            view.resetZoom()
        }
        if mode == .trackpad { view.follow(cursor: cursor) }
    }

    static func dismantleUIView(_ view: RemoteScreenView, coordinator: ()) {
        view.stopMomentum()
    }
}

/// Shows the video and turns touches into mouse, scroll and keyboard input.
///
/// Touch mode: tap = click, double-tap = double-click, long-press = right-click,
/// drag = click-and-drag, two-finger drag = scroll (with momentum), pinch = zoom and pan.
/// Trackpad mode: drag = move the pointer, tap = click, two-finger tap = right-click,
/// press-and-hold then drag = drag, two-finger drag = scroll.
final class RemoteScreenView: UIView, UIGestureRecognizerDelegate, UITextFieldDelegate {
    let client: StreamClient
    var mode: TouchMode = .touch
    var zoomResetToken = 0
    var onKeyboardDismissed: (() -> Void)?

    private let content = UIView()
    private let keyboardField = KeyboardField(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
    private let keyBar = KeyBar()
    private var videoSize = CGSize(width: 16, height: 9)
    private var zoom: CGFloat = 1
    private var offset: CGPoint = .zero
    private var pinchStartZoom: CGFloat = 1
    private var lastPinchCenter: CGPoint = .zero
    private var pinchActive = false
    private var dragging = false
    private var lastHoldPoint: CGPoint = .zero
    private var scrollRemainder: CGPoint = .zero
    private var relRemainder: CGPoint = .zero
    private var momentum: CGPoint = .zero
    private var displayLink: CADisplayLink?
    private var modifiers: [String] = []
    private var dismissingKeyboard = false

    init(client: StreamClient) {
        self.client = client
        super.init(frame: .zero)
        backgroundColor = .black
        isMultipleTouchEnabled = true
        clipsToBounds = true
        addSubview(content)
        content.isUserInteractionEnabled = false
        content.layer.addSublayer(client.renderer.layer)

        keyboardField.delegate = self
        keyboardField.inputAccessoryView = keyBar
        keyboardField.onBackspace = { [weak self] in self?.sendKey("backspace") }
        keyboardField.onResign = { [weak self] in
            guard let self, !self.dismissingKeyboard else { return }
            self.onKeyboardDismissed?()
        }
        addSubview(keyboardField)
        keyBar.onKey = { [weak self] name in self?.sendKey(name) }
        keyBar.onModifier = { [weak self] name in self?.toggleModifier(name) }
        keyBar.onCombo = { [weak self] keys in self?.client.keys(keys) }
        keyBar.onHide = { [weak self] in
            self?.keyboardField.resignFirstResponder()
        }
        setupGestures()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        content.bounds = CGRect(origin: .zero, size: bounds.size)
        content.center = CGPoint(x: bounds.midX, y: bounds.midY)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        client.renderer.layer.frame = content.bounds
        CATransaction.commit()
        applyTransform()
    }

    override func willMove(toWindow newWindow: UIWindow?) {
        super.willMove(toWindow: newWindow)
        if newWindow == nil { stopMomentum() }
    }

    // MARK: Geometry

    func updateVideoSize(_ size: CGSize) {
        guard size.width > 0, size.height > 0, size != videoSize else { return }
        videoSize = size
        setNeedsLayout()
    }

    /// Where the picture sits inside the (unzoomed) content view.
    private var videoRect: CGRect {
        AVMakeRect(aspectRatio: videoSize, insideRect: content.bounds)
    }

    /// A point in this view → 0…1 position on the PC screen (nil if outside the picture).
    private func normalized(_ point: CGPoint) -> CGPoint? {
        let local = content.convert(point, from: self)
        let r = videoRect
        guard r.width > 0, r.height > 0 else { return nil }
        let x = (local.x - r.minX) / r.width
        let y = (local.y - r.minY) / r.height
        guard x >= -0.03, x <= 1.03, y >= -0.03, y <= 1.03 else { return nil }
        return CGPoint(x: min(max(x, 0), 1), y: min(max(y, 0), 1))
    }

    private func applyTransform() {
        let maxX = (bounds.width * zoom - bounds.width) / 2
        let maxY = (bounds.height * zoom - bounds.height) / 2
        offset.x = min(max(offset.x, -maxX), maxX)
        offset.y = min(max(offset.y, -maxY), maxY)
        content.transform = CGAffineTransform(translationX: offset.x, y: offset.y).scaledBy(x: zoom, y: zoom)
    }

    func resetZoom() {
        zoom = 1
        offset = .zero
        UIView.animate(withDuration: 0.25) { self.applyTransform() }
    }

    /// Keep the pointer on screen while zoomed in trackpad mode.
    func follow(cursor: CGPoint?) {
        guard let cursor, zoom > 1.01 else { return }
        let r = videoRect
        let inContent = CGPoint(x: r.minX + cursor.x * r.width, y: r.minY + cursor.y * r.height)
        let p = content.convert(inContent, to: self)
        let margin: CGFloat = 60
        var dx: CGFloat = 0
        var dy: CGFloat = 0
        if p.x < margin { dx = margin - p.x } else if p.x > bounds.width - margin { dx = bounds.width - margin - p.x }
        if p.y < margin { dy = margin - p.y } else if p.y > bounds.height - margin { dy = bounds.height - margin - p.y }
        guard dx != 0 || dy != 0 else { return }
        offset.x += dx
        offset.y += dy
        applyTransform()
    }

    // MARK: Gestures

    private func setupGestures() {
        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        let twoFingerTap = UITapGestureRecognizer(target: self, action: #selector(handleTwoFingerTap(_:)))
        twoFingerTap.numberOfTouchesRequired = 2
        let hold = UILongPressGestureRecognizer(target: self, action: #selector(handleHold(_:)))
        hold.minimumPressDuration = 0.4
        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
        pan.maximumNumberOfTouches = 1
        let twoFingerPan = UIPanGestureRecognizer(target: self, action: #selector(handleTwoFingerPan(_:)))
        twoFingerPan.minimumNumberOfTouches = 2
        twoFingerPan.maximumNumberOfTouches = 2
        twoFingerPan.delegate = self
        let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
        pinch.delegate = self
        tap.require(toFail: hold)
        for g in [tap, twoFingerTap, hold, pan, twoFingerPan, pinch] as [UIGestureRecognizer] {
            addGestureRecognizer(g)
        }
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        (g is UIPinchGestureRecognizer && other is UIPanGestureRecognizer) || (g is UIPanGestureRecognizer && other is UIPinchGestureRecognizer)
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        super.touchesBegan(touches, with: event)
        stopMomentum()
    }

    private func tick(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light) {
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }

    private func pointMessage(_ type: String, _ point: CGPoint?, button: String = "left") -> [String: Any] {
        var m: [String: Any] = ["t": type, "b": button]
        if let point {
            m["x"] = Double(point.x)
            m["y"] = Double(point.y)
        }
        return m
    }

    @objc private func handleTap(_ g: UITapGestureRecognizer) {
        if mode == .trackpad {
            client.send(pointMessage("click", nil))
        } else {
            guard let p = normalized(g.location(in: self)) else { return }
            client.send(pointMessage("click", p))
        }
        tick()
    }

    @objc private func handleTwoFingerTap(_ g: UITapGestureRecognizer) {
        let p = mode == .trackpad ? nil : normalized(g.location(in: self))
        client.send(pointMessage("click", p, button: "right"))
        tick(.medium)
    }

    @objc private func handleHold(_ g: UILongPressGestureRecognizer) {
        let point = g.location(in: self)
        switch mode {
        case .touch:
            if g.state == .began, let p = normalized(point) {
                client.send(pointMessage("click", p, button: "right"))
                tick(.medium)
            }
        case .trackpad:
            switch g.state {
            case .began:
                lastHoldPoint = point
                client.send(pointMessage("down", nil))
                tick(.medium)
            case .changed:
                moveRelative(by: CGPoint(x: point.x - lastHoldPoint.x, y: point.y - lastHoldPoint.y), velocity: .zero)
                lastHoldPoint = point
            case .ended, .cancelled, .failed:
                client.send(pointMessage("up", nil))
            default:
                break
            }
        }
    }

    @objc private func handlePan(_ g: UIPanGestureRecognizer) {
        let point = g.location(in: self)
        switch mode {
        case .touch:
            switch g.state {
            case .began:
                let t = g.translation(in: self)
                if let start = normalized(CGPoint(x: point.x - t.x, y: point.y - t.y)) {
                    client.send(pointMessage("down", start))
                    dragging = true
                }
                if dragging, let p = normalized(point) { client.send(["t": "move", "x": Double(p.x), "y": Double(p.y)]) }
            case .changed:
                if dragging, let p = normalized(point) { client.send(["t": "move", "x": Double(p.x), "y": Double(p.y)]) }
            case .ended, .cancelled, .failed:
                if dragging {
                    client.send(pointMessage("up", normalized(point)))
                    dragging = false
                }
            default:
                break
            }
        case .trackpad:
            let t = g.translation(in: self)
            g.setTranslation(.zero, in: self)
            moveRelative(by: t, velocity: g.velocity(in: self))
        }
    }

    /// Trackpad pointer movement with acceleration, in PC pixels.
    private func moveRelative(by t: CGPoint, velocity: CGPoint) {
        let r = videoRect
        guard r.width > 0 else { return }
        let pixelsPerPoint = client.regionSize.width / (r.width * zoom)
        let speed = hypot(velocity.x, velocity.y)
        let accel = 1.2 + min(2.5, speed / 1000)
        relRemainder.x += t.x * pixelsPerPoint * accel
        relRemainder.y += t.y * pixelsPerPoint * accel
        let dx = Int(relRemainder.x)
        let dy = Int(relRemainder.y)
        guard dx != 0 || dy != 0 else { return }
        relRemainder.x -= CGFloat(dx)
        relRemainder.y -= CGFloat(dy)
        client.send(["t": "rel", "dx": dx, "dy": dy])
    }

    @objc private func handleTwoFingerPan(_ g: UIPanGestureRecognizer) {
        if pinchActive {
            g.setTranslation(.zero, in: self)
            return
        }
        let t = g.translation(in: self)
        g.setTranslation(.zero, in: self)
        addScroll(t)
        if g.state == .ended {
            startMomentum(g.velocity(in: self))
        } else if g.state == .cancelled || g.state == .failed {
            scrollRemainder = .zero
        }
    }

    /// Natural scrolling: content follows the fingers. 120 wheel units = one notch.
    private func addScroll(_ t: CGPoint) {
        scrollRemainder.x += -t.x * 3
        scrollRemainder.y += t.y * 3
        let dx = Int(scrollRemainder.x)
        let dy = Int(scrollRemainder.y)
        guard dx != 0 || dy != 0 else { return }
        scrollRemainder.x -= CGFloat(dx)
        scrollRemainder.y -= CGFloat(dy)
        client.send(["t": "scroll", "dx": dx, "dy": dy])
    }

    private func startMomentum(_ velocity: CGPoint) {
        stopMomentum()
        guard hypot(velocity.x, velocity.y) > 250 else { return }
        momentum = velocity
        let link = CADisplayLink(target: self, selector: #selector(stepMomentum(_:)))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    @objc private func stepMomentum(_ link: CADisplayLink) {
        let dt = CGFloat(max(1.0 / 120, min(1.0 / 30, link.targetTimestamp - link.timestamp)))
        momentum.x *= 0.94
        momentum.y *= 0.94
        addScroll(CGPoint(x: momentum.x * dt, y: momentum.y * dt))
        if hypot(momentum.x, momentum.y) < 60 { stopMomentum() }
    }

    func stopMomentum() {
        displayLink?.invalidate()
        displayLink = nil
        momentum = .zero
    }

    @objc private func handlePinch(_ g: UIPinchGestureRecognizer) {
        let center = g.location(in: self)
        switch g.state {
        case .began:
            pinchActive = true
            pinchStartZoom = zoom
            lastPinchCenter = center
        case .changed:
            let newZoom = min(max(pinchStartZoom * g.scale, 1), 6)
            let ratio = newZoom / zoom
            let c = CGPoint(x: center.x - bounds.midX, y: center.y - bounds.midY)
            let old = CGPoint(x: lastPinchCenter.x - bounds.midX, y: lastPinchCenter.y - bounds.midY)
            // Keep the spot under your fingers in place while zooming and panning.
            offset = CGPoint(x: c.x - ratio * (old.x - offset.x), y: c.y - ratio * (old.y - offset.y))
            zoom = newZoom
            lastPinchCenter = center
            applyTransform()
        case .ended, .cancelled, .failed:
            pinchActive = false
            if zoom < 1.05 { resetZoom() }
        default:
            break
        }
    }

    // MARK: Keyboard

    func setKeyboard(visible: Bool) {
        if visible && !keyboardField.isFirstResponder {
            keyboardField.becomeFirstResponder()
        } else if !visible && keyboardField.isFirstResponder {
            dismissingKeyboard = true
            keyboardField.resignFirstResponder()
            dismissingKeyboard = false
        }
    }

    private func toggleModifier(_ name: String) {
        if let i = modifiers.firstIndex(of: name) {
            modifiers.remove(at: i)
        } else {
            modifiers.append(name)
        }
        keyBar.update(modifiers: modifiers)
    }

    private func sendKey(_ name: String) {
        let order = ["ctrl", "alt", "shift", "win"]
        let mods = order.filter { modifiers.contains($0) }
        client.keys(mods + [name])
        if !modifiers.isEmpty {
            modifiers.removeAll()
            keyBar.update(modifiers: modifiers)
        }
    }

    func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
        guard !string.isEmpty else { return false }
        if !modifiers.isEmpty, string.count == 1, let ch = string.lowercased().first, ch.isASCII, ch.isLetter || ch.isNumber {
            sendKey(String(ch))
        } else {
            client.type(string)
        }
        return false
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        sendKey("enter")
        return false
    }
}
