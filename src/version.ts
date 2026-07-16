import { createRequire } from "node:module";

// Single source of the running version — reads package.json so it can
// never drift from the published version (0.2.2 shipped announcing
// itself as "0.1.0"). dist/*.js → ../package.json resolves to the
// package root both in the repo and inside the installed npm package.
const require = createRequire(import.meta.url);
export const PKG_VERSION = (require("../package.json") as { version: string }).version;

/**
 * Latest published version from the npm registry, or null when the
 * lookup fails (offline, registry hiccup) — version awareness must
 * never block a tool call.
 */
export async function fetchLatestVersion(timeoutMs = 2500): Promise<string | null> {
  try {
    const resp = await fetch("https://registry.npmjs.org/@yroun/mcp/latest", {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/** True when `running` is older than `latest` (plain semver x.y.z compare). */
export function isBehind(running: string, latest: string): boolean {
  const a = running.split(".").map((n) => parseInt(n, 10));
  const b = latest.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/** One-line upgrade instruction shown to the user (via the LLM) when behind. */
export const UPGRADE_HINT =
  "Update: re-register the connector with `@yroun/mcp@latest` " +
  "(e.g. `claude mcp remove yroun && claude mcp add yroun -- npx -y @yroun/mcp@latest`), " +
  "then restart the client. A bare `@yroun/mcp` spec can stay pinned to npx's cached copy.";
