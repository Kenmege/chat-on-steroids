import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const swift = readFileSync('native/macos-desktop-helper/main.swift', 'utf8');

it('routes native AppKit and AX mutations through the main-thread boundary without moving waits or capture', () => {
  expect(swift).toContain('private func onDesktopMainThread<T>');
  expect(swift).toMatch(/#if COS_DESKTOP_ADDON\s*if !Thread.isMainThread \{ return try DispatchQueue.main.sync\(execute: operation\) \}/);
  const focus = swift.slice(swift.indexOf('private func focusWindow'), swift.indexOf('private final class UISnapshot'));
  expect(focus).toMatch(/onDesktopMainThread \{[\s\S]*app.activate[\s\S]*AXUIElementPerformAction[\s\S]*\}\s*let deadline/);
  expect(focus).not.toContain('AXUIElementSetAttributeValue');
  expect(swift).toContain('onDesktopMainThread { AXUIElementSetAttributeValue(element, attribute, value) }');
  expect(swift).toContain('onDesktopMainThread({ AXUIElementSetAttributeValue(element, kAXValueAttribute');
  expect(swift).toContain('onDesktopMainThread({ AXUIElementPerformAction(element, kAXPressAction');
  const response = swift.slice(swift.indexOf('private func response(for'), swift.indexOf('private func writeResponse'));
  expect(response).not.toContain('onDesktopMainThread');
});
