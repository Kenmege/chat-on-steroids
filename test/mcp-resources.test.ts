/**
 * MCP discovery regression: `resources/read` must never surface as HTTP 404.
 *
 * OpenAI's MCP-Apps client probes a conventional `ui://<server>/config-editor`
 * resource during connector creation. With no `resources`/`prompts` handlers
 * registered, the SDK rejects the probe at a pre-handler gate and maps the miss
 * to HTTP 404, which the validator treats as fatal. The candidate declares both
 * capabilities and answers in-band: an honest minimal page for `ui://` URIs
 * (this connector exposes no configuration page), and a real not-found error —
 * never an invented success payload — for anything else.
 *
 * Positive: list/read on `ui://` return HTTP 200 with the honest payload.
 * Negative: read on an arbitrary unknown URI returns an in-band JSON-RPC error
 * over HTTP 200 — no HTTP 404 and no faked `contents`.
 */

import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/main/config.js';
import { startMcpServer, type McpEndpoint } from '../src/main/mcp/server.js';
import type { ToolContext } from '../src/main/mcp/tools.js';
import { initSessionStore } from '../src/main/session/store.js';
import { resetWorkspaces } from '../src/main/workspace.js';
import { DEFAULT_CAPABILITIES, type Capabilities, type Root } from '../src/shared/types.js';
import { makeTempDir, removeTempDir, writeTree } from './helpers.js';

void defaultConfig;

interface RawResponse {
  status: number;
  text: string;
}

function rawPost(urlStr: string, body: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  const url = new URL(urlStr);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'content-length': Buffer.byteLength(body),
          ...headers
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

function decode(res: RawResponse): any {
  const text = res.text.trim();
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  const datas = [...text.matchAll(/^data:\s*(.*)$/gm)].map((m) => m[1] ?? '');
  const last = datas.at(-1);
  if (last !== undefined) {
    try {
      return JSON.parse(last);
    } catch {
      return text;
    }
  }
  return text;
}

let nextId = 1;
let base: string;
let approved: string;
let endpoint: McpEndpoint;
let ctx: ToolContext;

function withCaps(overrides: Partial<Capabilities>): Capabilities {
  return { ...DEFAULT_CAPABILITIES, ...overrides };
}

async function call(
  surface: 'core' | 'desktop' | 'plugins',
  method: string,
  params: unknown = {}
): Promise<{ status: number; body: any }> {
  const res = await rawPost(endpoint.urls[surface], JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }));
  return { status: res.status, body: decode(res) };
}

const PROTOCOL_2026 = '2026-07-28';

async function modern(method: string, params: Record<string, unknown> = {}): Promise<{ status: number; body: any }> {
  const body = {
    jsonrpc: '2.0',
    id: nextId++,
    method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': PROTOCOL_2026,
        'io.modelcontextprotocol/clientCapabilities': {}
      }
    }
  };
  const headers: Record<string, string> = {
    'MCP-Protocol-Version': PROTOCOL_2026,
    'Mcp-Method': method
  };
  if (method === 'resources/read' && typeof params['uri'] === 'string') {
    headers['Mcp-Name'] = params['uri'];
  }
  const res = await rawPost(endpoint.urls.core, JSON.stringify(body), headers);
  return { status: res.status, body: decode(res) };
}

beforeAll(async () => {
  base = await makeTempDir('cos-mcp-resources-');
  initSessionStore(base);
  approved = `${base}/workspace`;
  await writeTree(approved, { 'notes.txt': 'hello\n' });
  ctx = {
    roots: [{ name: 'workspace', path: approved }] as Root[],
    caps: withCaps({}),
    readOnly: true,
    sessionTools: false,
    agentTools: false
  };
});

afterAll(async () => {
  if (endpoint) await endpoint.stop();
  await removeTempDir(base);
});

beforeEach(async () => {
  if (endpoint) await endpoint.stop();
  resetWorkspaces();
  ctx.caps = withCaps({});
  ctx.readOnly = true;
  ctx.roots = [{ name: 'workspace', path: approved }];
  ctx.sessionTools = false;
  ctx.agentTools = false;
  endpoint = await startMcpServer(() => ctx);
});

describe('mcp discovery (resources/prompts)', () => {
  it('lists empty resources and prompts on every surface', async () => {
    for (const surface of ['core', 'desktop', 'plugins'] as const) {
      const rl = await call(surface, 'resources/list', {});
      expect(rl.status, `${surface} resources/list http`).toBe(200);
      expect(rl.body?.result?.resources, `${surface} resources`).toEqual([]);
      const pl = await call(surface, 'prompts/list', {});
      expect(pl.status, `${surface} prompts/list http`).toBe(200);
      expect(pl.body?.result?.prompts, `${surface} prompts`).toEqual([]);
    }
  });

  it('answers the connector-creation ui:// probe in-band over HTTP 200', async () => {
    const uri = 'ui://desktop-commander/config-editor';
    for (const surface of ['core', 'plugins'] as const) {
      const reply = await call(surface, 'resources/read', { uri });
      expect(reply.status, `${surface} resources/read http`).toBe(200);
      expect(reply.body?.error, `${surface} no error`).toBeUndefined();
      const contents = reply.body?.result?.contents;
      expect(Array.isArray(contents), `${surface} contents array`).toBe(true);
      expect(contents[0]?.uri, `${surface} echo uri`).toBe(uri);
      expect(contents[0]?.mimeType, `${surface} mime`).toBe('text/html;profile=mcp-app');
      expect(String(contents[0]?.text ?? ''), `${surface} honest page`).toContain('No configuration UI');
    }
  });

  it('rejects an arbitrary unknown resource in-band, never 404 and never faked contents', async () => {
    const reply = await call('core', 'resources/read', { uri: 'bogus://definitely-not-a-resource' });
    expect(reply.status, 'http stays 200').toBe(200);
    expect(reply.body?.result, 'no invented result').toBeUndefined();
    expect(reply.body?.error, 'in-band error').toBeDefined();
    expect(reply.body?.error?.code, 'invalid-params code').toBe(-32602);
  });

  it('answers the ui:// probe in the 2026-07-28 envelope era too', async () => {
    const reply = await modern('resources/read', { uri: 'ui://desktop-commander/config-editor' });
    expect(reply.status, 'modern http').toBe(200);
    expect(reply.body?.error, 'modern no error').toBeUndefined();
    expect(reply.body?.result?.contents?.[0]?.uri, 'modern echo uri').toBe('ui://desktop-commander/config-editor');
  });
});
