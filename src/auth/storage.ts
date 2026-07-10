import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface StoredTokens {
  access: string;
  refresh: string;
  /** Epoch ms when the access token expires. */
  exp: number;
  scope?: string;
}

const DIR = join(homedir(), ".config", "yroun-mcp");
const FILE = join(DIR, "credentials.json");

/**
 * Token persistence — plain file, owner-only permissions (0600 file in
 * a 0700 dir), same posture as ~/.aws/credentials et al. The tokens
 * are user-revocable at any time from console.yroun.com/connections.
 */
export function loadTokens(): StoredTokens | null {
  try {
    if (!existsSync(FILE)) return null;
    const parsed = JSON.parse(readFileSync(FILE, "utf8"));
    if (typeof parsed?.access !== "string" || typeof parsed?.refresh !== "string") return null;
    return parsed as StoredTokens;
  } catch (err) {
    // Corrupt credentials == signed out; surface on stderr (stdout is
    // the MCP transport) so the state change is never silent.
    console.error(`[yroun-mcp] unreadable credentials file, treating as signed out: ${err}`);
    return null;
  }
}

export function saveTokens(tokens: StoredTokens): void {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  // writeFileSync mode only applies on create — enforce on overwrite too.
  chmodSync(FILE, 0o600);
}

export function clearTokens(): void {
  try {
    if (existsSync(FILE)) unlinkSync(FILE);
  } catch (err) {
    console.error(`[yroun-mcp] failed to delete credentials file: ${err}`);
    throw err;
  }
}
