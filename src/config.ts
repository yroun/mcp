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
   * Scopes for v0.1 (hub + posts tools). The seeded client also allows
   * mate/series scopes — requested only when those tools ship (P2),
   * so today's consent screen matches today's capabilities.
   */
  scopes: ["hub.read", "hub.write", "posts.read", "posts.write"],
  // Loopback redirect. The registered pattern is
  // `http://127.0.0.1:<any port>/oauth/callback` (RFC 8252 §7.3) —
  // host MUST be the 127.0.0.1 literal and path MUST be /oauth/callback.
  redirectPath: "/oauth/callback",
} as const;
