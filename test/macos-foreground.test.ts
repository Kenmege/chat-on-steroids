import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const source = readFileSync('native/macos-desktop-helper/main.swift', 'utf8');
const start = source.indexOf('private func frontmostPID(');
const end = source.indexOf('\n}', start);
const proof = source.slice(start, end + 2);

it('requires live AX corroboration before accepting a WindowServer foreground candidate', () => {
  expect(proof).toContain('let rows = allWindowRows(includeMinimized: false)');
  expect(proof).toContain('let id = windowServerFrontWindowID(rows: rows)');
  expect(proof).toContain('let row = rows.first(where: { $0.id == id })');
  expect(proof).toContain('axBool(axApplication(row.pid), kAXFrontmostAttribute as CFString)');
  expect(proof).toMatch(/axBool\(axApplication\(row\.pid\)[\s\S]*else \{ return nil \}[\s\S]*return row\.pid/);
});

it('never consults notification-cached Workspace on the trusted AX failure path', () => {
  const trustedPath = proof.slice(proof.indexOf('if AXIsProcessTrusted()'), proof.lastIndexOf('return NSWorkspace'));
  expect(trustedPath).not.toContain('NSWorkspace');
  expect(trustedPath).toContain('pid > 0');
  expect(trustedPath).toContain('return row.pid');
  expect(proof).toContain('return NSWorkspace.shared.frontmostApplication?.processIdentifier');
});
