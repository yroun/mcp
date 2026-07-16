import { describe, expect, it } from "vitest";
import { isBehind } from "./version.js";

describe("isBehind", () => {
  it("flags an older patch / minor / major", () => {
    expect(isBehind("0.2.2", "0.2.3")).toBe(true);
    expect(isBehind("0.2.9", "0.3.0")).toBe(true);
    expect(isBehind("0.9.9", "1.0.0")).toBe(true);
  });

  it("is false for equal or newer running versions", () => {
    expect(isBehind("0.2.3", "0.2.3")).toBe(false);
    expect(isBehind("0.3.0", "0.2.9")).toBe(false);
    expect(isBehind("1.0.0", "0.9.9")).toBe(false);
  });

  it("treats missing segments as 0", () => {
    expect(isBehind("0.2", "0.2.1")).toBe(true);
    expect(isBehind("0.2.0", "0.2")).toBe(false);
  });
});
