# macOS foreground authority on native workers

Installed native focus activated the requested window but failed its foreground proof. A bounded live probe reproduced a failed system-wide AX focused-app query with healthy app-specific AXFrontmost and exact WindowServer ownership. Workspace remained notification-cached until its run loop delivered the change. Failed AX responses, including partial values, remain inadmissible.

The trusted failure path now selects one live WindowServer candidate and requires its app-specific AXFrontmost flag. It no longer relies on stale Workspace. Valid system-wide AX remains authoritative. Untrusted screen-only observation retains its distinct Workspace fallback, which grants no input permission. Exact focused window/control, pointer occlusion, capture-frame identity and stable focus polling are unchanged.

Run the portable structural regressions through `npm test -- --run test/macos-foreground.test.ts test/macos-desktop-hardening.test.ts`. On the native Mac lane additionally run `node scripts/verify-macos-foreground.mjs`: it extracts and executes the production Swift function against corroborated, stale, missing and contradictory authorities. Compiler absence is not a successful native probe. The new portable tests have no skip directive. The initial native probe failed on the stale-cache case, and the corrected probe passed its positive and negative assertions.

Synthetic native proof is not installed acceptance. Production changes also require the repository's literal `npm run verify`, complete macOS packaging and runtime/bundle smoke, followed by exact-window focus and independent native foreground readback in ChatGPT through the installed Desktop connector. No success may be inferred from activation acknowledgement alone.
