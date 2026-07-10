import { createHash } from "node:crypto";

/**
 * Pure OAuth-flow building blocks — extracted from oauth.ts so the
 * security-sensitive assembly (PKCE derivation, authorize URL, expiry
 * skew, rotation persistence) is unit-testable without sockets,
 * browsers, or clocks. oauth.ts keeps only the I/O.
 */

export const b64url = (buf: Buffer): string =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** RFC 7636 §4.2 — code_challenge = BASE64URL(SHA256(ASCII(verifier))). */
export function challengeS256(verifier: string): string {
  return b64url(createHash("sha256").update(verifier, "ascii").digest());
}

export interface AuthorizeUrlParams {
  oauthBase: string;
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
  codeChallenge: string;
}

export function buildAuthorizeUrl(p: AuthorizeUrlParams): string {
  return (
    `${p.oauthBase}/oauth/authorize` +
    `?client_id=${encodeURIComponent(p.clientId)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(p.redirectUri)}` +
    `&scope=${encodeURIComponent(p.scopes.join(" "))}` +
    `&state=${p.state}` +
    `&code_challenge=${p.codeChallenge}` +
    `&code_challenge_method=S256`
  );
}

/** 60s-skew expiry decision — refresh BEFORE the server clock says no. */
export function isExpiringSoon(expMs: number, nowMs: number, skewMs = 60_000): boolean {
  return nowMs > expMs - skewMs;
}

export interface TokenGrant {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

export interface RotatedTokens {
  access: string;
  refresh: string;
  exp: number;
  scope?: string;
}

/**
 * Rotation persistence policy: the server issues a NEW refresh on every
 * grant (single-use rotation) — always adopt it; keep the previous
 * refresh only if (unexpectedly) none came back. Missing expires_in
 * falls back to the server's standard 1h.
 */
export function rotateTokens(grant: TokenGrant, nowMs: number, prevRefresh?: string): RotatedTokens {
  return {
    access: grant.access_token,
    refresh: grant.refresh_token ?? prevRefresh ?? "",
    exp: nowMs + (grant.expires_in ?? 3600) * 1000,
    scope: grant.scope,
  };
}
