import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest, publicRequest } from "../client/yroun-api.js";
import { tiptapContentToPlainText, toTiptapContentString } from "../tiptap.js";

/**
 * yroun_series_* tools — serialized-fiction authoring over
 * /oapi/hubs/{hubUid}/series*. Episode `content` is stored as a Tiptap
 * document JSON string (same standard as hub pages — the www reader
 * parses it unconditionally); plain prose input is auto-wrapped, a full
 * Tiptap doc passes through. v0.2 shipped these tools sending raw
 * prose, which fell to the reader's parse-fallback — fixed 2026-07-11.
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

export function registerSeriesTools(server: McpServer): void {
  server.registerTool(
    "yroun_series_list",
    {
      description: "List a hub's series (title, format, status, episode count). Cursor-paginated.",
      inputSchema: {
        hubUid: z.string(),
        cursor: z.number().optional().describe("nextCursor from the previous page"),
        limit: z.number().min(1).max(100).optional(),
      },
      annotations: READ,
    },
    async ({ hubUid, cursor, limit }) =>
      run(() => {
        const params = new URLSearchParams();
        if (cursor != null) params.set("cursor", String(cursor));
        if (limit != null) params.set("limit", String(limit));
        const qs = params.toString();
        return apiRequest("GET", `/oapi/hubs/${enc(hubUid)}/series${qs ? `?${qs}` : ""}`);
      }),
  );

  server.registerTool(
    "yroun_series_get",
    {
      description:
        "Read one series in full — catalog (title, synopsis, genre, status) + cast. " +
        "Start a revision/replanning session here so edits build on the current state.",
      inputSchema: { seriesUid: z.string() },
      annotations: READ,
    },
    async ({ seriesUid }) => run(() => publicRequest(`/api/v1/series/${enc(seriesUid)}`)),
  );

  server.registerTool(
    "yroun_series_get_bible",
    {
      description:
        "Read the series story bible — worldview, theme, message, planned beats, foreshadowing, " +
        "ending. Read this BEFORE yroun_series_set_bible: set replaces what's stored.",
      // Authenticated like set_bible: the bible is the author's plan (ending,
      // beats, foreshadowing), not reader data — the old anonymous
      // /api/v1/series/{uid}/bible read is being gated server-side.
      inputSchema: { hubUid: z.string(), seriesUid: z.string() },
      annotations: READ,
    },
    async ({ hubUid, seriesUid }) =>
      run(
        async () =>
          (await apiRequest("GET", `/oapi/hubs/${enc(hubUid)}/series/${enc(seriesUid)}/bible`)) ??
          "No bible set yet.",
      ),
  );

  server.registerTool(
    "yroun_series_list_episodes",
    {
      description:
        "List a series' episodes (number, title, uid, word count) — no bodies. " +
        "Fetch a body with yroun_series_get_episode.",
      inputSchema: { seriesUid: z.string() },
      annotations: READ,
    },
    async ({ seriesUid }) => run(() => publicRequest(`/api/v1/series/${enc(seriesUid)}/episodes`)),
  );

  server.registerTool(
    "yroun_series_get_episode",
    {
      description:
        "Read one episode's full text (episodeUid from yroun_series_list_episodes). Returns plain " +
        "prose with blank-line paragraph breaks — the same shape upsert accepts, so read → edit → " +
        "yroun_series_upsert_episode round-trips cleanly.",
      inputSchema: { episodeUid: z.string() },
      annotations: READ,
    },
    async ({ episodeUid }) =>
      run(async () => {
        const ep = await publicRequest<{ content?: string } & Record<string, unknown>>(
          `/api/v1/series/episodes/${enc(episodeUid)}`,
        );
        return { ...ep, content: tiptapContentToPlainText(ep.content ?? "") };
      }),
  );

  server.registerTool(
    "yroun_series_create",
    {
      description:
        "Create a series in a hub. Returns the series (note its uid for episode/bible/cast tools).",
      inputSchema: {
        hubUid: z.string(),
        title: z.string(),
        synopsis: z.string().describe("Short pitch shown on the series card"),
        format: z.string().optional().describe('Content format, default "NOVEL"'),
        genre: z.string().optional(),
        publicationType: z.string().optional().describe('"SERIAL" (default) or one-shot style'),
        countryCode: z.string().optional().describe('Market/language: "KR" (default), "US", "JP"'),
        authorPenName: z
          .string()
          .optional()
          .describe("Public byline; omit to fall back to the author's @handle"),
        writingStyle: z.string().optional(),
        coverImageUrl: z.string().optional(),
      },
    },
    async ({ hubUid, format, ...body }) =>
      run(() =>
        apiRequest("POST", `/oapi/hubs/${enc(hubUid)}/series`, {
          format: format ?? "NOVEL",
          ...body,
        }),
      ),
  );

  server.registerTool(
    "yroun_series_delete",
    {
      description: "Delete a series (soft delete).",
      inputSchema: { hubUid: z.string(), seriesUid: z.string() },
    },
    async ({ hubUid, seriesUid }) =>
      run(async () => {
        await apiRequest("DELETE", `/oapi/hubs/${enc(hubUid)}/series/${enc(seriesUid)}`);
        return { deleted: true, seriesUid };
      }),
  );

  server.registerTool(
    "yroun_series_upsert_episode",
    {
      description:
        "Write or overwrite one episode by number (idempotent — safe to re-run while drafting). " +
        "content may be plain prose (auto-converted to the episode document format) or a full Tiptap doc JSON.",
      inputSchema: {
        hubUid: z.string(),
        seriesUid: z.string(),
        episodeNum: z.number().int().min(1),
        title: z.string(),
        content: z.string().describe("Full episode prose (or Tiptap doc JSON)"),
      },
    },
    async ({ hubUid, seriesUid, episodeNum, title, content }) =>
      run(() =>
        apiRequest(
          "PUT",
          `/oapi/hubs/${enc(hubUid)}/series/${enc(seriesUid)}/episodes/${episodeNum}`,
          { title, content: toTiptapContentString(content) },
        ),
      ),
  );

  server.registerTool(
    "yroun_series_add_episode",
    {
      description:
        "Append the NEXT episode (server assigns the number). Prefer yroun_series_upsert_episode " +
        "when you know the episode number. content may be plain prose (auto-converted) or Tiptap doc JSON.",
      inputSchema: {
        hubUid: z.string(),
        seriesUid: z.string(),
        title: z.string(),
        content: z.string().describe("Full episode prose (or Tiptap doc JSON)"),
      },
    },
    async ({ hubUid, seriesUid, title, content }) =>
      run(() =>
        apiRequest("POST", `/oapi/hubs/${enc(hubUid)}/series/${enc(seriesUid)}/episodes`, {
          title,
          content: toTiptapContentString(content),
        }),
      ),
  );

  server.registerTool(
    "yroun_series_set_bible",
    {
      description:
        "Set the series story bible — worldview, theme, planned beats, foreshadowing. " +
        "The bible steers episode planning; all fields optional.",
      inputSchema: {
        hubUid: z.string(),
        seriesUid: z.string(),
        worldview: z.string().optional(),
        eraSetting: z.string().optional(),
        theme: z.string().optional(),
        message: z.string().optional(),
        toneManner: z.string().optional(),
        totalChapters: z.number().int().optional(),
        ending: z.string().optional().describe("Planned ending direction"),
        centralConflict: z.string().optional(),
        beats: z
          .array(z.object({ chapter: z.number().int(), goal: z.string() }))
          .optional()
          .describe("Per-chapter goals"),
        foreshadowing: z
          .array(z.object({ setup: z.string(), payoffChapter: z.number().int().optional() }))
          .optional(),
        referenceWorks: z.string().optional(),
        writingStyleRef: z.string().optional(),
      },
    },
    async ({ hubUid, seriesUid, ...body }) =>
      run(async () => {
        const payload: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(body)) if (v !== undefined) payload[k] = v;
        await apiRequest("PUT", `/oapi/hubs/${enc(hubUid)}/series/${enc(seriesUid)}/bible`, payload);
        return { updated: true, seriesUid, fields: Object.keys(payload) };
      }),
  );

  server.registerTool(
    "yroun_series_set_cast",
    {
      description: "Set the series character cast (REPLACES the whole cast list).",
      inputSchema: {
        hubUid: z.string(),
        seriesUid: z.string(),
        cast: z.array(
          z.object({
            name: z.string(),
            role: z.string().describe("e.g. protagonist, antagonist, support"),
            description: z.string(),
            traits: z.array(z.string()).optional(),
          }),
        ),
      },
    },
    async ({ hubUid, seriesUid, cast }) =>
      run(() =>
        apiRequest("PUT", `/oapi/hubs/${enc(hubUid)}/series/${enc(seriesUid)}/cast`, { cast }),
      ),
  );

  server.registerTool(
    "yroun_series_update_status",
    {
      description: 'Update series lifecycle status (e.g. "ONGOING", "COMPLETED", "HIATUS").',
      inputSchema: {
        hubUid: z.string(),
        seriesUid: z.string(),
        status: z.string(),
      },
    },
    async ({ hubUid, seriesUid, status }) =>
      run(async () => {
        await apiRequest("PATCH", `/oapi/hubs/${enc(hubUid)}/series/${enc(seriesUid)}/status`, {
          status,
        });
        return { updated: true, seriesUid, status };
      }),
  );

  server.registerTool(
    "yroun_series_set_pen_name",
    {
      description:
        "Set or clear the series pen name (public byline). Omit penName to clear — the byline " +
        "then falls back to the author's @handle.",
      inputSchema: {
        hubUid: z.string(),
        seriesUid: z.string(),
        penName: z.string().optional(),
      },
    },
    async ({ hubUid, seriesUid, penName }) =>
      run(async () => {
        await apiRequest("PATCH", `/oapi/hubs/${enc(hubUid)}/series/${enc(seriesUid)}/pen-name`, {
          penName: penName ?? null,
        });
        return { updated: true, seriesUid, penName: penName ?? null };
      }),
  );
}
