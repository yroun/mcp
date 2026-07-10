import { describe, expect, test } from "vitest";
import { b64url, buildAuthorizeUrl, challengeS256, isExpiringSoon, rotateTokens } from "./pkce.js";

describe("challengeS256", () => {
  test("matches the RFC 7636 appendix B reference vector", () => {
    // verifier/challenge pair straight from the spec — pins both the
    // hash input encoding (ASCII) and the base64url form (no padding).
    expect(challengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  test("b64url output never carries padding or +/ characters", () => {
    // 0xfb 0xff... maximizes '+'/'/' likelihood in plain base64.
    const encoded = b64url(Buffer.from([0xfb, 0xff, 0xfe, 0xfd, 0xfc]));
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

describe("buildAuthorizeUrl", () => {
  test("assembles every required OAuth param with encoding", () => {
    const url = new URL(
      buildAuthorizeUrl({
        oauthBase: "https://oauth.yroun.com",
        clientId: "yroun-mcp",
        redirectUri: "http://127.0.0.1:52341/oauth/callback",
        scopes: ["hub.read", "hub.write"],
        state: "st4te",
        codeChallenge: "ch4llenge",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://oauth.yroun.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("yroun-mcp");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:52341/oauth/callback");
    expect(url.searchParams.get("scope")).toBe("hub.read hub.write");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("code_challenge")).toBe("ch4llenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("isExpiringSoon", () => {
  const exp = 1_000_000;
  test.each([
    ["well before the skew window", exp - 120_000, false],
    ["exactly at the skew boundary", exp - 60_000, false],
    ["inside the skew window", exp - 59_999, true],
    ["already expired", exp + 1, true],
  ])("%s -> %s", (_label, now, expected) => {
    expect(isExpiringSoon(exp, now as number)).toBe(expected);
  });
});

describe("rotateTokens", () => {
  const now = 1_700_000_000_000;

  test("adopts the rotated refresh token — presenting the old one again would kill the chain", () => {
    const out = rotateTokens(
      { access_token: "a2", refresh_token: "r2", expires_in: 3600 },
      now,
      "r1",
    );
    expect(out.refresh).toBe("r2");
    expect(out.exp).toBe(now + 3_600_000);
  });

  test("keeps the previous refresh only when the grant carries none", () => {
    const out = rotateTokens({ access_token: "a2" }, now, "r1");
    expect(out.refresh).toBe("r1");
  });

  test("no refresh anywhere degrades to empty string, and expires_in defaults to 1h", () => {
    const out = rotateTokens({ access_token: "a2" }, now);
    expect(out.refresh).toBe("");
    expect(out.exp).toBe(now + 3_600_000);
  });
});
