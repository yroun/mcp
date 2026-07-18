# @yroun/mcp

The official [Model Context Protocol](https://modelcontextprotocol.io) server for [Yroun](https://www.yroun.com) — let Claude, Cursor, or any MCP client read and write your Hubs through natural language.

Auth is OAuth 2.0 (Authorization Code + PKCE): you sign in once in your browser, the connector holds the token, and your AI client never sees a credential. Revoke any time at [console.yroun.com/connections](https://console.yroun.com/connections).

## Install

### Claude Code

```bash
claude mcp add yroun -- npx -y @yroun/mcp@latest
```

### Claude Desktop

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "yroun": {
      "command": "npx",
      "args": ["-y", "@yroun/mcp@latest"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "yroun": {
      "command": "npx",
      "args": ["-y", "@yroun/mcp@latest"]
    }
  }
}
```

## Updating & version check

The `@latest` spec above makes `npx` re-resolve the newest published release on every
launch — installs that use it stay current automatically. A bare `@yroun/mcp` spec
(the pre-0.2.3 instruction) can stay **pinned to npx's cached copy indefinitely**; if
you installed that way, re-register once with the `@latest` command above.

To see what you're running, ask your AI client to run **`yroun_auth_status`** — it
reports the connector version and flags it when a newer release exists.

Still on an old version after re-registering with `@latest`? Two known causes:
npm's supply-chain guard `min-release-age` (pnpm: `minimumReleaseAge`) holds back
releases younger than N days — check `npm config get min-release-age`, and register
with an explicit version (`npx -y @yroun/mcp@x.y.z`) when you need a fresh release
immediately; or a stale npx cache — `npx clear-npx-cache`, then relaunch.

## First run

Ask your AI client to run the **`yroun_connect`** tool. Your browser opens, you sign in to Yroun and approve the requested permissions, and the connector is ready. The grant persists across sessions.

## Tools (v0.2)

| Tool | What it does |
|---|---|
| `yroun_connect` / `yroun_auth_status` / `yroun_sign_out` | Connection lifecycle |
| `yroun_hub_list` / `yroun_hub_get` | Discover your hubs |
| `yroun_hub_list_pages` / `yroun_hub_get_page` | Page tree (semantic index) + page bodies |
| `yroun_hub_create_page` / `yroun_hub_update_page` / `yroun_hub_delete_page` | Write pages — plain text is auto-converted to the page document format; deletes are soft (recoverable) |
| `yroun_hub_list_posts` / `yroun_hub_get_post` / `yroun_hub_create_post` / `yroun_hub_update_post` / `yroun_hub_delete_post` | Hub posts |
| `yroun_hub_list_schedules` / `yroun_hub_upsert_schedule` | Calendar schedules (idempotent upsert by `externalId`) |
| `yroun_hub_list_members` | Member roster |
| `yroun_series_list` / `yroun_series_create` / `yroun_series_delete` | Serialized fiction in a hub |
| `yroun_series_get` / `yroun_series_get_bible` / `yroun_series_list_episodes` / `yroun_series_get_episode` | Read the current state — catalog+cast, story bible, episode list, episode text (plain prose, round-trips with upsert). Start revision / replanning sessions here |
| `yroun_series_upsert_episode` / `yroun_series_add_episode` | Write episodes (plain text auto-converted to the episode document format; upsert by number is idempotent) |
| `yroun_series_set_bible` / `yroun_series_set_cast` | Story bible (worldview, beats, foreshadowing) + character cast |
| `yroun_series_update_status` / `yroun_series_set_pen_name` | Lifecycle status + public byline |

List/get tools carry the MCP `readOnlyHint` annotation, so clients can distinguish reads from writes.

Requests are metered by your Yroun plan's unified credit pool (the same meter as API keys); when the pool is exhausted the tools report when it refills.

## Scopes

v0.2 requests `hub.read hub.write posts.read posts.write series.read series.write`. Mate tools (and their scopes) arrive in a later release. If you connected on v0.1, the next authorize shows a one-time delta-consent prompt for the series scopes.

## Capability boundary

This connector ships **end-user capabilities only**. Everything it can do, it does as *you* — with your own OAuth grant against the public Open API (`/oapi/**`) plus anonymous public reader endpoints. Admin/operations functionality (showcase curation, ecosystem stats, moderation, provisioning) and privileged credential classes or channels (`X-API-Key`, `/internal/**`, `/ctrl/**`, admin paths) are out of scope by principle and must never be added here — server-side gating is necessary but not sufficient; the distributable's tool surface itself is the boundary. `src/boundary.test.ts` enforces this mechanically: the test suite (and therefore `prepublishOnly`) fails if a privileged path or credential class appears in shipped source.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `YROUN_API_BASE` | `https://api.yroun.com` | Resource server |
| `YROUN_OAUTH_BASE` | `https://oauth.yroun.com` | Authorization server |

Credentials are stored at `~/.config/yroun-mcp/credentials.json` (owner-only permissions).

## Development

```bash
npm install
npm run build   # tsc → dist/
node dist/index.js   # stdio MCP server
```

## License

MIT
