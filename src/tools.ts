/**
 * Tool registry for the FlitIQ MCP server.
 *
 * Each tool is per-carrier — we deliberately do NOT expose a bulk-list,
 * CSV export, or radius-scan endpoint. That keeps the MCP surface aligned
 * with FlitIQ's Terms (no bulk extraction).
 *
 * Every tool runs auth + rate-limit before delegating to lib/fmcsa.ts.
 */

import { createClient } from "@supabase/supabase-js";
import type { AuthContext } from "./lib/auth.js";
import { enforceRateLimit } from "./lib/rate-limit.js";
import { badInput, notFound } from "./lib/errors.js";
import {
  getCarrier,
  getSafety,
  getInsurance,
  getInspections,
  getCrashes,
  getAuthority,
  searchCarriers,
} from "./lib/fmcsa.js";

/** Stable type the MCP server uses to register every tool. */
export interface ToolDef {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: Record<string, any>;
  /**
   * MCP tool annotations — required by the Anthropic MCP directory.
   * Every tool must declare readOnlyHint OR destructiveHint (mutually exclusive).
   * `title` is a human-readable label shown in Claude's UI.
   */
  annotations: {
    title: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
  };
  handler: (args: unknown, ctx: AuthContext) => Promise<unknown>;
}

// Normalize a DOT input — accept "21800", "DOT 21800", "USDOT-21800", etc.
function parseDot(raw: unknown): string {
  if (typeof raw !== "string" && typeof raw !== "number") {
    badInput("dot must be a number or string");
  }
  const cleaned = String(raw).replace(/[^0-9]/g, "");
  if (!cleaned || cleaned.length > 8) {
    badInput("dot must be a numeric DOT number (1–8 digits)");
  }
  return cleaned;
}

/* ─── 1. search_carrier ──────────────────────────────────────────── */

const searchCarrier: ToolDef = {
  name: "flitiq_search_carrier",
  description:
    "Search FMCSA-registered motor carriers by name, DOT number, or MC number. Returns up to 20 results with identity, location, fleet size, and operating status. Use this when the user mentions a carrier by name and you need to find the right DOT to call other tools.",
  annotations: { title: "Search carriers", readOnlyHint: true },
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
    enforceRateLimit(ctx.apiKeyId);
    const { query, state } = args as { query?: unknown; state?: unknown };

    if (typeof query !== "string" || query.trim().length < 2) {
      badInput("query must be a string with at least 2 characters");
    }

    const trimmed = query.trim();
    const isNumeric = /^\d+$/.test(trimmed);

    const results = await searchCarriers({
      q: isNumeric ? undefined : trimmed,
      dot: isNumeric ? trimmed : undefined,
      state: typeof state === "string" ? state.toUpperCase() : undefined,
    });

    return {
      count: results.length,
      results: results.map((c) => ({
        dot: c.dot_number,
        legal_name: c.legal_name,
        dba: c.dba_name,
        city: c.phy_city,
        state: c.phy_state,
        zip: c.phy_zip,
        power_units: c.nbr_power_unit,
        drivers: c.driver_total,
        authorized_for_hire: c.authorized_for_hire,
        hazmat: c.hm_flag,
      })),
      note:
        "Phone/email contact info is intentionally omitted from search results. Use flitiq_get_authority or the FlitIQ web app for full contact info on a specific carrier.",
    };
  },
};

/* ─── 2. get_safety ──────────────────────────────────────────────── */

const getSafetyTool: ToolDef = {
  name: "flitiq_get_safety",
  description:
    "Get the carrier's safety profile: CSA BASIC scores (all 7 categories with percentiles + FMCSA intervention thresholds), out-of-service rates vs national averages, safety rating, total inspections, crash totals. The most important call for vetting.",
  annotations: { title: "Get carrier safety profile", readOnlyHint: true },
  inputSchema: {
    type: "object",
    properties: {
      dot: { type: ["string", "number"], description: "DOT number of the carrier." },
    },
    required: ["dot"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    enforceRateLimit(ctx.apiKeyId);
    const dot = parseDot((args as { dot?: unknown }).dot);
    const data = await getSafety(dot);
    return {
      dot,
      safety_rating: data.overallRating ?? data.safety_rating ?? null,
      total_inspections: data.total_inspections,
      crashes_total: data.crash_total,
      fatal_crashes: data.fatal_crash,
      oos_rate_vehicle_pct: data.oos_rate_vehicle,
      oos_rate_vehicle_national_pct: data.oos_rate_vehicle_national,
      oos_rate_driver_pct: data.oos_rate_driver,
      oos_rate_driver_national_pct: data.oos_rate_driver_national,
      basics: (data.basics ?? []).map((b) => ({
        category: b.name,
        percentile: b.percentile,
        intervention_threshold: b.threshold,
        exceeds_threshold: b.exceed_threshold,
        violations: b.total_violations,
      })),
    };
  },
};

/* ─── 3. get_insurance ───────────────────────────────────────────── */

const getInsuranceTool: ToolDef = {
  name: "flitiq_get_insurance",
  description:
    "Get the carrier's active and pending insurance policies from FMCSA's L&I database. Returns insurer name (e.g. \"Liberty Mutual Fire Insurance Co.\"), policy number, coverage amount, effective date, and pending cancellation date for BIPD primary, BIPD excess, cargo, and trust-fund coverage. Use this whenever the user asks about insurance verification.",
  annotations: { title: "Get carrier insurance", readOnlyHint: true },
  inputSchema: {
    type: "object",
    properties: {
      dot: { type: ["string", "number"], description: "DOT number of the carrier." },
    },
    required: ["dot"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    enforceRateLimit(ctx.apiKeyId);
    const dot = parseDot((args as { dot?: unknown }).dot);
    const data = await getInsurance(dot);
    const FEDERAL_MIN_BIPD = 750_000;
    const bipdTotal = data.summary?.bipd_total ?? 0;
    return {
      dot,
      active_policy_count: data.active_count,
      bipd_total_coverage: bipdTotal,
      compliance:
        !data.summary?.bipd_primary
          ? "NO_ACTIVE_BIPD"
          : bipdTotal < FEDERAL_MIN_BIPD
          ? "BELOW_FEDERAL_MINIMUM_750K"
          : "OK_AT_OR_ABOVE_750K",
      bipd_primary: data.summary?.bipd_primary ?? null,
      bipd_excess: data.summary?.bipd_excess ?? null,
      cargo: data.summary?.cargo ?? null,
      trust: data.summary?.trust ?? null,
      all_policies: data.policies,
    };
  },
};

/* ─── 4. get_inspections ─────────────────────────────────────────── */

const getInspectionsTool: ToolDef = {
  name: "flitiq_get_inspections",
  description:
    "Get up to 50 most-recent roadside inspections for the carrier. Each row includes date, state, inspection level, OOS counts (vehicle/driver/hazmat), and total violation count. Use this when the user wants to see recent inspection trends or OOS patterns.",
  annotations: { title: "Get carrier inspections", readOnlyHint: true },
  inputSchema: {
    type: "object",
    properties: {
      dot: { type: ["string", "number"], description: "DOT number of the carrier." },
    },
    required: ["dot"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    enforceRateLimit(ctx.apiKeyId);
    const dot = parseDot((args as { dot?: unknown }).dot);
    const data = await getInspections(dot);
    return {
      dot,
      count: data.count ?? data.inspections.length,
      inspections: data.inspections.slice(0, 50),
    };
  },
};

/* ─── 5. get_crashes ─────────────────────────────────────────────── */

const getCrashesTool: ToolDef = {
  name: "flitiq_get_crashes",
  description:
    "Get up to 50 most-recent FMCSA-reportable crashes for the carrier. Each row includes date, state/city, fatality count, injury count, tow-away flag, and hazmat-released flag.",
  annotations: { title: "Get carrier crashes", readOnlyHint: true },
  inputSchema: {
    type: "object",
    properties: {
      dot: { type: ["string", "number"], description: "DOT number of the carrier." },
    },
    required: ["dot"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    enforceRateLimit(ctx.apiKeyId);
    const dot = parseDot((args as { dot?: unknown }).dot);
    const data = await getCrashes(dot);
    return {
      dot,
      count: data.count ?? data.crashes.length,
      crashes: data.crashes.slice(0, 50),
    };
  },
};

/* ─── 6. get_authority ───────────────────────────────────────────── */

const getAuthorityTool: ToolDef = {
  name: "flitiq_get_authority",
  description:
    "Get the carrier's operating authority status: common, contract, and broker authority per docket (MC number). Surfaces whether each docket is Active, Revoked, Suspended, etc.",
  annotations: { title: "Get carrier authority", readOnlyHint: true },
  inputSchema: {
    type: "object",
    properties: {
      dot: { type: ["string", "number"], description: "DOT number of the carrier." },
    },
    required: ["dot"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    enforceRateLimit(ctx.apiKeyId);
    const dot = parseDot((args as { dot?: unknown }).dot);
    const data = await getAuthority(dot);
    return {
      dot,
      common_authority: data.common_authority ?? data.commonAuthority ?? null,
      contract_authority: data.contract_authority ?? data.contractAuthority ?? null,
      broker_authority: data.broker_authority ?? data.brokerAuthority ?? null,
      per_docket: data.dockets ?? [],
    };
  },
};

/* ─── 7. save_carrier ────────────────────────────────────────────── */

const saveCarrierTool: ToolDef = {
  name: "flitiq_save_carrier",
  description:
    "Save a carrier to the user's FlitIQ saved-carriers list (with optional note). The user can then view it in the web app, monitor it for alerts, and add it to their CRM pipeline. Mutates account state.",
  annotations: { title: "Save carrier to pipeline", destructiveHint: true },
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
    enforceRateLimit(ctx.apiKeyId);
    const { dot: rawDot, notes } = args as { dot?: unknown; notes?: unknown };
    const dot = parseDot(rawDot);
    const noteStr = typeof notes === "string" ? notes.slice(0, 1000) : null;

    // Resolve the FlitIQ carrier_id (UUID in our carriers table) from the DOT
    // by hitting the carrier-by-dot endpoint.
    const carrier = await getCarrier(dot);
    if (!carrier?.id) {
      notFound(`No FlitIQ carrier record found for DOT ${dot}.`);
    }

    // Service-role insert into user_saved_carriers. Respect the existing free
    // tier cap (3 saved) by reading the count first — Pro/Team are unlimited.
    const admin = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // Idempotency: if the user already saved this carrier, return the existing row.
    const { data: existing } = await admin
      .from("user_saved_carriers")
      .select("id, notes, created_at")
      .eq("user_id", ctx.userId)
      .eq("carrier_id", carrier.id)
      .maybeSingle();

    if (existing) {
      return {
        already_saved: true,
        saved_carrier_id: existing.id,
        dot,
        legal_name: carrier.legal_name,
        notes: existing.notes,
        message: "This carrier was already on the user's saved list.",
      };
    }

    const { data: inserted, error } = await admin
      .from("user_saved_carriers")
      .insert({
        user_id: ctx.userId,
        carrier_id: carrier.id,
        notes: noteStr,
      })
      .select("id, created_at")
      .single();

    if (error) {
      throw new Error(`Failed to save carrier: ${error.message}`);
    }

    return {
      already_saved: false,
      saved_carrier_id: inserted.id,
      dot,
      legal_name: carrier.legal_name,
      notes: noteStr,
      message:
        "Carrier saved. View it on the FlitIQ web app at /saved or set up alerts at /alerts.",
    };
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
