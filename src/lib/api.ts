/**
 * Thin HTTP client for the /api/mcp/* surface on flitiq.com.
 *
 * Replaces the old src/lib/fmcsa.ts (which talked to the VPS directly
 * using VPS_AUTH_TOKEN) and the Supabase service-role calls that used
 * to live in tools.ts. Everything now goes through the user's
 * FLITIQ_API_KEY as a Bearer header -- the server side does the actual
 * Supabase + VPS work.
 *
 * No service-role keys or VPS tokens are ever read from the local
 * process env. The only env var this binary needs is FLITIQ_API_KEY.
 */

import { McpError, unauthenticated, notPro, rateLimited, upstreamFailed, notFound, badInput } from "./errors.js";

/**
 * Override only for local dev / staging. Production users should never
 * set this; the default is the canonical https://flitiq.com.
 */
const API_BASE = (process.env.FLITIQ_API_BASE ?? "https://flitiq.com").replace(/\/+$/, "");

interface RequestOpts {
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | undefined>;
}

async function request<T>(path: string, apiKey: string, opts: RequestOpts = {}): Promise<T> {
  const url = new URL(`${API_BASE}/api/mcp${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    // Network failure -- distinguish from "server said no" so the
    // auth-error cache in index.ts can let us retry.
    upstreamFailed(`Could not reach ${API_BASE}: ${(err as Error).message}`);
  }

  // Map server-side error codes back to typed McpError instances so
  // tools.ts and index.ts can react the same way they did pre-refactor.
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: string; message?: string }));
    const errorCode = typeof body.error === "string" ? body.error : null;
    const errorMsg = typeof body.message === "string" ? body.message : res.statusText;

    switch (errorCode) {
      case "UNAUTHENTICATED":
        unauthenticated();
      // eslint-disable-next-line no-fallthrough
      case "FORBIDDEN_NOT_PRO":
        notPro("free");
      // eslint-disable-next-line no-fallthrough
      case "RATE_LIMITED": {
        const retryAfter = Number(res.headers.get("Retry-After") ?? "60");
        rateLimited(retryAfter);
      }
      // eslint-disable-next-line no-fallthrough
      case "BAD_INPUT":
        badInput(errorMsg);
      // eslint-disable-next-line no-fallthrough
      case "NOT_FOUND":
        notFound(errorMsg);
      // eslint-disable-next-line no-fallthrough
      default:
        if (res.status === 401) unauthenticated();
        if (res.status === 403) notPro("free");
        if (res.status === 404) notFound(errorMsg);
        if (res.status === 429) rateLimited(60);
        upstreamFailed(`/api/mcp${path} returned ${res.status}: ${errorMsg}`);
    }
    // Unreachable -- every branch above throws.
    throw new McpError("UPSTREAM_FAILED", "unreachable");
  }

  return (await res.json()) as T;
}

/* ─── Typed wrappers used by tools.ts ─────────────────────────────── */

export interface SearchResult {
  count: number;
  results: Array<{
    dot: string;
    legal_name: string;
    dba: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    power_units: number | null;
    drivers: number | null;
    authorized_for_hire: boolean | null;
    hazmat: boolean | null;
  }>;
  note?: string;
  hint?: string;
}

export function search(apiKey: string, opts: { q: string; state?: string }): Promise<SearchResult> {
  return request<SearchResult>("/search", apiKey, {
    query: { q: opts.q, state: opts.state },
  });
}

// The 5 read endpoints all return the raw VPS payload (with optional
// stale + cached_at fields when serving from cache). The tool handlers
// in tools.ts already know the shape -- they just re-shape into the
// MCP response, so we use `unknown` here and let the handler narrow.

export function getSafety(apiKey: string, dot: string): Promise<Record<string, unknown>> {
  return request(`/carrier/${encodeURIComponent(dot)}/safety`, apiKey);
}
export function getInsurance(apiKey: string, dot: string): Promise<Record<string, unknown>> {
  return request(`/carrier/${encodeURIComponent(dot)}/insurance`, apiKey);
}
export function getInspections(apiKey: string, dot: string): Promise<Record<string, unknown>> {
  return request(`/carrier/${encodeURIComponent(dot)}/inspections`, apiKey);
}
export function getCrashes(apiKey: string, dot: string): Promise<Record<string, unknown>> {
  return request(`/carrier/${encodeURIComponent(dot)}/crashes`, apiKey);
}
export function getAuthority(apiKey: string, dot: string): Promise<Record<string, unknown>> {
  return request(`/carrier/${encodeURIComponent(dot)}/authority`, apiKey);
}

export interface SaveCarrierResult {
  already_saved: boolean;
  saved_carrier_id: string;
  dot: string;
  legal_name: string;
  notes: string | null;
  message: string;
}

export function saveCarrier(
  apiKey: string,
  body: { dot: string; notes: string | null }
): Promise<SaveCarrierResult> {
  return request<SaveCarrierResult>("/save-carrier", apiKey, {
    method: "POST",
    body,
  });
}
