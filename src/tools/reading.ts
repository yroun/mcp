import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest, publicRequest } from "../client/yroun-api.js";

/**
 * yroun_briefing_* and yroun_finance_* — the READING half of the connector.
 *
 * Every other tool here writes into something the user owns, which means the
 * first thing a new connection can do is nothing until a hub exists. These
 * read published market briefings and public market data, so the connector
 * is useful on the first call, before any hub, series or page.
 *
 * Two different surfaces on purpose:
 *
 *   * Editions are ANONYMOUS reads (`publicRequest`, /api/v1/briefings),
 *     the same shape the public series reads already use. They are the
 *     published record of a day and are served to anyone.
 *   * Stocks go through the user's own grant (`apiRequest`,
 *     /oapi/finance/stocks). That controller scopes nothing by caller and
 *     needs no extra scope -- it is public market data reached with the
 *     key the user already granted -- so these add no consent step and no
 *     new scope to the manifest.
 *
 * Deliberately NOT wrapped: the aggregate and slot routes (operational
 * shapes, not a reader's question), and every write path. Search comes
 * first among the stock tools because an agent holds a NAME, not a ticker.
 */

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
});

const run = async (fn: () => Promise<unknown>): Promise<ToolResult> => {
  try {
    return ok(await fn());
  } catch (err) {
    return {
      content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
      isError: true,
    };
  }
};

const enc = encodeURIComponent;
const READ = { readOnlyHint: true } as const;

const qs = (pairs: Array<[string, string | number | undefined]>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of pairs) if (value != null) params.set(key, String(value));
  const s = params.toString();
  return s ? `?${s}` : "";
};

export function registerReadingTools(server: McpServer): void {
  server.registerTool(
    "yroun_briefing_list_editions",
    {
      description:
        "List published daily market briefings, newest first. Each edition is one market's frozen record for one day (countryCode KR, US or JP). Cursor-paginated.",
      inputSchema: {
        countryCode: z.string().optional().describe("KR, US or JP; omit for every market"),
        cursor: z.string().optional().describe("nextCursor from the previous page"),
        limit: z.number().min(1).max(100).optional(),
      },
      annotations: READ,
    },
    async ({ countryCode, cursor, limit }) =>
      run(() =>
        publicRequest(
          `/api/v1/briefings/editions${qs([
            ["countryCode", countryCode],
            ["cursor", cursor],
            ["limit", limit],
          ])}`,
        ),
      ),
  );

  server.registerTool(
    "yroun_briefing_get_edition",
    {
      description:
        "One day's briefing for one market: the day's lead, the named movers, the cited stories and the market read. Date is YYYY-MM-DD. A day that was never published answers 404 rather than an empty document.",
      inputSchema: {
        countryCode: z.string().describe("KR, US or JP"),
        date: z.string().describe("YYYY-MM-DD"),
      },
      annotations: READ,
    },
    async ({ countryCode, date }) =>
      run(() => publicRequest(`/api/v1/briefings/editions/${enc(countryCode)}/${enc(date)}`)),
  );

  server.registerTool(
    "yroun_finance_search_stocks",
    {
      description:
        "Find a listed company by name or ticker. Start here when you hold a name rather than a symbol — every other stock tool takes the symbol this returns.",
      inputSchema: {
        q: z.string().describe("company name or ticker fragment"),
        country: z.string().optional().describe("KR, US or JP; defaults to KR"),
        limit: z.number().min(1).max(100).optional(),
      },
      annotations: READ,
    },
    async ({ q, country, limit }) =>
      run(() =>
        apiRequest(
          "GET",
          `/oapi/finance/stocks/search${qs([["q", q], ["country", country], ["limit", limit]])}`,
        ),
      ),
  );

  server.registerTool(
    "yroun_finance_get_stock",
    {
      description:
        "One company's current market state: price, day change, trading value and the descriptive tags it carries. Symbol comes from yroun_finance_search_stocks.",
      inputSchema: {
        symbol: z.string().describe("e.g. KR-000660"),
        lang: z.string().optional().describe("ko, en or ja; defaults to ko"),
      },
      annotations: READ,
    },
    async ({ symbol, lang }) =>
      run(() => apiRequest("GET", `/oapi/finance/stocks/${enc(symbol)}${qs([["lang", lang]])}`)),
  );

  server.registerTool(
    "yroun_finance_get_candles",
    {
      description:
        "Price history for one company, as OHLC candles. Use it to answer how a name has moved over a period rather than only where it stands today.",
      inputSchema: {
        symbol: z.string().describe("e.g. KR-000660"),
        range: z.string().optional().describe("server default when omitted"),
        interval: z.string().optional().describe("server default when omitted"),
      },
      annotations: READ,
    },
    async ({ symbol, range, interval }) =>
      run(() =>
        apiRequest(
          "GET",
          `/oapi/finance/stocks/${enc(symbol)}/candles${qs([["range", range], ["interval", interval]])}`,
        ),
      ),
  );
}
