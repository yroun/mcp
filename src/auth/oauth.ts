import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { CONFIG } from "../config.js";
import { clearTokens, loadTokens, saveTokens, type StoredTokens } from "./storage.js";

/**
 * OAuth 2.0 Authorization Code + PKCE (RFC 7636) against the Yroun
 * Authorization Server, using the RFC 8252 §7.3 loopback pattern:
 * bind an ephemeral 127.0.0.1 port, open the system browser at
 * /oauth/authorize, catch the redirect on /oauth/callback.
 *
 * Wire format mirrors the proven yroun extension client:
 *  - token + revoke are application/x-www-form-urlencoded
 *  - refresh is single-use rotated server-side — the new refresh_token
 *    from every response is persisted IMMEDIATELY (presenting a rotated
 *    refresh twice trips the server's replay cascade and kills the
 *    whole chain)
 *  - 60s expiry skew on access-token reuse
 */

const b64url = (buf: Buffer): string =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const resp = await fetch(`${CONFIG.oauthBase}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await resp.json().catch(() => null)) as
    | (TokenResponse & { error?: string; error_description?: string })
    | null;
  if (!resp.ok || !json?.access_token) {
    const detail = json?.error
      ? `${json.error}${json.error_description ? `: ${json.error_description}` : ""}`
      : `HTTP ${resp.status}`;
    throw new Error(`token request failed (${detail})`);
  }
  return json;
}

function persist(json: TokenResponse, fallbackRefresh?: string): StoredTokens {
  const tokens: StoredTokens = {
    access: json.access_token,
    // Rotation: server always issues a new refresh; keep the old one
    // only if (unexpectedly) none came back.
    refresh: json.refresh_token ?? fallbackRefresh ?? "",
    exp: Date.now() + (json.expires_in ?? 3600) * 1000,
    scope: json.scope,
  };
  saveTokens(tokens);
  return tokens;
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(cmd, args as string[], { stdio: "ignore", detached: true });
  child.on("error", (err) => {
    // Browser launch is best-effort — the URL is also printed for
    // manual copy, so log and continue rather than failing the flow.
    console.error(`[yroun-mcp] could not open browser automatically: ${err.message}`);
  });
  child.unref();
}

/**
 * Interactive sign-in. Resolves once the loopback callback delivers a
 * code and the token exchange succeeds; rejects on timeout/denial.
 * Returns the granted scope string for display.
 */
export async function interactiveSignIn(timeoutMs = 300_000): Promise<string> {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  return await new Promise<string>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== CONFIG.redirectPath) {
        res.writeHead(404).end();
        return;
      }
      const fail = (msg: string) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<html><body><p>Yroun sign-in failed: ${msg}. You can close this tab.</p></body></html>`);
        cleanup();
        reject(new Error(msg));
      };
      const err = url.searchParams.get("error");
      if (err) return fail(err);
      if (url.searchParams.get("state") !== state) return fail("state mismatch");
      const code = url.searchParams.get("code");
      if (!code) return fail("missing authorization code");

      try {
        const json = await tokenRequest(
          new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            client_id: CONFIG.clientId,
            code_verifier: verifier,
          }),
        );
        const stored = persist(json);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          "<html><body><p>Yroun connected. You can close this tab and return to your AI client.</p></body></html>",
        );
        cleanup();
        resolve(stored.scope ?? CONFIG.scopes.join(" "));
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
    });

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("sign-in timed out (no browser callback within 5 minutes)"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      server.close();
    };

    server.on("error", (e) => {
      cleanup();
      reject(e);
    });

    let redirectUri = "";
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      redirectUri = `http://127.0.0.1:${port}${CONFIG.redirectPath}`;
      const authorizeUrl =
        `${CONFIG.oauthBase}/oauth/authorize` +
        `?client_id=${encodeURIComponent(CONFIG.clientId)}` +
        `&response_type=code` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent(CONFIG.scopes.join(" "))}` +
        `&state=${state}` +
        `&code_challenge=${challenge}` +
        `&code_challenge_method=S256`;
      console.error(`[yroun-mcp] opening browser for sign-in: ${authorizeUrl}`);
      openBrowser(authorizeUrl);
    });
  });
}

// Single-flight refresh: concurrent tool calls must not both present
// the same (single-use) refresh token — the second would look like a
// replay and cascade-revoke the chain.
let refreshInFlight: Promise<StoredTokens> | null = null;

async function refreshTokens(current: StoredTokens): Promise<StoredTokens> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const json = await tokenRequest(
          new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: current.refresh,
            client_id: CONFIG.clientId,
          }),
        );
        return persist(json, current.refresh);
      } catch (err) {
        // A failed refresh (revoked / replay-cascaded / expired) means
        // this install is signed out — clear so the next call prompts
        // re-connect instead of looping on a dead token.
        clearTokens();
        throw new Error(
          `session expired — run the yroun_connect tool to sign in again (${err instanceof Error ? err.message : err})`,
        );
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

/** Valid access token or null when signed out. Refreshes within 60s of expiry. */
export async function getValidAccessToken(): Promise<string | null> {
  const tokens = loadTokens();
  if (!tokens) return null;
  if (Date.now() > tokens.exp - 60_000) {
    if (!tokens.refresh) {
      clearTokens();
      return null;
    }
    return (await refreshTokens(tokens)).access;
  }
  return tokens.access;
}

/** Force a refresh after a 401 (server-side revocation beats local expiry math). */
export async function forceRefresh(): Promise<string | null> {
  const tokens = loadTokens();
  if (!tokens?.refresh) return null;
  return (await refreshTokens(tokens)).access;
}

export function isSignedIn(): boolean {
  return loadTokens() != null;
}

/** RFC 7009 revoke (server revokes the whole user+client grant) + local wipe. */
export async function signOut(): Promise<void> {
  const tokens = loadTokens();
  if (tokens) {
    try {
      await fetch(`${CONFIG.oauthBase}/oauth/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: tokens.access,
          token_type_hint: "access_token",
          client_id: CONFIG.clientId,
        }),
      });
    } catch (err) {
      // Local wipe still proceeds — revoke is also available from
      // console.yroun.com/connections; log so the miss is visible.
      console.error(`[yroun-mcp] server-side revoke failed (tokens wiped locally anyway): ${err}`);
    }
  }
  clearTokens();
}
