<p align="center">
  <img src="assets/icon-256.png" alt="FlitIQ" width="128" height="128" />
</p>

# FlitIQ MCP Server

FMCSA carrier intelligence tools for Claude. Pro and Team subscribers can install this
plugin and ask Claude things like:

- *"Look up DOT 21800 — what's their safety rating and insurance carrier?"*
- *"What were the violations on the most recent inspection for this carrier?"*
- *"Save this carrier to my pipeline with a follow-up note."*
- *"Generate a risk summary I can use on a sales call."*

Claude calls into this MCP server, which authenticates against your FlitIQ account
and proxies to the same FMCSA data sources (SAFER, L&I, SMS) the web and iOS apps use.

## Requirements

- An active **FlitIQ Pro or Team subscription** ([flitiq.com/pricing](https://flitiq.com/pricing))
- An **API key** generated at [flitiq.com/settings](https://flitiq.com/settings) (MCP keys section)
- Claude Desktop (or any MCP-compatible client)

## Install in Claude Desktop

1. Generate an API key at `https://flitiq.com/settings`
2. Edit Claude's config file:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
3. Add the FlitIQ MCP entry:

```json
{
  "mcpServers": {
    "flitiq": {
      "command": "npx",
      "args": ["-y", "github:smartlink-basics/flitiq-mcp"],
      "env": {
        "FLITIQ_API_KEY": "fliq_live_your_key_here"
      }
    }
  }
}
```

4. Restart Claude Desktop. Look for the FlitIQ tool listing in the bottom of the chat input.

## Available tools

| Tool | What it does | Plan required |
|---|---|---|
| `flitiq_search_carrier` | Search carriers by name, DOT, or MC. Returns up to 20 matches. | Pro / Team |
| `flitiq_get_safety` | CSA BASIC scores, OOS rates, safety rating, crash totals. | Pro / Team |
| `flitiq_get_insurance` | Active BIPD, cargo, trust policies — insurer name, policy #, coverage, cancel date. | Pro / Team |
| `flitiq_get_inspections` | Up to 50 most-recent inspections with OOS counts and violation count. | Pro / Team |
| `flitiq_get_crashes` | Up to 50 most-recent crashes with fatality and injury counts. | Pro / Team |
| `flitiq_get_authority` | Common, contract, and broker authority status per docket. | Pro / Team |
| `flitiq_save_carrier` | Add a carrier to the user's saved list with an optional note. | Pro / Team |

Every read tool is annotated `readOnlyHint: true`; `flitiq_save_carrier` is annotated
`destructiveHint: true` because it writes a row to the user's saved-carriers list.

## Examples

### Example 1 — Vet a carrier by DOT

**User prompt:** *"Look up DOT 21800 — what's their safety rating and insurance carrier?"*

**Expected behavior:**
- Calls `flitiq_get_safety` for DOT 21800
- Calls `flitiq_get_insurance` for DOT 21800
- Returns CSA BASIC percentiles, OOS rates, and the active BIPD/cargo insurer name + policy number
- Flags any BIPD coverage below the $750,000 federal minimum

### Example 2 — Find a carrier by name, then pull inspections

**User prompt:** *"Find a carrier called 'Pacific Logistics' in Oregon and show me the last 10 inspections."*

**Expected behavior:**
- Calls `flitiq_search_carrier` with `query="Pacific Logistics"`, `state="OR"`
- Returns up to 20 matches with DOT, legal name, city, fleet size
- After the user (or Claude) picks a DOT, calls `flitiq_get_inspections` and returns dates, states, levels, and OOS counts

### Example 3 — Save a carrier to the pipeline with a note

**User prompt:** *"Save DOT 80321 to my saved list with the note 'follow up next quarter — fleet expansion'."*

**Expected behavior:**
- Calls `flitiq_save_carrier` with `dot=80321` and the note string
- Returns `saved_carrier_id`, `already_saved: false`, and a link to view it on the FlitIQ web app
- If the carrier is already saved, returns `already_saved: true` with the existing record (idempotent)

## Privacy Policy

This MCP server sends API requests to FlitIQ's VPS to look up FMCSA carrier records.
No carrier data is retained by Claude or by this MCP package — every response is
served directly from FlitIQ to your local Claude session.

**Data collected by FlitIQ when you use this plugin:**
- Your FlitIQ user ID (resolved from the API key)
- The DOT numbers and search terms you query
- Timestamp and tool name (for rate-limiting and abuse prevention)

**Not collected:** the contents of your Claude conversation, prompts, or responses.

For complete data handling, retention, third-party sharing, CCPA/GDPR rights, and
contact information, see the full FlitIQ Privacy Policy at
[https://flitiq.com/privacy](https://flitiq.com/privacy).

## Support

- Email: [support@flitiq.com](mailto:support@flitiq.com)
- Issues: [github.com/smartlink-basics/flitiq-mcp/issues](https://github.com/smartlink-basics/flitiq-mcp/issues)

### What this plugin deliberately does NOT do

- No bulk export, CSV download, or list-all-carriers operation
- No `search_all` returning more than 20 carriers
- No raw FMCSA passthrough — every response is curated FlitIQ data
- No data scraping — per-carrier lookups only

This matches the FlitIQ Terms of Service ([Section 4](https://flitiq.com/terms)), which
prohibits bulk extraction of FMCSA data through any FlitIQ surface.

## Development

```bash
cp .env.example .env.local   # fill in Supabase + VPS creds
npm install
npm run dev                  # tsc --watch
npm run inspector            # smoke-test with MCP Inspector
```

## Data sources

The MCP server proxies through the FlitIQ VPS, which aggregates:

- FMCSA SAFER Company Snapshot (identity, address, fleet size, MCS-150)
- Licensing & Insurance (L&I) database via Socrata dataset `qh9u-swkp`
- Safety Measurement System (SMS) — CSA BASIC scores, inspections (`rbkj-cgst`),
  violations (`8mt8-2mdr`), crashes (`aayw-vxb3`)

Data is U.S. government public-record information. FlitIQ does not guarantee accuracy
or currency — see [Terms § 5](https://flitiq.com/terms).

FlitIQ is a product of SmartLink Basics, LLC.
