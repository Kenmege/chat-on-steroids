import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { defaultConfig, initConfigPath, saveConfig } from '../src/main/config.js';
import { buildEmergencyHandoffText } from '../src/main/session/recovery-handoff.js';
import { resumeBootstrapMatches, resumeBootstrapText } from '../src/main/session/handoff.js';
import {
  appendEvent,
  createSession,
  initSessionStore,
  resetSessionStoreForTests,
  sessionsRoot
} from '../src/main/session/store.js';
import { makeTempDir, removeTempDir } from './helpers.js';

let dir: string;

beforeAll(async () => {
  dir = await makeTempDir('clf-recovery-handoff-');
  initConfigPath(dir);
  await saveConfig(defaultConfig());
  await initSessionStore(dir);
});

beforeEach(async () => {
  await resetSessionStoreForTests();
  await fs.rm(sessionsRoot(), { recursive: true, force: true });
  await initSessionStore(dir);
});

afterAll(async () => {
  await resetSessionStoreForTests();
  await removeTempDir(dir);
});

describe('emergency compaction handoff', () => {
  it.runIf(Boolean(process.env.COS_RECOVERY_LEDGER))('renders a copied real durable ledger without mutating its owner', async () => {
    const source = process.env.COS_RECOVERY_LEDGER!;
    const meta = JSON.parse(await fs.readFile(path.join(source, 'meta.json'), 'utf8'));
    const id = path.basename(source);
    await fs.cp(source, path.join(sessionsRoot(), id), { recursive: true });
    const brief = await buildEmergencyHandoffText(id, {
      conversationId: meta.conversationId, failedTurnId: 'acceptance-ledger-read'
    });
    expect(brief).toContain(meta.conversationId);
    expect(brief).toContain('USER SPECIFICATION');
    expect(brief).toContain('VERIFIED TOOL EVIDENCE');
    expect(brief.length).toBeLessThanOrEqual(88_000);
    expect(resumeBootstrapText(brief)).toContain('reconstructed from the durable session ledger');
    expect(resumeBootstrapMatches(resumeBootstrapText(brief, 'recovery_0123456789abcdef'), brief)).toBe(true);
    if (process.env.COS_RECOVERY_REPORT) await fs.writeFile(process.env.COS_RECOVERY_REPORT, brief);
  });

  it('preserves user requirements and verified tool summaries without copying raw tool payloads', async () => {
    const summary = await createSession({ title: 'durable recovery', conversationId: 'recovery-chat' });
    await appendEvent(summary.id, {
      time: 1,
      source: 'extension',
      kind: 'user_message',
      messageId: 'u-1',
      turnId: 'turn-1',
      message: { text: 'Install TinyFlows and connect Codex, Hermes, and OpenClaw. Preserve every existing provider.', chars: 90, truncated: false }
    });
    await appendEvent(summary.id, {
      time: 2,
      source: 'mcp',
      kind: 'tool_call',
      call: {
        callId: 'call-1',
        tool: 'exec_command',
        attribution: 'request_id',
        requestId: 'wfr-test',
        conversationId: 'recovery-chat',
        attributionMethod: 'request_id',
        args: { text: 'SECRET_RAW_ARGUMENT', chars: 19, truncated: false },
        result: { text: 'SECRET_RAW_RESULT', chars: 17, truncated: false },
        outcome: 'ok',
        durationMs: 42,
        summary: { kind: 'run', tone: 'good', title: 'Verified the agent mesh', detail: 'Codex, Hermes, and OpenClaw returned READY', metric: '✓ 42ms' },
        changes: [{ path: '/workspace/bin/example-worker', added: 18, removed: 2, approximate: false }]
      }
    });
    await appendEvent(summary.id, {
      time: 3,
      source: 'extension',
      kind: 'turn_end',
      turnId: 'turn-1',
      outcome: 'failed',
      reason: 'thinking_failed',
      detail: 'Thinking failed'
    });

    const brief = await buildEmergencyHandoffText(summary.id, {
      conversationId: 'recovery-chat',
      failedTurnId: 'turn-1'
    });

    expect(brief).toContain('TASK');
    expect(brief).toContain('Install TinyFlows and connect Codex, Hermes, and OpenClaw');
    expect(brief).toContain('Verified the agent mesh');
    expect(brief).toContain('/workspace/bin/example-worker');
    expect(brief).toContain('Thinking failed');
    expect(brief).toContain(summary.id);
    expect(brief).not.toContain('SECRET_RAW_ARGUMENT');
    expect(brief).not.toContain('SECRET_RAW_RESULT');
    const bootstrap = resumeBootstrapText(brief, 'recovery_0123456789abcdef');
    expect(bootstrap).toContain('reconstructed from the durable session ledger');
    expect(bootstrap).not.toContain('the previous chat wrote');
    expect(resumeBootstrapMatches(bootstrap, brief)).toBe(true);
    expect(resumeBootstrapMatches(bootstrap.replace('Thinking failed', 'succeeded'), brief)).toBe(false);
  });

  it('bounds a very large recording while retaining the first and latest user requirements', async () => {
    const summary = await createSession({ title: 'bounded recovery', conversationId: 'bounded-chat' });
    await appendEvent(summary.id, {
      time: 1,
      source: 'extension',
      kind: 'user_message',
      messageId: 'u-first',
      message: { text: `FIRST REQUIREMENT ${'a'.repeat(70_000)}`, chars: 70_018, truncated: false }
    });
    await appendEvent(summary.id, {
      time: 2,
      source: 'extension',
      kind: 'user_message',
      messageId: 'u-latest',
      message: { text: `LATEST CORRECTION ${'b'.repeat(70_000)}`, chars: 70_018, truncated: false }
    });

    const brief = await buildEmergencyHandoffText(summary.id, {
      conversationId: 'bounded-chat',
      failedTurnId: 'failed-large-turn'
    });

    expect(brief).toContain('FIRST REQUIREMENT');
    expect(brief).toContain('LATEST CORRECTION');
    expect(brief.length).toBeLessThanOrEqual(88_000);
  });
});
