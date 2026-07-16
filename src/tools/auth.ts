import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CONFIG } from "../config.js";
import { getValidAccessToken, interactiveSignIn, isSignedIn, signOut } from "../auth/oauth.js";
import { PKG_VERSION, UPGRADE_HINT, fetchLatestVersion, isBehind } from "../version.js";

/**
 * Connection lifecycle tools. yroun_connect is the ONE entry point that
 * opens a browser (explicit user-visible action — other tools never
 * do); everything else answers or cleans up.
 */

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const text = (t: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: t }],
  ...(isError ? { isError: true } : {}),
});

export function registerAuthTools(server: McpServer): void {
  server.registerTool(
    "yroun_connect",
    {
      description:
        "Sign in to Yroun. Opens the system browser for OAuth authorization (sign-in + consent) " +
        "and waits for completion. Run this once before the yroun_hub_* tools; the grant persists " +
        "across sessions and is revocable at console.yroun.com/connections.",
      inputSchema: {},
    },
    async () => {
      if (isSignedIn()) {
        return text("Already connected. Run yroun_sign_out first if you want to re-authorize.");
      }
      try {
        const scope = await interactiveSignIn();
        return text(`Connected to Yroun (scopes: ${scope}). The yroun_hub_* tools are ready.`);
      } catch (err) {
        return text(
          `Sign-in failed: ${err instanceof Error ? err.message : err}. ` +
            "Make sure a browser window opened (the URL is also printed in the MCP server log) and try again.",
          true,
        );
      }
    },
  );

  server.registerTool(
    "yroun_auth_status",
    {
      description:
        "Check whether this machine is connected to Yroun (and as which account), plus the " +
        "connector version and whether a newer @yroun/mcp release is available.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      // Version line first — it must render even when not connected, so a
      // stale connector is diagnosable before sign-in.
      const latest = await fetchLatestVersion();
      let versionLine = `Connector version: ${PKG_VERSION}`;
      if (latest && isBehind(PKG_VERSION, latest)) {
        versionLine += ` — OUTDATED, latest is ${latest}. ${UPGRADE_HINT}`;
      } else if (latest) {
        versionLine += ` (latest)`;
      }

      const token = await getValidAccessToken().catch(() => null);
      if (!token) {
        return text(`Not connected. Run the yroun_connect tool to sign in.\n${versionLine}`);
      }
      try {
        const resp = await fetch(`${CONFIG.oauthBase}/oauth/userinfo`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) {
          return text(`Connected, but userinfo returned HTTP ${resp.status}.\n${versionLine}`, true);
        }
        const info = (await resp.json()) as { name?: string; preferred_username?: string; email?: string };
        return text(
          `Connected as ${info.name ?? info.preferred_username ?? "unknown"}` +
            (info.email ? ` (${info.email})` : "") +
            `\n${versionLine}`,
        );
      } catch (err) {
        return text(`Connected locally, but the status check failed: ${err}\n${versionLine}`, true);
      }
    },
  );

  server.registerTool(
    "yroun_sign_out",
    {
      description:
        "Disconnect from Yroun: revokes this connector's tokens server-side and deletes local credentials.",
      inputSchema: {
        confirm: z.literal(true).describe("Pass true to confirm sign-out"),
      },
    },
    async () => {
      await signOut();
      return text("Signed out — tokens revoked and local credentials deleted.");
    },
  );
}
