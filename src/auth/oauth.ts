import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { CONFIG } from "../config.js";
import { b64url, buildAuthorizeUrl, challengeS256, isExpiringSoon, rotateTokens } from "./pkce.js";
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
  // Rotation policy is the pure rotateTokens (see its tests) — this
  // wrapper only supplies the clock and writes the file.
  const tokens: StoredTokens = rotateTokens(json, Date.now(), fallbackRefresh);
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
/**
 * Branded loopback-callback page. This is the last thing the user sees in
 * the OAuth flow, served from the connector's own ephemeral local server.
 * Styling mirrors the Yroun global design system (content pkgs/ui
 * global.css — auth-card, --yroun-blue #155cfb, --surface/--prime tokens,
 * Apple SD Gothic Neo stack) so the hop from accounts.yroun.com feels
 * seamless; tokens are inlined because this page has no bundle. The logo
 * is the same served asset the consent screen shows (best-effort — hidden
 * on load failure, page must render offline too). Escapes the error
 * message (it can echo server/user input).
 */
function callbackPage(ok: boolean, errorMsg?: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const title = ok ? "Connected" : "Sign-in failed";
  const icon = ok ? "✓" : "✕";
  const iconBg = ok ? "#155cfb" : "#ef4444"; // success = yroun-blue, not generic green
  const heading = ok ? "Yroun 연결 완료" : "Yroun 연결 실패";
  const body = ok
    ? "이 탭을 닫고 AI 클라이언트로 돌아가세요.<br>You're connected — close this tab and return to your AI client."
    : `${esc(errorMsg ?? "unknown error")}<br>이 탭을 닫고 다시 시도해 주세요. / Close this tab and try again.`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Yroun — ${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark;
    --yroun-blue:#155cfb; --surface:#ffffff; --prime:#0a1931; --sub:#71717a; --line:#e4e4e7; --bg:#ffffff; }
  @media (prefers-color-scheme: dark) {
    :root { --surface:#1c1f24; --prime:#f8fafc; --sub:#a1a1aa; --line:rgba(255,255,255,.08); --bg:#09090b; }
  }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font-family:'Apple SD Gothic Neo','Apple SD 산돌고딕 Neo',AppleSDGothicNeo-Regular,Helvetica,'Malgun Gothic','Nanum Gothic','맑은 고딕',dotum,sans-serif;
         background:var(--bg); color:var(--prime); }
  .card { background:var(--surface); border:1px solid var(--line); border-radius:16px;
          padding:40px 32px; text-align:center; max-width:420px; width:100%; margin:24px;
          box-shadow:0 1px 2px rgba(0,0,0,.05); }
  .logo { width:48px; height:48px; border-radius:12px; margin-bottom:12px; }
  .brand { font-weight:700; font-size:18px; letter-spacing:-.02em; margin-bottom:24px; color:var(--prime); }
  .icon { width:52px; height:52px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center;
          font-size:26px; font-weight:700; color:#fff; background:${iconBg}; margin-bottom:20px; }
  h1 { font-size:20px; font-weight:700; margin:0 0 10px; letter-spacing:-.01em; color:var(--prime); }
  .sub { font-size:14px; line-height:1.65; color:var(--sub); margin:0; }
</style></head><body>
<div class="card">
<img class="logo" src="https://assets.yroun.com/clients/yroun-mcp-logo.png" alt="" onerror="this.style.display='none'">
<div class="brand">Yroun</div><div class="icon">${icon}</div>
<h1>${heading}</h1><p class="sub">${body}</p></div>
</body></html>`;
}

export async function interactiveSignIn(timeoutMs = 300_000): Promise<string> {
  const verifier = b64url(randomBytes(32));
  const challenge = challengeS256(verifier);
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
        res.end(callbackPage(false, msg));
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
        res.end(callbackPage(true));
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
      const authorizeUrl = buildAuthorizeUrl({
        oauthBase: CONFIG.oauthBase,
        clientId: CONFIG.clientId,
        redirectUri,
        scopes: CONFIG.scopes,
        state,
        codeChallenge: challenge,
      });
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
  if (isExpiringSoon(tokens.exp, Date.now())) {
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
