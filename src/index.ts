#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerHubTools } from "./tools/hub.js";
import { registerReadingTools } from "./tools/reading.js";
import { registerSeriesTools } from "./tools/series.js";
import { PKG_VERSION } from "./version.js";

/**
 * @yroun/mcp — the official Yroun MCP server.
 *
 * Exposes the Yroun Open API (hubs / pages / posts / schedules /
 * members) as tools for any MCP client (Claude Desktop, Claude Code,
 * Cursor, ...). Auth = OAuth 2.0 Authorization Code + PKCE against
 * oauth.yroun.com; the connector holds the token, the LLM never sees a
 * credential. stdout is the MCP transport — ALL logging goes to stderr.
 */
async function main(): Promise<void> {
  const server = new McpServer({ name: "yroun", version: PKG_VERSION });

  registerAuthTools(server);
  registerHubTools(server);
  registerSeriesTools(server);
  registerReadingTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[yroun-mcp] server ready (stdio)");
}

main().catch((err) => {
  console.error(`[yroun-mcp] fatal: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
  process.exit(1);
});
