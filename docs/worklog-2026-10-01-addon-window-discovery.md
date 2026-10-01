# macOS in-process Desktop window discovery

## Reproduction and root cause

The real packaged Desktop `observe` operation could not discover the application's own window despite granted Screen Recording and Accessibility access and an AX-visible app window. `allWindowRows` unconditionally excluded `getpid()`. That exclusion described a standalone helper, but the production Swift backend runs inside the Electron process through the N-API addon.

## Correction

`isDesktopWindowProcess` now distinguishes the two compile modes. The addon keeps its real Electron-owner windows discoverable. The standalone helper continues excluding itself. Both reject nonpositive process identities. Existing AX/WindowServer identity agreement, focus, pointer, frame, geometry and permission enforcement are unchanged.

## Verification so far

The new source-contract regression failed before the correction, with 22 existing checks passing. The corrected nearest suites pass 24 tests. The executable Swift probe runs the real production predicate and window matching functions in both standalone and addon modes, checking self/other/invalid PIDs alongside contradictory and missing AX identities. The existing Swift-availability condition is retained, not expanded.

Full repository verification, packaging and live installed acceptance are required before calling this an activated fix.
