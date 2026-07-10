import { describe, expect, test } from "vitest";
import { describeApiError } from "./yroun-api.js";

// L1 — server-error → tool-error mapping. The message is the agent's
// remedy surface (cause + what-to-do), so its shape is pinned.
describe("describeApiError", () => {
  test("named server error carries its type and message with the call site", () => {
    const d = describeApiError(
      403,
      { error: "FORBIDDEN", errorMessage: "API key does not own hub: abc" },
      "GET",
      "/oapi/hubs/abc",
    );
    expect(d.errorType).toBe("FORBIDDEN");
    expect(d.message).toBe("FORBIDDEN: API key does not own hub: abc (GET /oapi/hubs/abc)");
  });

  test("429 appends the credit-refill remedy", () => {
    const d = describeApiError(429, { error: "TOO_MANY_REQUESTS", errorMessage: "weekly pool empty" }, "POST", "/oapi/hubs/x/posts");
    expect(d.message).toContain("credit pool exhausted");
    expect(d.message).toContain("console.yroun.com/usage");
  });

  test("unparseable body degrades to HTTP_<status>, never throws", () => {
    const d = describeApiError(502, null, "GET", "/oapi/hubs");
    expect(d.errorType).toBe("HTTP_502");
    expect(d.message).toBe("HTTP_502: request failed with HTTP 502 (GET /oapi/hubs)");
  });
});
