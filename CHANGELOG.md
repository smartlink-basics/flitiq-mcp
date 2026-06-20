# Changelog

All notable changes to the FlitIQ MCP server are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [SemVer](https://semver.org/).

This file is the source of truth for GitHub Release notes — the
`mcpb-pack.yaml` workflow extracts the section matching the pushed tag
and uses it as the Release body. Keep the headings exact:
`## [X.Y.Z] - YYYY-MM-DD`.

## [Unreleased]

<!--
Add notes here for work that's landed on main but not yet tagged.
On release: change "Unreleased" to the version + date, then create a
fresh empty "Unreleased" section above it.

Categories (drop the ones you don't use):
### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security
-->

## [0.1.4] - 2026-06-20

### Added

- `flitiq_check_connection` diagnostic tool. Returns a safe local env
  summary (key preview ending `****WXYZ`, key length, base URL, Node
  version, PID, platform) plus a `/api/mcp/whoami` round-trip. Catches
  the literal `${user_config.api_key}` substitution failure mode that
  static audits can't detect.
- `.github/workflows/mcpb-pack.yaml` — packs and publishes a
  `flitiq-mcp-X.Y.Z.mcpb` asset to a GitHub Release on every
  `flitiq-mcp-*` tag push. Fails the build if `package.json`,
  `manifest.json`, and `src/index.ts` versions are out of sync, or if
  the tag SemVer doesn't match `package.json`.
- README "Releases" section documenting the tag → CI → directory flow.

### Changed

- v0.1.4 is the inaugural GitHub Release tag — Anthropic's MCP
  directory now picks up future versions from the Release channel.

## [0.1.3] - 2026-06-20

### Changed

- Entire data layer moved server-side behind authenticated endpoints
  on `https://flitiq.com/api/mcp/*`. The MCP binary is now a thin HTTP
  client that forwards `FLITIQ_API_KEY` as a Bearer token; the server
  validates the key, confirms Pro tier, enforces the rate limit, and
  does the Supabase + FMCSA work.
- `src/lib/auth.ts` shrunk to a presence check on `FLITIQ_API_KEY`.
- Per-key 60/min rate limit moved server-side. All Claude conversations
  using the same key now share the same counter (previously each Claude
  subprocess had its own in-memory limiter, so opening N conversations
  multiplied the cap).

### Removed

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VPS_BASE_URL`, and
  `VPS_AUTH_TOKEN` are no longer read from the binary's environment.
  Only `FLITIQ_API_KEY` (required) and `FLITIQ_API_BASE` (optional
  staging override) remain.
- `@supabase/supabase-js` dependency dropped from the bundle (~1 MB
  smaller .mcpb).
- `src/lib/fmcsa.ts` and `src/lib/rate-limit.ts` deleted.

### Security

- Resolves Anthropic MCP directory review Required #2: distributing a
  Supabase service-role key in a user-installed binary would have
  bypassed RLS. All sensitive credentials now live server-side.

## [0.1.2] - 2026-06-20

### Added

- `openWorldHint: true` on every tool. `flitiq_save_carrier` keeps
  `destructiveHint: true` alongside it.

### Fixed

- Auth-error cache no longer persists transient failures. Only
  `UNAUTHENTICATED` and `FORBIDDEN_NOT_PRO` are cached forever;
  network blips and 5xx errors clear the cached promise so the next
  tool call can retry. Previously a single network hiccup at startup
  bricked the session until Claude restart.

### Security

- Resolves Anthropic MCP directory review Required #1 (tool
  annotations) and Recommended #1 (sticky auth caching).

## [0.1.1] - 2026-05-20

### Changed

- Switched wrapper license to MIT (was unspecified).
- `manifest.json` author URL points at the GitHub org instead of a
  personal profile, per directory submission requirements.

## [0.1.0] - 2026-05-20

### Added

- Initial release. 7 tools: `flitiq_search_carrier`, `flitiq_get_safety`,
  `flitiq_get_insurance`, `flitiq_get_inspections`, `flitiq_get_crashes`,
  `flitiq_get_authority`, `flitiq_save_carrier`.
- sha256-against-Supabase API key validation (later moved server-side
  in v0.1.3).
- Per-process token-bucket rate limit (later moved server-side in
  v0.1.3).
- README, `manifest.json` with privacy_policies, MCPB packaging.
