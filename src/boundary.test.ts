import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Capability-boundary gate — this connector is distributed to END USERS and
 * must ship end-user capabilities only: the user's own OAuth grant against
 * /oapi/** plus anonymous public reader endpoints. Admin/ops features,
 * privileged credential classes, and privileged server channels must never
 * appear here, regardless of server-side gating (which is necessary but not
 * sufficient — the distributable's surface itself is the boundary).
 * Canonical: README "Capability boundary" + ops/principles.md 2026-07-18.
 */

const SRC_ROOT = join(__dirname);

// Privileged paths / credential classes that must never appear in shipped code.
const BANNED = [
  { pattern: /\/internal\//, why: "service-to-service channel (server-main <-> server-oauth only)" },
  { pattern: /\/ctrl\//, why: "sudo worker control channel" },
  { pattern: /\/admin/, why: "admin endpoint path" },
  { pattern: /X-API-Key/i, why: "API-key credential class — the connector holds only the user's OAuth token" },
  { pattern: /isvctoken/i, why: "internal service token header" },
  { pattern: /is_?sudo/i, why: "sudo capability marker" },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    if (!p.endsWith(".ts") || p.endsWith(".test.ts")) return [];
    return [p];
  });
}

// Strip comments so prose mentions (e.g. docs explaining what we DON'T do)
// never false-positive; only executable source is scanned. `//` after a `:`
// is a URL scheme separator, not a comment.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("capability boundary — end-user surface only", () => {
  const files = walk(SRC_ROOT);

  it("scans a non-empty source tree", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file.slice(SRC_ROOT.length + 1)} contains no privileged path or credential class`, () => {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const { pattern, why } of BANNED) {
        const match = code.match(pattern);
        expect(
          match,
          `${pattern} found ("${match?.[0]}") — ${why}. The MCP ships end-user capabilities only; see README "Capability boundary".`,
        ).toBeNull();
      }
    });
  }
});
