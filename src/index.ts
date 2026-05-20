#!/usr/bin/env node
/**
 * FlitIQ MCP server — stdio transport.
 *
 * Claude Desktop launches this as a subprocess when a user adds the plugin to
 * their claude_desktop_config.json. The API key is passed via the FLITIQ_API_KEY
 * env var (configured by the user in their Claude config).
 *
 * On startup we:
 *   1. Validate the API key against Supabase (mcp_api_keys table)
 *   2. Confirm the user has a Pro or Team subscription
 *   3. Register the tool catalog and start serving over stdio
 *
 * If auth fails at startup, we still start the server but every tool call
 * returns an UNAUTHENTICATED error with instructions. This is friendlier
 * than crashing — the user sees the actual reason in Claude.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { authenticate, type AuthContext } from "./lib/auth.js";
import { McpError } from "./lib/errors.js";
import { TOOLS, findTool } from "./tools.js";

const SERVER_NAME = "flitiq";
const SERVER_VERSION = "0.1.0";

// Cache the resolved auth context for the lifetime of the process. Claude
// launches one MCP subprocess per session, so we resolve once and reuse.
// If resolution fails we cache the error and surface it on every tool call.
let authPromise: Promise<AuthContext> | null = null;
let authError: McpError | null = null;

async function getAuth(): Promise<AuthContext> {
  if (authError) throw authError;
  if (!authPromise) {
    authPromise = authenticate(process.env.FLITIQ_API_KEY).catch((err) => {
      if (err instanceof McpError) {
        authError = err;
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
  // stderr — visible to the user when running via Claude Desktop's logs
  console.error(`[flitiq-mcp] v${SERVER_VERSION} ready on stdio`);
}

main().catch((err) => {
  console.error("[flitiq-mcp] fatal:", err);
  process.exit(1);
});
