import Foundation
import CoreFoundation
typealias AXUIElement = Int32
typealias CGWindowID = UInt32
struct WindowRow { let id: CGWindowID; let pid: pid_t }
struct Application { let processIdentifier: pid_t }
final class NSWorkspace {
    static let shared = NSWorkspace()
    var frontmostApplication: Application? = Application(processIdentifier: 7)
}
let kAXFocusedApplicationAttribute = "AXFocusedApplication"
let kAXFrontmostAttribute = "AXFrontmost"
var trusted = true
var systemPID: pid_t? = nil
var rows = [WindowRow(id: 42, pid: 99)]
var frontID: CGWindowID? = 42
var frontmost: [pid_t: Bool] = [99: true]
func AXIsProcessTrusted() -> Bool { trusted }
func AXUIElementCreateSystemWide() -> AXUIElement { 0 }
func axElementAttribute(_ element: AXUIElement, _ key: CFString) -> AXUIElement? { systemPID }
func axPID(_ element: AXUIElement) -> pid_t? { element }
func axApplication(_ pid: pid_t) -> AXUIElement { pid }
func axAttribute(_ element: AXUIElement, _ key: CFString) -> AnyObject? { frontmost[element].map { NSNumber(value: $0) } }
// PRODUCTION_AX_BOOL
func allWindowRows(includeMinimized: Bool) -> [WindowRow] { rows }
func windowServerFrontWindowID(rows: [WindowRow]) -> CGWindowID? { frontID }
// PRODUCTION_FUNCTION
func check(_ expected: pid_t?, _ label: String) {
    guard frontmostPID() == expected else { fatalError("FAIL: \(label)") }
    print("PASS: \(label)")
}
check(99, "live WindowServer and AX replace stale Workspace")
frontmost = [:]
check(nil, "missing AX frontmost fails closed")
frontmost = [99: false]
check(nil, "false AX frontmost fails closed")
frontmost = [99: true]
frontID = nil
check(nil, "missing WindowServer identity fails closed")
frontID = 43
check(nil, "unknown WindowServer identity fails closed")
frontID = 42
systemPID = 88
check(88, "successful system AX keeps authority")
systemPID = 0
check(99, "invalid system PID requires live corroboration")
trusted = false
check(7, "screen-only Workspace fallback stays distinct")
