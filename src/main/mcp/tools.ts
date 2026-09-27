/**
 * Builds the MCP server for one surface.
 *
 * There is no "the" tool list any more. Each connector is its own server with its own
 * `tools/list`, because that list is the unit ChatGPT discovers: a no-query discovery pull
 * returns everything one server advertises, so the only real way to bound what a
 * conversation can be handed is to publish less per server (`docs/tool-surface.md` §6.4).
 *
 * The invariant this file enforces is that the boundary is *real*. A server registers the
 * tools its surface names and nothing else, so a Core server has no handler for `computer`
 * and answers a call for it with an unknown-tool error from the protocol layer itself.
 * There is no hidden acceptance of names a server did not advertise, and there is no
 * merged list — those would both be ways of claiming a separation the product does not have.
 */

import { McpServer, ResourceNotFoundError } from '@modelcontextprotocol/server';
import { toolSchemaJson } from './tool-declarations.js';
import type { PluginToolSchema } from '../../shared/plugin-refresh.js';
import { createRegistrar, type ToolContext } from './kernel.js';
import { registerCoreTools } from './tools-core.js';
import { registerDesktopTools } from './tools-desktop.js';
import { registerPluginTools } from './tools-plugins.js';
import { registerCodeMode } from './code-mode-tool.js';
import { surfaceDefinition, type SurfaceId } from './surfaces.js';
import { serverInstructions } from './instructions.js';
import { APP_VERSION } from './../version.js';
import { toVirtualPath } from '../sandbox.js';
import { logWarn } from '../logger.js';
import { withManagedSkills } from '../skill-access.js';

/**
 * In-band discovery handlers every surface must expose.
 *
 * OpenAI's MCP-Apps client probes `resources/read` for a conventional
 * `ui://<server>/config-editor` resource during connector creation. The SDK
 * answers a method with no registered handler at a pre-handler gate and maps
 * the miss to HTTP 404, which the validator treats as fatal. Declaring the
 * `resources`/`prompts` capabilities and answering in-band keeps the whole
 * probe sequence on HTTP 200: an honest minimal page for `ui://` URIs (this
 * connector exposes no configuration page), and a real not-found error —
 * never an invented success payload — for anything else.
 */
const NO_CONFIG_UI_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><title>No configuration UI</title></head>' +
  '<body><h1>No configuration UI</h1>' +
  '<p>This connector exposes no configuration page. Its tools are ready to use.</p></body></html>';

function registerDiscoveryHandlers(server: McpServer): void {
  server.server.setRequestHandler('resources/list', async () => ({ resources: [] }));
  server.server.setRequestHandler('resources/read', async (request) => {
    const uri = (request.params as { uri?: unknown } | undefined)?.uri;
    if (typeof uri === 'string' && uri.startsWith('ui://')) {
      return {
        contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: NO_CONFIG_UI_PAGE }]
      };
    }
    throw new ResourceNotFoundError(String(uri ?? ''));
  });
  server.server.setRequestHandler('prompts/list', async () => ({ prompts: [] }));
}

export function buildServer(ctx: ToolContext, surface: SurfaceId, observe?: (connectorName: string, version: string, instructions: string, tools: PluginToolSchema[]) => void, liveContext: () => ToolContext = () => ctx): McpServer {
  if (surface === 'core') ctx = withManagedSkills(ctx);
  const definition = surfaceDefinition(surface);
  const instructions = serverInstructions(ctx, surface);
  const server = new McpServer(
    { name: definition.serverName, version: APP_VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions }
  );

  const tools: PluginToolSchema[] = [];
  if (surface === 'plugins') {
    const declarations = registerPluginTools(server);
    registerDiscoveryHandlers(server);
    observe?.(definition.connectorName, APP_VERSION, instructions, declarations);
    return server;
  }
  const registrar = createRegistrar(server, ctx, surface, observe ? (name, config) => {
    // Match the SDK's Standard Schema conversion target and object-root normalization.
    const schema = toolSchemaJson(config.inputSchema);
    tools.push({ name, description: config.description, inputSchema: { type: 'object', ...schema }, ...(config.annotations ? { annotations: { ...config.annotations } } : {}) });
  } : undefined);
  if (surface === 'core') registerCoreTools(registrar);
  else registerDesktopTools(registrar);
  registerCodeMode(registrar, (name, args, parent) => {
    // Reuse the same registration/validation/handler authority, refreshed for every child
    // so a permission or approved-root change during an awaited script takes effect.
    const live = liveContext();
    const nested = createRegistrar(null, surface === 'core' ? withManagedSkills(live) : live, surface);
    if (surface === 'core') registerCoreTools(nested);
    else registerDesktopTools(nested);
    return nested.invokeNested(name, args, parent);
  }, { windowsDesktop: surface === 'desktop' && process.platform === 'win32' });

  // Cheap self-check on a property the tests assert and the design depends on: a surface
  // may register fewer tools than it declares — permissions decide that — but it may never
  // register one it does not declare. Logged rather than thrown, because refusing to serve
  // would turn a naming slip into a dead connector for the user.
  const declared = new Set(definition.tools);
  for (const name of registrar.registered()) {
    if (!declared.has(name)) {
      logWarn(`MCP surface ${surface} registered "${name}", which it does not declare — check surfaces.ts`);
    }
  }

  observe?.(definition.connectorName, APP_VERSION, instructions, tools);
  registerDiscoveryHandlers(server);
  return server;
}

export { toVirtualPath };
export type { ToolContext };
export { chunkText, lastToolCallAt, resetToolClock, transportIdentityStatus } from './kernel.js';
