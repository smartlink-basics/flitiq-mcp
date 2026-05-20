/**
 * Thin typed client for the FlitIQ VPS. The VPS already proxies + caches
 * FMCSA SAFER, the Licensing & Insurance database, and SMS via Socrata.
 * We don't re-derive any of that here — we just call through and return
 * curated JSON to the MCP tools.
 */

import { upstreamFailed } from "./errors.js";

const VPS_BASE = process.env.VPS_BASE_URL;
const VPS_TOKEN = process.env.VPS_AUTH_TOKEN;

function requireConfig(): void {
  if (!VPS_BASE || !VPS_TOKEN) {
    throw new Error("VPS_BASE_URL and VPS_AUTH_TOKEN must be set in the MCP server environment.");
  }
}

async function get<T>(path: string): Promise<T> {
  requireConfig();
  const res = await fetch(`${VPS_BASE}${path}`, {
    headers: { Authorization: `Bearer ${VPS_TOKEN}` },
  });
  if (!res.ok) {
    upstreamFailed(`${path} returned ${res.status}`);
  }
  return (await res.json()) as T;
}

/* ─── Response shapes (subset — only fields tools actually surface) ── */

export interface Carrier {
  id?: string;
  dot_number: string;
  legal_name: string;
  dba_name: string | null;
  phy_city: string | null;
  phy_state: string | null;
  phy_zip: string | null;
  telephone: string | null;
  email_address: string | null;
  nbr_power_unit: number | null;
  driver_total: number | null;
  carrier_operation: string | null;
  hm_flag: boolean | null;
  authorized_for_hire: boolean | null;
  mcs150_date: string | null;
}

export interface SafetyResponse {
  basics?: Array<{
    name: string;
    percentile: number | null;
    threshold: number | null;
    exceed_threshold: boolean;
    total_violations: number;
    total_inspections_with_violation: number;
  }>;
  overallRating?: string | null;
  safety_rating?: string | null;
  total_inspections?: number | null;
  crash_total?: number | null;
  fatal_crash?: number | null;
  oos_rate_vehicle?: number | string | null;
  oos_rate_driver?: number | string | null;
  oos_rate_vehicle_national?: number | string | null;
  oos_rate_driver_national?: number | string | null;
}

export interface InsurancePolicy {
  docket_number: string | null;
  form_code: string | null;
  coverage_type: string | null;
  insurer: string | null;
  policy_no: string | null;
  coverage_amount: number;
  effective_date: string | null;
  cancellation_date: string | null;
  is_active: boolean;
}

export interface InsuranceResponse {
  dot_number: string;
  active_count: number;
  summary?: {
    bipd_primary: InsurancePolicy | null;
    bipd_excess: InsurancePolicy | null;
    cargo: InsurancePolicy | null;
    trust: InsurancePolicy | null;
    bipd_total: number;
  };
  policies: InsurancePolicy[];
}

export interface InspectionsResponse {
  count?: number;
  inspections: Array<{
    report_number: string | null;
    inspection_date: string | null;
    state: string | null;
    level: number | null;
    vehicle_oos: number;
    driver_oos: number;
    hazmat_oos: number;
    total_violations: number;
  }>;
}

export interface CrashesResponse {
  count?: number;
  crashes: Array<{
    report_number: string | null;
    report_date: string | null;
    report_state: string | null;
    city: string | null;
    fatalities: number;
    injuries: number;
    tow_away: boolean;
    hazmat_released: boolean;
  }>;
}

export interface AuthorityResponse {
  commonAuthority?: string | null;
  contractAuthority?: string | null;
  brokerAuthority?: string | null;
  common_authority?: string | null;
  contract_authority?: string | null;
  broker_authority?: string | null;
  dockets?: Array<{
    docket_number: string | null;
    prefix: string | null;
    authorized_for_property: boolean | null;
    authorized_for_passenger: boolean | null;
    authorized_for_household_goods: boolean | null;
    authorized_for_broker: boolean | null;
    common_authority_status: string | null;
    contract_authority_status: string | null;
    broker_authority_status: string | null;
  }>;
}

/* ─── Calls ─────────────────────────────────────────────────────── */

export function getCarrier(dot: string): Promise<Carrier> {
  return get<Carrier>(`/api/carriers/${encodeURIComponent(dot)}`);
}

export function getSafety(dot: string): Promise<SafetyResponse> {
  return get<SafetyResponse>(`/api/safety/${encodeURIComponent(dot)}`);
}

export function getInsurance(dot: string): Promise<InsuranceResponse> {
  return get<InsuranceResponse>(`/api/insurance/${encodeURIComponent(dot)}`);
}

export function getInspections(dot: string): Promise<InspectionsResponse> {
  return get<InspectionsResponse>(`/api/inspections/${encodeURIComponent(dot)}`);
}

export function getCrashes(dot: string): Promise<CrashesResponse> {
  return get<CrashesResponse>(`/api/crashes/${encodeURIComponent(dot)}`);
}

export function getAuthority(dot: string): Promise<AuthorityResponse> {
  return get<AuthorityResponse>(`/api/authority/${encodeURIComponent(dot)}`);
}

/**
 * Carrier search — the VPS exposes a search endpoint that scans the carriers
 * table. We hard-cap the results to 20 here regardless of what the VPS returns
 * to keep the MCP tool surface honest about being a per-carrier-lookup tool,
 * not a bulk extractor.
 */
export async function searchCarriers(opts: {
  q?: string;
  dot?: string;
  state?: string;
}): Promise<Carrier[]> {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  if (opts.dot) params.set("dot", opts.dot);
  if (opts.state) params.set("state", opts.state);
  params.set("limit", "20");

  const resp = await get<{ carriers: Carrier[] }>(`/api/carriers/search?${params.toString()}`);
  return (resp.carriers ?? []).slice(0, 20);
}
