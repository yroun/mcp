import { CONFIG } from "../config.js";
import { forceRefresh, getValidAccessToken } from "../auth/oauth.js";

/**
 * Thin authenticated wrapper over the Yroun Open API (/oapi/**).
 * Token in `Authorization: Bearer` (the OapiAuthenticationFilter
 * checks Bearer before X-API-Key); one refresh-and-retry on 401;
 * every non-OK response becomes a thrown Error carrying the server's
 * {error, errorMessage} shape so tool output states cause + remedy.
 */

export class YrounApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorType: string,
    message: string,
  ) {
    super(message);
  }
}

export class NotConnectedError extends Error {
  constructor() {
    super("Not connected to Yroun — run the yroun_connect tool to sign in first.");
  }
}

async function doFetch(path: string, init: RequestInit, token: string): Promise<Response> {
  return fetch(`${CONFIG.apiBase}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

export async function apiRequest<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  let token = await getValidAccessToken();
  if (!token) throw new NotConnectedError();

  const init: RequestInit = { method, body: body != null ? JSON.stringify(body) : undefined };
  let resp = await doFetch(path, init, token);

  if (resp.status === 401) {
    // Local expiry math can lag server-side state (revocation, clock) —
    // one forced refresh, one retry, then give up loudly.
    token = await forceRefresh();
    if (!token) throw new NotConnectedError();
    resp = await doFetch(path, init, token);
  }

  if (resp.status === 204) return undefined as T;

  if (!resp.ok) {
    const errBody = (await resp.json().catch(() => null)) as {
      error?: string;
      errorMessage?: string;
    } | null;
    const errorType = errBody?.error ?? `HTTP_${resp.status}`;
    let message = errBody?.errorMessage ?? `request failed with HTTP ${resp.status}`;
    if (resp.status === 429) {
      message = `credit pool exhausted: ${message} — credits refill on the plan schedule; see console.yroun.com/usage`;
    }
    throw new YrounApiError(resp.status, errorType, `${errorType}: ${message} (${method} ${path})`);
  }

  return (await resp.json()) as T;
}
