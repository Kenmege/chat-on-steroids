import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const source = readFileSync('native/macos-desktop-helper/main.swift', 'utf8');
const start = source.indexOf('private func frontmostPID(');
const end = source.indexOf('\n}', start);
if (start < 0 || end < 0) throw new Error('Missing production foreground function');
const fixture = readFileSync('test/fixtures/macos-foreground.swift', 'utf8');
const program = fixture.replace('// PRODUCTION_FUNCTION', () => source.slice(start, end + 2));
const directory = mkdtempSync(path.join(tmpdir(), 'cos-foreground-'));
try {
  const probe = path.join(directory, 'probe.swift');
  writeFileSync(probe, program);
  process.stdout.write(execFileSync('swift', [probe], { encoding: 'utf8', timeout: 20_000 }));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
