# Anthropic MCP directory re-review reply (draft)

> Paste this in the reply thread for the original review and attach the
> new `flitiq-mcp.mcpb` (v0.1.3) via the resubmission form.

---

Hi — thanks for the thorough review. All four items are addressed in
v0.1.3, attached. Summary of what changed:

## Required #1 — `openWorldHint: true` on every tool

All 7 tools now declare `openWorldHint: true` in their `annotations`.
`flitiq_save_carrier` keeps `destructiveHint: true` alongside it (it
contacts an external service AND mutates account state).

Verified on the packed bundle:

```
$ unzip -p flitiq-mcp.mcpb dist/tools.js | grep -c openWorldHint
7
```

Commit: `flitiq-mcp@3d001d8` (and the earlier `b64717c` on v0.1.2).

## Required #2 — service-role credentials out of the user binary

Pre-v0.1.3 the binary read `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`VPS_BASE_URL`, and `VPS_AUTH_TOKEN` from `process.env` even though
`manifest.json` only declared `FLITIQ_API_KEY` in `user_config`. You
were right that this was a credential breach by design — the service
role bypasses RLS, so distributing it would have handed every Pro
subscriber full DB access.

In v0.1.3 the entire data layer moved server-side behind authenticated
endpoints on `https://flitiq.com`:

- `GET /api/mcp/search`
- `GET /api/mcp/carrier/{dot}/safety`
- `GET /api/mcp/carrier/{dot}/insurance`
- `GET /api/mcp/carrier/{dot}/inspections`
- `GET /api/mcp/carrier/{dot}/crashes`
- `GET /api/mcp/carrier/{dot}/authority`
- `POST /api/mcp/save-carrier`

Each endpoint validates `Authorization: Bearer <FLITIQ_API_KEY>`
against the existing `mcp_api_keys` table (sha256 lookup, Pro tier
check, last-used stamping), then does the Supabase + FMCSA work
server-side and returns curated JSON.

The MCP binary is now a thin HTTP client. Audit of the packed `dist/`:

```
$ grep -r "supabase" dist/ | wc -l
0
$ grep -rE 'process\.env\.[A-Z_]+' dist/ | grep -v '.map'
dist/lib/auth.js:    const raw = process.env.FLITIQ_API_KEY?.trim();
dist/lib/api.js:const API_BASE = (process.env.FLITIQ_API_BASE ?? "https://flitiq.com").replace(/\/+$/, "");
```

Only `FLITIQ_API_KEY` (required, the same single value declared in
`user_config`) and `FLITIQ_API_BASE` (optional, defaults to
`https://flitiq.com` — for staging only). `@supabase/supabase-js` has
been removed from `package.json`.

Commits: `flitiq-mcp@3d001d8` (client) and `flitiq-site@d84a879`
(server-side endpoints + migration).

## Recommended #1 — auth error caching is sticky

Fixed. `src/index.ts` now distinguishes definite failures from
transient ones:

```ts
const TERMINAL_AUTH_CODES = new Set(["UNAUTHENTICATED", "FORBIDDEN_NOT_PRO"]);

authPromise = Promise.resolve().then(readApiKeyFromEnv).catch((err) => {
  if (err instanceof McpError && TERMINAL_AUTH_CODES.has(err.code)) {
    authError = err;          // cache forever — bad key / not Pro
  } else {
    authPromise = null;       // clear so next call can retry
  }
  throw err;
});
```

A bad key still surfaces on every call, but a network blip or 5xx no
longer locks the session into an error state until restart.

## Recommended #2 — per-process rate-limit scope

Resolved as a side effect of Required #2. The 60 requests/minute cap
now lives server-side in `src/lib/mcpAuth.ts` on `flitiq.com`, backed
by two new columns on `mcp_api_keys` (`rate_window_start`,
`rate_count`). All Claude conversations using the same key share the
same counter — opening N conversations no longer multiplies the cap.

`src/lib/rate-limit.ts` has been deleted from the MCP package.

---

Happy to address anything else. New `.mcpb` is v0.1.3 (7.2 MB, ~1 MB
smaller than 0.1.2 because the Supabase dependency is gone).

— Al
