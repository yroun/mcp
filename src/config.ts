/**
 * Endpoint + client configuration. Env-overridable so the same build
 * runs against a local stack (API_BASE http://127.0.0.1:8080) without
 * code changes — values here are the production defaults.
 */
export const CONFIG = {
  /** Resource server — all /oapi calls. */
  apiBase: process.env.YROUN_API_BASE ?? "https://api.yroun.com",
  /** Authorization server — /oauth/authorize, /oauth/token, /oauth/revoke, /oauth/userinfo. */
  oauthBase: process.env.YROUN_OAUTH_BASE ?? "https://oauth.yroun.com",
  /** Registered first-party public client (PKCE-only, no secret). */
  clientId: "yroun-mcp",
  /**
   * Scopes match the shipped tool surface: hub + posts (v0.1) and
   * series authoring (v0.2, founder 2026-07-10). The seeded client also
   * allows mate scopes — requested only when mate tools ship, so the
   * consent screen always matches actual capabilities. Users connected
   * before a scope was added get a one-time delta-consent re-prompt.
   */
  scopes: ["hub.read", "hub.write", "posts.read", "posts.write", "series.read", "series.write"],
  // Loopback redirect. The registered pattern is
  // `http://127.0.0.1:<any port>/oauth/callback` (RFC 8252 §7.3) —
  // host MUST be the 127.0.0.1 literal and path MUST be /oauth/callback.
  redirectPath: "/oauth/callback",
} as const;
