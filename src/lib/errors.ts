/**
 * Typed error classes the tool handlers throw. The server catches them and
 * turns them into MCP error responses with a friendly message that the
 * Claude client renders inline.
 */

export class McpError extends Error {
  constructor(public readonly code: McpErrorCode, message: string) {
    super(message);
    this.name = "McpError";
  }
}

export type McpErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN_NOT_PRO"
  | "RATE_LIMITED"
  | "BAD_INPUT"
  | "UPSTREAM_FAILED"
  | "NOT_FOUND";

export function unauthenticated(): never {
  throw new McpError(
    "UNAUTHENTICATED",
    "FLITIQ_API_KEY is missing or invalid. Generate a key at https://flitiq.com/settings."
  );
}

export function notPro(currentRole: string): never {
  throw new McpError(
    "FORBIDDEN_NOT_PRO",
    `FlitIQ MCP requires a Pro or Team subscription. Your current plan is "${currentRole}". Upgrade at https://flitiq.com/pricing.`
  );
}

export function rateLimited(retryAfterSec: number): never {
  throw new McpError(
    "RATE_LIMITED",
    `Too many requests. Try again in ${retryAfterSec} seconds. Bulk extraction is not permitted under the FlitIQ Terms.`
  );
}

export function badInput(detail: string): never {
  throw new McpError("BAD_INPUT", detail);
}

export function upstreamFailed(detail: string): never {
  throw new McpError(
    "UPSTREAM_FAILED",
    `FMCSA upstream is unavailable: ${detail}. FlitIQ caches recent data and will resume when the source recovers.`
  );
}

export function notFound(detail: string): never {
  throw new McpError("NOT_FOUND", detail);
}
