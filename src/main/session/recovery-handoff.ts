/**
 * Deterministic last-resort handoff for an oversized chat that also failed while writing its
 * own Compact & Resume brief.
 *
 * This is intentionally evidence-only. It reads the durable session ledger, never tool argument
 * or result bodies, and keeps the output beneath the ChatGPT bootstrap budget. The ordinary
 * source-authored handoff remains preferred; this exists only when that exact generation ended
 * with `Thinking failed` and therefore cannot be trusted to produce another answer.
 */

import { continuationMarkerOf, normalizedToolOutcome, type SessionEvent } from '../../shared/session.js';
import { userPromptText } from '../../shared/user-prompt.js';
import { getSession, readEvents } from './store.js';

const MAX_RECOVERY_HANDOFF_CHARS = 88_000;
const USER_SPEC_BUDGET = 48_000;
const ASSISTANT_BUDGET = 10_000;
const TOOL_BUDGET = 16_000;
const AGENT_BUDGET = 6_000;
const FAILURE_BUDGET = 5_000;
const FILE_BUDGET = 6_000;

export interface EmergencyHandoffInput {
  conversationId: string;
  failedTurnId: string;
}

function bounded(value: string, limit: number): string {
  const text = value.trim();
  if (text.length <= limit) return text;
  const marker = '\n[… middle omitted by the deterministic recovery budget …]\n';
  const room = Math.max(0, limit - marker.length);
  const head = Math.floor(room * 0.38);
  return text.slice(0, head) + marker + text.slice(text.length - (room - head));
}

function fitBlocks(blocks: readonly string[], limit: number, keepFirst = false): string {
  if (!blocks.length) return '';
  const selected: string[] = [];
  let remaining = limit;
  if (keepFirst) {
    const first = bounded(blocks[0]!, Math.min(10_000, remaining));
    selected.push(first);
    remaining -= first.length + 2;
  }
  const start = keepFirst ? 1 : 0;
  const tail: string[] = [];
  for (let index = blocks.length - 1; index >= start && remaining > 0; index--) {
    const candidate = bounded(blocks[index]!, Math.min(12_000, remaining));
    if (!candidate) continue;
    tail.unshift(candidate);
    remaining -= candidate.length + 2;
  }
  selected.push(...tail);
  return selected.join('\n\n');
}

function authoredUserText(event: Extract<SessionEvent, { kind: 'user_message' }>): string {
  const text = userPromptText(event.message.text) ?? event.authoredText ?? event.message.text;
  return continuationMarkerOf(text) ? '' : text.trim();
}

function eventLabel(event: SessionEvent): string {
  return `seq ${event.seq}${event.turnId ? ` · turn ${event.turnId}` : ''}`;
}

/** Build a bounded operational brief solely from already-durable, redacted session evidence. */
export async function buildEmergencyHandoffText(
  sessionId: string,
  input: EmergencyHandoffInput
): Promise<string> {
  const [summary, events] = await Promise.all([getSession(sessionId), readEvents(sessionId)]);
  if (!summary) throw new Error('That session no longer exists');
  if (summary.conversationId !== input.conversationId) throw new Error('The recovery source is no longer current');

  const users = events
    .filter((event): event is Extract<SessionEvent, { kind: 'user_message' }> => event.kind === 'user_message')
    .map((event) => ({ event, text: authoredUserText(event) }))
    .filter((item) => item.text);
  const latestUser = users.at(-1)?.text ?? 'Continue the unfinished work represented by this durable session.';
  const userBlocks = users.map(({ event, text }, index) =>
    `USER MESSAGE ${index + 1} (${eventLabel(event)})\n${text}${event.message.truncated ? '\n[The durable row was truncated; inspect its referenced session asset if exact omitted text is required.]' : ''}`);

  const assistants = events
    .filter((event): event is Extract<SessionEvent, { kind: 'assistant_message' }> =>
      event.kind === 'assistant_message' && event.final === true && event.message.text.trim().length > 0)
    .slice(-8)
    .map((event) => `ASSISTANT FINAL (${eventLabel(event)})\n${bounded(event.message.text, 4_000)}`);

  const latestCalls = new Map<string, Extract<SessionEvent, { kind: 'tool_call' }>>();
  for (const event of events) if (event.kind === 'tool_call') latestCalls.set(event.call.callId, event);
  const tools = [...latestCalls.values()]
    .sort((left, right) => left.seq - right.seq)
    .slice(-120)
    .map((event) => {
      const outcome = normalizedToolOutcome(event.call) ?? String(event.call.outcome);
      const detail = [event.call.summary.detail, event.call.summary.metric].filter(Boolean).join(' · ');
      return `- ${event.call.tool} [${outcome}] ${event.call.summary.title}${detail ? ` — ${detail}` : ''}`;
    });

  const fileTotals = new Map<string, { added: number; removed: number; approximate: boolean }>();
  for (const event of latestCalls.values()) {
    for (const change of event.call.changes ?? []) {
      const current = fileTotals.get(change.path) ?? { added: 0, removed: 0, approximate: false };
      current.added += change.added;
      current.removed += change.removed;
      current.approximate ||= change.approximate;
      fileTotals.set(change.path, current);
    }
  }
  const files = [...fileTotals.entries()].map(([file, change]) =>
    `- ${file} (+${change.added} −${change.removed}${change.approximate ? ', approximate' : ''})`);

  const agentMessages = events
    .filter((event): event is Extract<SessionEvent, { kind: 'agent_message' }> => event.kind === 'agent_message')
    .slice(-24)
    .map((event) => `- ${event.from} → ${event.to} [${event.delivery}]: ${bounded(event.message.text, 2_500)}`);

  const failures = events
    .filter((event) => event.kind === 'chat_error' || event.kind === 'turn_end' || event.kind === 'note')
    .slice(-30)
    .map((event) => {
      if (event.kind === 'chat_error') return `- ${eventLabel(event)}: ${event.message.text}`;
      if (event.kind === 'note') return `- ${eventLabel(event)}: ${event.message.text}`;
      return `- ${eventLabel(event)}: ${event.outcome}${event.reason ? ` (${event.reason})` : ''}${event.detail ? ` — ${event.detail}` : ''}`;
    });

  const model = summary.selectedModel?.conversationId === summary.conversationId
    ? `${summary.selectedModel.model}${summary.selectedModel.reasoningEffort ? ` / ${summary.selectedModel.reasoningEffort}` : ''}`
    : 'not durably observed for the current conversation';
  const sections = [
    'RECOVERY HANDOFF — reconstructed from the durable session ledger.',
    `TASK\n${bounded(latestUser, 8_000)}`,
    `USER SPECIFICATION\n${fitBlocks(userBlocks, USER_SPEC_BUDGET, true) || 'No authored user message was recoverable from the durable ledger.'}`,
    `CURRENT STATE\n- Emergency handoff reconstructed from the durable Chat On Steroids ledger because the source chat failed while writing its own handoff.\n- Session: ${sessionId}\n- Conversation: ${input.conversationId}\n- Failed turn: ${input.failedTurnId}\n- Selected model: ${model}\n- Recorded events: ${summary.events}\n- Estimated lifetime tokens: ${summary.estimatedTokens}\n- Current-frontend context tokens: ${summary.contextTokens}`,
    assistants.length ? `DONE / PRIOR ASSISTANT FINALS\n${fitBlocks(assistants, ASSISTANT_BUDGET)}` : '',
    tools.length ? `VERIFIED TOOL EVIDENCE\n${bounded(tools.join('\n'), TOOL_BUDGET)}` : '',
    agentMessages.length ? `AGENT MESSAGES\n${bounded(agentMessages.join('\n'), AGENT_BUDGET)}` : '',
    failures.length ? `FAILED / UNRESOLVED\n${bounded(failures.join('\n'), FAILURE_BUDGET)}` : '',
    files.length ? `FILES\n${bounded(files.join('\n'), FILE_BUDGET)}` : '',
    'NEXT\nContinue the unfinished task from the saved task plan appended to this handoff. Re-read live repository and process state before changing anything whose state may have advanced.',
    'DO NOT\n- Do not treat an assistant promise as proof of completion; use the verified tool evidence and live state.\n- Do not repeat completed external actions merely because this fallback omits raw tool payloads.\n- Do not reset, clean, overwrite, or discard unrelated working-tree changes.'
  ].filter(Boolean).join('\n\n');

  return bounded(sections, MAX_RECOVERY_HANDOFF_CHARS);
}
