import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const source = readFileSync('native/macos-desktop-helper/main.swift', 'utf8');
const start = source.indexOf('private func onDesktopMainThread<');
if (start < 0) throw new Error('Missing native AppKit mutation thread boundary');
const end = source.indexOf('\nprivate func ', start + 1);
const boundary = source.slice(start, end);
const directory = mkdtempSync(path.join(tmpdir(), 'cos-mutation-thread-'));
try {
  const probe = path.join(directory, 'probe.swift');
  writeFileSync(probe, `import Foundation
import Dispatch
${boundary}
enum ProbeFailure: Error { case expected }
func check(_ condition: Bool, _ label: String) {
    guard condition else { fatalError(label) }
    print("PASS: \\(label)")
}
check(onDesktopMainThread { Thread.isMainThread }, "main caller remains main")
let group = DispatchGroup()
group.enter()
Thread.detachNewThread {
    defer { group.leave() }
    check(!Thread.isMainThread, "probe starts on worker")
    #if COS_DESKTOP_ADDON
    check(onDesktopMainThread { Thread.isMainThread }, "addon mutation runs on main")
    #else
    check(onDesktopMainThread { !Thread.isMainThread }, "standalone caller remains worker")
    #endif
    check(onDesktopMainThread { onDesktopMainThread { true } }, "nested mutation does not deadlock")
    do {
        _ = try onDesktopMainThread { () throws -> Bool in throw ProbeFailure.expected }
        fatalError("mutation error lost")
    } catch ProbeFailure.expected {
        print("PASS: mutation error propagates")
    } catch { fatalError("wrong mutation error") }
}
let deadline = Date().addingTimeInterval(8)
while group.wait(timeout: .now()) != .success {
    guard Date() < deadline else { fatalError("mutation dispatch deadlocked") }
    RunLoop.main.run(until: Date().addingTimeInterval(0.01))
}
`);
  process.stdout.write(execFileSync('swift', [...(process.argv.includes('--addon') ? ['-D', 'COS_DESKTOP_ADDON'] : []), probe], {
    encoding: 'utf8', timeout: 20_000
  }));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
