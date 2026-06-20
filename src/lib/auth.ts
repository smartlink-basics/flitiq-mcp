/**
 * MCP-side auth shim.
 *
 * Up to v0.1.2 this file did the actual sha256-against-Supabase lookup
 * locally, which meant the user-distributed binary had to ship with
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in its env. Anthropic's MCP
 * directory review (rightly) flagged that as a credential breach by
 * design -- service-role bypasses RLS, so handing it to every Pro
 * subscriber would have given them full DB access.
 *
 * As of v0.1.3 all key validation happens server-side inside
 * /api/mcp/* on flitiq.com. The MCP binary only ever sees the user's
 * FLITIQ_API_KEY and forwards it as Authorization: Bearer on every
 * request. This file now just checks the key is present locally so we
 * can give a nicer error than "401 from the server".
 */

import { unauthenticated } from "./errors.js";

export interface AuthContext {
  /** The plaintext FLITIQ_API_KEY -- forwarded as Bearer to /api/mcp/*. */
  apiKey: string;
}

export function readApiKeyFromEnv(): AuthContext {
  const raw = process.env.FLITIQ_API_KEY?.trim();
  if (!raw || raw.length < 16) {
    unauthenticated();
  }
  return { apiKey: raw };
}
