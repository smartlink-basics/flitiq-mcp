/**
 * Bearer-token auth for the MCP server.
 *
 * The user generates an API key at flitiq.com/settings. We store only the
 * SHA-256 hash. On every tool call we hash the incoming key, look it up,
 * confirm the linked user's role is Pro/Team/etc., and stamp last_used_at.
 *
 * The MCP server is invoked by Claude Desktop with the API key set in the
 * server's process env (FLITIQ_API_KEY). We read it once at startup and
 * cache the resolved identity for the lifetime of the process.
 */

import { createHash } from "node:crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { notPro, unauthenticated } from "./errors.js";

const PRO_ROLES = new Set(["pro", "team", "enterprise", "prospector"]);

export interface AuthContext {
  userId: string;
  email: string | null;
  role: string;
  apiKeyId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: SupabaseClient<any, "public", any> | null = null;

function getAdmin(): SupabaseClient {
  if (!_admin) {
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the MCP server environment."
      );
    }
    _admin = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });
  }
  return _admin;
}

function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/**
 * Resolve the bearer token to a verified Pro-or-better user. Throws an MCP
 * error if the key is missing, unknown, revoked, or the user has lost Pro.
 */
export async function authenticate(rawKey: string | undefined): Promise<AuthContext> {
  if (!rawKey || rawKey.trim().length < 16) {
    unauthenticated();
  }

  const admin = getAdmin();
  const keyHash = hashKey(rawKey.trim());

  // Look up the key. Service role bypasses RLS.
  const { data: keyRow, error: keyErr } = await admin
    .from("mcp_api_keys")
    .select("id, user_id, revoked_at")
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (keyErr) {
    throw new Error(`Supabase lookup failed: ${keyErr.message}`);
  }
  if (!keyRow || keyRow.revoked_at) {
    unauthenticated();
  }

  // Confirm the user is on a Pro/Team plan.
  const { data: profile } = await admin
    .from("user_profiles")
    .select("role, id")
    .eq("id", keyRow.user_id)
    .single();

  const role = profile?.role ?? "free";
  if (!PRO_ROLES.has(role)) {
    notPro(role);
  }

  // Resolve email for nicer error messages / logs. Optional.
  let email: string | null = null;
  try {
    const { data: userResp } = await admin.auth.admin.getUserById(keyRow.user_id);
    email = userResp?.user?.email ?? null;
  } catch {
    // Non-critical; auth.admin may not be reachable depending on key scope.
  }

  // Fire-and-forget last_used_at stamp.
  void admin
    .from("mcp_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyRow.id);

  return {
    userId: keyRow.user_id,
    email,
    role,
    apiKeyId: keyRow.id,
  };
}
