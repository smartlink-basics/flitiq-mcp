/**
 * Tool registry for the FlitIQ MCP server.
 *
 * Every tool is per-carrier -- we deliberately do NOT expose a bulk-list,
 * CSV export, or radius-scan endpoint. That keeps the MCP surface aligned
 * with FlitIQ's Terms (no bulk extraction).
 *
 * As of v0.1.3 every tool is a thin pass-through to /api/mcp/* on
 * flitiq.com. The server side does auth (via Bearer FLITIQ_API_KEY),
 * the Pro/Team check, the rate-limit, and the actual Supabase/VPS work.
 * The MCP binary never touches the DB or VPS directly.
 */

import type { AuthContext } from "./lib/auth.js";
import { badInput } from "./lib/errors.js";
import {
  search,
  getSafety,
  getInsurance,
  getInspections,
  getCrashes,
  getAuthority,
  saveCarrier,
} from "./lib/api.js";

/** Stable type the MCP server uses to register every tool. */
export interface ToolDef {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: Record<string, any>;
  /**
   * MCP tool annotations -- required by the Anthropic MCP directory.
   * Every tool must declare readOnlyHint OR destructiveHint (mutually
   * exclusive), plus openWorldHint when the tool contacts an external
   * service. All FlitIQ tools contact the FlitIQ API (which proxies
   * FMCSA upstream), so every tool sets openWorldHint: true.
   * `title` is a human-readable label shown in Claude's UI.
   */
  annotations: {
    title: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
  handler: (args: unknown, ctx: AuthContext) => Promise<unknown>;
}

// Normalize a DOT input -- accept "21800", "DOT 21800", "USDOT-21800", etc.
function parseDot(raw: unknown): string {
  if (typeof raw !== "string" && typeof raw !== "number") {
    badInput("dot must be a number or string");
  }
  const cleaned = String(raw).replace(/[^0-9]/g, "");
  if (!cleaned || cleaned.length > 8) {
    badInput("dot must be a numeric DOT number (1-8 digits)");
  }
  return cleaned;
}

// Reshape an unknown record as Safety response. The server returns the
// raw VPS shape; the helpers below narrow to the fields the MCP surfaces.
function s(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

/* ─── 1. search_carrier ──────────────────────────────────────────── */

const searchCarrier: ToolDef = {
  name: "flitiq_search_carrier",
  description:
    "Search FMCSA-registered motor carriers by name, DOT number, or MC number. Returns up to 20 results with identity, location, fleet size, and operating status. Use this when the user mentions a carrier by name and you need to find the right DOT to call other tools.",
  annotations: { title: "Search carriers", readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Carrier name (partial match), DOT number, or MC number. Required.",
      },
      state: {
        type: "string",
        description: 'Optional 2-letter US state code to filter results (e.g. "TX").',
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const { query, state } = args as { query?: unknown; state?: unknown };
    if (typeof query !== "string" || query.trim().length < 2) {
      badInput("query must be a string with at least 2 characters");
    }
    const result = await search(ctx.apiKey, {
      q: query.trim(),
      state: typeof state === "string" ? state : undefined,
    });
    return result;
  },
};

/* ─── 2. get_safety ──────────────────────────────────────────────── */

const getSafetyTool: ToolDef = {
  name: "flitiq_get_safety",
  description:
    "Get the carrier's safety profile: CSA BASIC scores (all 7 categories with percentiles + FMCSA intervention thresholds), out-of-service rates vs national averages, safety rating, total inspections, crash totals. The most important call for vetting.",
  annotations: { title: "Get carrier safety profile", readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: "object",
    properties: {
      dot: { type: ["string", "number"], description: "DOT number of the carrier." },
    },
    required: ["dot"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const dot = parseDot((args as { dot?: unknown }).dot);
    const data = await getSafety(ctx.apiKey, dot);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const basics = (s(data, "basics") as any[]) ?? [];
    return {
      dot,
      safety_rating: s(data, "overallRating") ?? s(data, "safety_rating") ?? null,
      total_inspections: s(data, "total_inspections"),
      crashes_total: s(data, "crash_total"),
      fatal_crashes: s(data, "fatal_crash"),
      oos_rate_vehicle_pct: s(data, "oos_rate_vehicle"),
      oos_rate_vehicle_national_pct: s(data, "oos_rate_vehicle_national"),
      oos_rate_driver_pct: s(data, "oos_rate_driver"),
      oos_rate_driver_national_pct: s(data, "oos_rate_driver_national"),
      basics: basics.map((b) => ({
        category: b.name,
        percentile: b.percentile,
        intervention_threshold: b.threshold,
        exceeds_threshold: b.exceed_threshold,
        violations: b.total_violations,
      })),
      stale: s(data, "stale") ?? false,
      cached_at: s(data, "cached_at") ?? null,
    };
  },
};

/* ─── 3. get_insurance ───────────────────────────────────────────── */

const getInsuranceTool: ToolDef = {
  name: "flitiq_get_insurance",
  description:
    "Get the carrier's active and pending insurance policies from FMCSA's L&I database. Returns insurer name (e.g. \"Liberty Mutual Fire Insurance Co.\"), policy number, coverage amount, effective date, and pending cancellation date for BIPD primary, BIPD excess, cargo, and trust-fund coverage. Use this whenever the user asks about insurance verification.",
  annotations: { title: "Get carrier insurance", readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: "object",
    properties: {
      dot: { type: ["string", "number"], description: "DOT number of the carrier." },
    },
    required: ["dot"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const dot = parseDot((args as { dot?: unknown }).dot);
    const data = await getInsurance(ctx.apiKey, dot);
    const FEDERAL_MIN_BIPD = 750_000;
    const summary = (s(data, "summary") as Record<string, unknown> | undefined) ?? {};
    const bipdTotal = (summary.bipd_total as number | undefined) ?? 0;
    return {
      dot,
      active_policy_count: s(data, "active_count"),
      bipd_total_coverage: bipdTotal,
      compliance:
        !summary.bipd_primary
          ? "NO_ACTIVE_BIPD"
          : bipdTotal < FEDERAL_MIN_BIPD
          ? "BELOW_FEDERAL_MINIMUM_750K"
          : "OK_AT_OR_ABOVE_750K",
      bipd_primary: summary.bipd_primary ?? null,
      bipd_excess: summary.bipd_excess ?? null,
      cargo: summary.cargo ?? null,
      trust: summary.trust ?? null,
      all_policies: s(data, "policies"),
      stale: s(data, "stale") ?? false,
      cached_at: s(data, "cached_at") ?? null,
    };
  },
};

/* ─── 4. get_inspections ─────────────────────────────────────────── */

const getInspectionsTool: ToolDef = {
  name: "flitiq_get_inspections",
  description:
    "Get up to 50 most-recent roadside inspections for the carrier. Each row includes date, state, inspection level, OOS counts (vehicle/driver/hazmat), and total violation count. Use this when the user wants to see recent inspection trends or OOS patterns.",
  annotations: { title: "Get carrier inspections", readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: "object",
    properties: {
      dot: { type: ["string", "number"], description: "DOT number of the carrier." },
    },
    required: ["dot"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const dot = parseDot((args as { dot?: unknown }).dot);
    const data = await getInspections(ctx.apiKey, dot);
    const inspections = (s(data, "inspections") as unknown[]) ?? [];
    return {
      dot,
      count: (s(data, "count") as number | undefined) ?? inspections.length,
      inspections: inspections.slice(0, 50),
      stale: s(data, "stale") ?? false,
      cached_at: s(data, "cached_at") ?? null,
    };
  },
};

/* ─── 5. get_crashes ─────────────────────────────────────────────── */

const getCrashesTool: ToolDef = {
  name: "flitiq_get_crashes",
  description:
    "Get up to 50 most-recent FMCSA-reportable crashes for the carrier. Each row includes date, state/city, fatality count, injury count, tow-away flag, and hazmat-released flag.",
  annotations: { title: "Get carrier crashes", readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: "object",
    properties: {
      dot: { type: ["string", "number"], description: "DOT number of the carrier." },
    },
    required: ["dot"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const dot = parseDot((args as { dot?: unknown }).dot);
    const data = await getCrashes(ctx.apiKey, dot);
    const crashes = (s(data, "crashes") as unknown[]) ?? [];
    return {
      dot,
      count: (s(data, "count") as number | undefined) ?? crashes.length,
      crashes: crashes.slice(0, 50),
      stale: s(data, "stale") ?? false,
      cached_at: s(data, "cached_at") ?? null,
    };
  },
};

/* ─── 6. get_authority ───────────────────────────────────────────── */

const getAuthorityTool: ToolDef = {
  name: "flitiq_get_authority",
  description:
    "Get the carrier's operating authority status: common, contract, and broker authority per docket (MC number). Surfaces whether each docket is Active, Revoked, Suspended, etc.",
  annotations: { title: "Get carrier authority", readOnlyHint: true, openWorldHint: true },
  inputSchema: {
    type: "object",
    properties: {
      dot: { type: ["string", "number"], description: "DOT number of the carrier." },
    },
    required: ["dot"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const dot = parseDot((args as { dot?: unknown }).dot);
    const data = await getAuthority(ctx.apiKey, dot);
    return {
      dot,
      common_authority: s(data, "common_authority") ?? s(data, "commonAuthority") ?? null,
      contract_authority: s(data, "contract_authority") ?? s(data, "contractAuthority") ?? null,
      broker_authority: s(data, "broker_authority") ?? s(data, "brokerAuthority") ?? null,
      per_docket: s(data, "dockets") ?? [],
      stale: s(data, "stale") ?? false,
      cached_at: s(data, "cached_at") ?? null,
    };
  },
};

/* ─── 7. save_carrier ────────────────────────────────────────────── */

const saveCarrierTool: ToolDef = {
  name: "flitiq_save_carrier",
  description:
    "Save a carrier to the user's FlitIQ saved-carriers list (with optional note). The user can then view it in the web app, monitor it for alerts, and add it to their CRM pipeline. Mutates account state.",
  annotations: { title: "Save carrier to pipeline", destructiveHint: true, openWorldHint: true },
  inputSchema: {
    type: "object",
    properties: {
      dot: { type: ["string", "number"], description: "DOT number of the carrier to save." },
      notes: {
        type: "string",
        description: "Optional free-text note attached to the saved carrier.",
      },
    },
    required: ["dot"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const { dot: rawDot, notes } = args as { dot?: unknown; notes?: unknown };
    const dot = parseDot(rawDot);
    const noteStr = typeof notes === "string" ? notes.slice(0, 1000) : null;
    return saveCarrier(ctx.apiKey, { dot, notes: noteStr });
  },
};

/* ─── Registry ───────────────────────────────────────────────────── */

export const TOOLS: ToolDef[] = [
  searchCarrier,
  getSafetyTool,
  getInsuranceTool,
  getInspectionsTool,
  getCrashesTool,
  getAuthorityTool,
  saveCarrierTool,
];

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}
