import Foundation
import ImageIO
import Vision
import ApplicationServices

if CommandLine.arguments.count > 2 && CommandLine.arguments[1] == "--window" {
    func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, name, &value) == .success ? value : nil
    }
    func labels(_ element: AXUIElement, depth: Int = 0) -> [String] {
        if depth > 8 { return [] }
        var values: [String] = []
        if attribute(element, kAXRoleAttribute as CFString) as? String == kAXStaticTextRole as String,
           let value = attribute(element, kAXValueAttribute as CFString) as? String { values.append(value) }
        for child in attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] ?? [] {
            values += labels(child, depth: depth + 1)
        }
        return values
    }
    let window = UInt32(CommandLine.arguments[2])!
    let info = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as! [[String: Any]]
    let owner = info.first { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == window }!
    let app = AXUIElementCreateApplication((owner[kCGWindowOwnerPID as String] as! NSNumber).int32Value)
    var values: [String] = []
    for element in attribute(app, kAXWindowsAttribute as CFString) as? [AXUIElement] ?? [] {
        if let value = attribute(element, kAXSizeAttribute as CFString) {
            var size = CGSize.zero
            if AXValueGetValue(value as! AXValue, .cgSize, &size) && abs(size.height - 58) < 0.5 { values += labels(element) }
        }
    }
    let data = try JSONSerialization.data(withJSONObject: values)
    print(String(data: data, encoding: .utf8)!)
    exit(0)
}

let url = URL(fileURLWithPath: CommandLine.arguments[1])
let source = CGImageSourceCreateWithURL(url as CFURL, nil)!
let image = CGImageSourceCreateImageAtIndex(source, 0, nil)!
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US", "zh-Hans"]
try VNImageRequestHandler(cgImage: image).perform([request])
let values = request.results?.compactMap { $0.topCandidates(1).first?.string } ?? []
let data = try JSONSerialization.data(withJSONObject: values)
print(String(data: data, encoding: .utf8)!)
