/**
 * In-process token-bucket rate limit per API key. Keeps the MCP from
 * being abused as a bulk extractor — caps each key to N calls per minute.
 *
 * The MCP server is invoked once per Claude Desktop session, so process-local
 * state is fine. If we ever run a hosted MCP gateway shared across keys,
 * swap this for Redis without changing the call sites.
 */

import { rateLimited } from "./errors.js";

const DEFAULT_LIMIT = Number(process.env.MCP_RATE_LIMIT_PER_MIN ?? 60);
const WINDOW_MS = 60_000;

interface Bucket {
  tokens: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Throws RATE_LIMITED if the key has exhausted its budget. Otherwise
 * decrements one token and returns. Refills on a tumbling 60-second window.
 */
export function enforceRateLimit(apiKeyId: string, limit = DEFAULT_LIMIT): void {
  const now = Date.now();
  let bucket = buckets.get(apiKeyId);

  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    bucket = { tokens: limit, windowStart: now };
    buckets.set(apiKeyId, bucket);
  }

  if (bucket.tokens <= 0) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - bucket.windowStart)) / 1000);
    rateLimited(retryAfter);
  }

  bucket.tokens -= 1;
}
