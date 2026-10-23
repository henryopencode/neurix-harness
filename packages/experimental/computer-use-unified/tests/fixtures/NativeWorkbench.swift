import AppKit

final class ScrollDocument: NSView {
    override var isFlipped: Bool { true }
}

final class GestureSurface: NSView {
    var record: (() -> Void)?
    var clicks = 0, doubleClicks = 0, rightClicks = 0, moves = 0, drags = 0
    private var dragged = false
    override init(frame: NSRect) {
        super.init(frame: frame)
        setAccessibilityElement(true)
        setAccessibilityRole(.button)
        setAccessibilityLabel("Gesture surface")
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.activeAlways, .mouseMoved, .inVisibleRect], owner: self, userInfo: nil))
    }
    required init?(coder: NSCoder) { fatalError("GestureSurface requires a frame") }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.systemBlue.withAlphaComponent(0.15).setFill()
        dirtyRect.fill()
        ("Gesture surface: move, double-click, right-click, drag" as NSString)
            .draw(at: NSPoint(x: 8, y: 28), withAttributes: [.font: NSFont.systemFont(ofSize: 14)])
    }
    override func mouseMoved(with event: NSEvent) { moves += 1; record?() }
    override func mouseDown(with event: NSEvent) {
        clicks += 1
        if event.clickCount == 2 { doubleClicks += 1 }
        dragged = false; record?()
    }
    override func mouseDragged(with event: NSEvent) { dragged = true }
    override func mouseUp(with event: NSEvent) { if dragged { drags += 1 }; record?() }
    override func rightMouseDown(with event: NSEvent) { rightClicks += 1; record?() }
}

final class Workbench: NSObject, NSApplicationDelegate, NSTextFieldDelegate {
    var window: NSWindow!
    var field: NSTextField!
    var status: NSTextField!
    var scroll: NSScrollView!
    var gestures: GestureSurface!
    var menuCount = 0
    var scrollObserver: NSObjectProtocol?
    let destination = Bundle.main.object(forInfoDictionaryKey: "HarnessFixtureDestination") as! String

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 1060, height: 320), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Harness Native Workbench"
        window.acceptsMouseMovedEvents = true
        let content = window.contentView!
        let heading = NSTextField(labelWithString: "Harness Native Workbench")
        heading.font = .boldSystemFont(ofSize: 24)
        heading.frame = NSRect(x: 28, y: 250, width: 500, height: 40)
        content.addSubview(heading)
        field = NSTextField(frame: NSRect(x: 28, y: 180, width: 500, height: 36))
        field.setAccessibilityLabel("Task name")
        field.placeholderString = "Task name"
        field.delegate = self
        content.addSubview(field)
        let button = NSButton(title: "Save task", target: self, action: #selector(save))
        button.frame = NSRect(x: 28, y: 110, width: 150, height: 40)
        button.bezelStyle = .rounded
        content.addSubview(button)
        status = NSTextField(labelWithString: "Ready")
        status.frame = NSRect(x: 28, y: 40, width: 500, height: 40)
        content.addSubview(status)
        scroll = NSScrollView(frame: NSRect(x: 580, y: 110, width: 450, height: 170))
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = true
        scroll.setAccessibilityLabel("Scroll area")
        let document = ScrollDocument(frame: NSRect(x: 0, y: 0, width: 1400, height: 1400))
        let lines = NSTextField(labelWithString: (0..<60).map { "Scroll line \($0): " + String(repeating: "content ", count: 24) }.joined(separator: "\n"))
        lines.frame = NSRect(x: 0, y: 0, width: 1400, height: 1400)
        lines.maximumNumberOfLines = 0
        lines.setAccessibilityElement(false)
        document.addSubview(lines)
        scroll.documentView = document
        scroll.contentView.postsBoundsChangedNotifications = true
        scrollObserver = NotificationCenter.default.addObserver(forName: NSView.boundsDidChangeNotification,
            object: scroll.contentView, queue: .main) { [weak self] _ in self?.writeState() }
        content.addSubview(scroll)
        gestures = GestureSurface(frame: NSRect(x: 580, y: 20, width: 450, height: 75))
        gestures.record = { [weak self] in self?.writeState() }
        content.addSubview(gestures)
        let menu = NSMenu()
        let application = NSMenuItem()
        application.submenu = NSMenu(title: "Workbench")
        application.submenu?.addItem(NSMenuItem(title: "Quit Workbench", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        menu.addItem(application)
        let actions = NSMenuItem(title: "Actions", action: nil, keyEquivalent: "")
        actions.submenu = NSMenu(title: "Actions")
        let record = NSMenuItem(title: "Record action", action: #selector(recordMenu), keyEquivalent: "")
        record.target = self
        actions.submenu?.addItem(record)
        menu.addItem(actions)
        NSApplication.shared.mainMenu = menu
        window.orderBack(nil)
        window.makeFirstResponder(field)
        try! String(ProcessInfo.processInfo.processIdentifier).write(toFile: destination + ".pid", atomically: true, encoding: .utf8)
        writeState()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    @objc func save() {
        do {
            let data = try JSONSerialization.data(withJSONObject: ["title": field.stringValue])
            try data.write(to: URL(fileURLWithPath: destination), options: .atomic)
            status.stringValue = "Saved task: " + field.stringValue
            writeState()
        } catch {
            status.stringValue = "Save failed: " + error.localizedDescription
        }
    }

    func controlTextDidChange(_ notification: Notification) { writeState() }

    @objc func recordMenu() { menuCount += 1; writeState() }

    func writeState() {
        func area(_ view: NSView?) -> [String: CGFloat] {
            guard let view else { return [:] }
            let rect = window.convertToScreen(view.convert(view.bounds, to: nil))
            return ["x": rect.minX, "y": NSScreen.screens[0].frame.maxY - rect.maxY, "width": rect.width, "height": rect.height]
        }
        let values: [String: Any] = ["draft": field.stringValue, "menu": menuCount,
            "scrollX": scroll?.contentView.bounds.origin.x ?? 0, "scrollY": scroll?.contentView.bounds.origin.y ?? 0,
            "clicks": gestures?.clicks ?? 0, "doubleClicks": gestures?.doubleClicks ?? 0,
            "rightClicks": gestures?.rightClicks ?? 0, "moves": gestures?.moves ?? 0, "drags": gestures?.drags ?? 0,
            "areas": ["scroll": area(scroll), "gesture": area(gestures)]]
        try! JSONSerialization.data(withJSONObject: values).write(to: URL(fileURLWithPath: destination + ".state"), options: .atomic)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let workbench = Workbench()
app.delegate = workbench
app.run()
