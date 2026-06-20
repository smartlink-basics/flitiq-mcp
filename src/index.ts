#!/usr/bin/env node
/**
 * FlitIQ MCP server -- stdio transport.
 *
 * Claude Desktop launches this as a subprocess when a user installs the
 * .mcpb. The plaintext FlitIQ API key is passed via the FLITIQ_API_KEY
 * env var (configured by the user once at install time). That is the
 * ONLY env var this binary reads. No Supabase service-role key, no VPS
 * token, no database URL -- all of that is server-side behind
 * /api/mcp/* on flitiq.com, where the API key is validated, the Pro
 * tier is enforced, and the 60/min rate limit is counted.
 *
 * Per the Anthropic MCP directory review, distributing a server-role
 * Supabase key inside a user-installed binary would have bypassed RLS
 * and given every Pro subscriber full database access -- so the entire
 * data layer was moved server-side in v0.1.3.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { readApiKeyFromEnv, type AuthContext } from "./lib/auth.js";
import { McpError } from "./lib/errors.js";
import { TOOLS, findTool } from "./tools.js";

const SERVER_NAME = "flitiq";
const SERVER_VERSION = "0.1.4";

// Cache the resolved auth context for the lifetime of the process. Claude
// launches one MCP subprocess per session, so we resolve once and reuse.
//
// We cache *definite* failures (bad/missing key, expired Pro subscription)
// permanently so we don't spam the server with retries. Anything else --
// a transient network blip, a 5xx, a generic Error -- clears the cached
// context so the next tool call can retry. Without this, a single network
// hiccup at startup would lock the session into an error state until the
// user restarts Claude. (Per Anthropic MCP directory review.)
const TERMINAL_AUTH_CODES = new Set(["UNAUTHENTICATED", "FORBIDDEN_NOT_PRO"]);

let authPromise: Promise<AuthContext> | null = null;
let authError: McpError | null = null;

async function getAuth(): Promise<AuthContext> {
  if (authError) throw authError;
  if (!authPromise) {
    authPromise = Promise.resolve().then(readApiKeyFromEnv).catch((err) => {
      if (err instanceof McpError && TERMINAL_AUTH_CODES.has(err.code)) {
        authError = err;
      } else {
        authPromise = null;
      }
      throw err;
    });
  }
  return authPromise;
}

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
    })),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const tool = findTool(name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const ctx = await getAuth();
    const result = await tool.handler(args ?? {}, ctx);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const friendly =
      err instanceof McpError
        ? `[${err.code}] ${err.message}`
        : err instanceof Error
        ? err.message
        : String(err);
    return {
      content: [{ type: "text", text: friendly }],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr -- visible to the user when running via Claude Desktop's logs
  console.error(`[flitiq-mcp] v${SERVER_VERSION} ready on stdio`);
}

main().catch((err) => {
  console.error("[flitiq-mcp] fatal:", err);
  process.exit(1);
});
