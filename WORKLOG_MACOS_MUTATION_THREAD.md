# macOS Desktop mutation thread ownership

An in-process Desktop focus request targeting the Electron owner crashed on its Node worker. Self-process AX window setters entered AppKit directly, reaching NSWindow.deminaturize off the main thread. Host-window discovery remains correct and must not be removed to suppress this defect.

A small compile-mode boundary now dispatches only AppKit and AX mutation closures to the main queue in addon builds, with direct execution when already on main. Standalone semantics remain unchanged. All native setters and actions, including semantic control actions and focus activation, use that boundary. Exact window/snapshot identity, permission checks and foreground proof are preserved. Capture semaphores, traversal and focus polling are deliberately not moved onto the main queue.

Verification performed before source seal:
- Documented focused Vitest invocation: 25 tests passed across macos-mutation-thread, macos-desktop-hardening and macos-window-matching.
- New regression failed before implementation on the missing thread boundary.
- `node scripts/verify-macos-mutation-thread.mjs --addon`: five real Swift assertions passed, including worker-to-main execution, already-main calls, nested dispatch and thrown-error propagation.
- `node scripts/verify-macos-mutation-thread.mjs`: five assertions passed, including standalone worker preservation.
- Full native Swift addon typecheck passed. Parenthesized closures avoid new parser warnings.

The unconditional source regression runs on all platforms. The explicit native verifier is a macOS acceptance entry point, with no conditional test suppression. Full source, packaging and installed-runtime acceptance are recorded separately by the update round and are not claimed by these focused checks.
