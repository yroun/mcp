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

  if (!resp.ok) {
    const errBody = (await resp.json().catch(() => null)) as ErrorBody | null;
    const d = describeApiError(resp.status, errBody, method, path);
    throw new YrounApiError(resp.status, d.errorType, d.message);
  }

  // 204 and empty-200 bodies both parse to undefined — some write
  // endpoints answer with no payload; JSON.parse("") must never be the
  // thing that fails an otherwise-successful call (Postel).
  const text = await resp.text();
  return (text.trim() ? JSON.parse(text) : undefined) as T;
}

export interface ErrorBody {
  error?: string;
  errorMessage?: string;
}

/**
 * Pure server-error → tool-error mapping ({error, errorMessage} is the
 * documented /oapi failure shape). Kept pure + tested: the message IS
 * the agent's remedy surface — cause + what-to-do, per the API-error
 * house rule.
 */
export function describeApiError(
  status: number,
  errBody: ErrorBody | null,
  method: string,
  path: string,
): { errorType: string; message: string } {
  const errorType = errBody?.error ?? `HTTP_${status}`;
  let message = errBody?.errorMessage ?? `request failed with HTTP ${status}`;
  if (status === 429) {
    message = `credit pool exhausted: ${message} — credits refill on the plan schedule; see console.yroun.com/usage`;
  }
  return { errorType, message: `${errorType}: ${message} (${method} ${path})` };
}
