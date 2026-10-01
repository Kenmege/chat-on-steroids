import { execFileSync, spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

const swiftAvailable = spawnSync('swift', ['--version'], { timeout: 5_000, windowsHide: true }).status === 0;

it.skipIf(!swiftAvailable)('executes native window matching against contradictory and missing AX identities', () => {
  const output = execFileSync(process.execPath, ['scripts/verify-macos-window-matching.mjs'], {
    encoding: 'utf8', timeout: 25_000, windowsHide: true
  });
  expect(output.trim().split(/\r?\n/)).toHaveLength(10);
  expect(output).toContain('PASS: contradictory ID cannot borrow matching geometry');
  expect(output).toContain('PASS: standalone helper windows stay excluded');
  const addon = execFileSync(process.execPath, ['scripts/verify-macos-window-matching.mjs', '--addon'], {
    encoding: 'utf8', timeout: 25_000, windowsHide: true
  });
  expect(addon.trim().split(/\r?\n/)).toHaveLength(10);
  expect(addon).toContain('PASS: addon owner windows stay discoverable');
  expect(addon).toContain('PASS: zero process identity stays rejected');
  expect(addon).toContain('PASS: negative process identity stays rejected');
  expect(addon).toContain('PASS: contradictory ID cannot borrow matching geometry');
}, 30_000);
