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
      "args": ["-y", "github:alsermeno/flitiq-mcp"],
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
| `flitiq_generate_risk_summary` | AI-generated risk summary + talking points (uses your Anthropic API key). | Pro / Team |

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
