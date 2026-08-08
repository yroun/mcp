import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest } from "../client/yroun-api.js";
import { toTiptapContentString } from "../tiptap.js";

/**
 * yroun_hub_* tools — 1:1 over the public /oapi/hubs surface.
 * Every hub-scoped tool takes hubUid first (explicit beats implicit);
 * list/get tools carry readOnlyHint so clients can render the
 * read-vs-write distinction.
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

export function registerHubTools(server: McpServer): void {
  // ── Discovery ────────────────────────────────────────────────────────

  server.registerTool(
    "yroun_hub_list",
    {
      description:
        "List the Yroun hubs this account can act on (uid, name, type, description, member count). " +
        "Start here to discover a hubUid — every other tool needs one. Cursor-paginated.",
      inputSchema: {
        q: z.string().optional().describe("Filter by hub name (substring, case-insensitive)"),
        cursor: z.number().optional().describe("nextCursor from the previous page"),
        limit: z.number().min(1).max(100).optional().describe("Page size, default 20"),
      },
      annotations: READ,
    },
    async ({ q, cursor, limit }) =>
      run(() => {
        const params = new URLSearchParams();
        if (q) params.set("q", q);
        if (cursor != null) params.set("cursor", String(cursor));
        if (limit != null) params.set("limit", String(limit));
        const qs = params.toString();
        return apiRequest("GET", `/oapi/hubs${qs ? `?${qs}` : ""}`);
      }),
  );

  server.registerTool(
    "yroun_hub_get",
    {
      description: "Get one hub's metadata (name, handle, description, visibility, member count).",
      inputSchema: { hubUid: z.string().describe("Hub uid (32-char hex)") },
      annotations: READ,
    },
    async ({ hubUid }) => run(() => apiRequest("GET", `/oapi/hubs/${enc(hubUid)}`)),
  );

  // ── Pages ────────────────────────────────────────────────────────────

  server.registerTool(
    "yroun_hub_list_pages",
    {
      description:
        "List a hub's pages as a tree: uid, title, description, parentUid, children. " +
        "Body content is omitted by design — the list is the semantic index; " +
        "fetch one page's body with yroun_hub_get_page.",
      inputSchema: { hubUid: z.string() },
      annotations: READ,
    },
    async ({ hubUid }) => run(() => apiRequest("GET", `/oapi/hubs/${enc(hubUid)}/pages`)),
  );

  server.registerTool(
    "yroun_hub_get_page",
    {
      description:
        "Get one page including its body. `content` is a Tiptap document JSON string " +
        "(parse it to read; paragraphs hold the text).",
      inputSchema: { hubUid: z.string(), pageUid: z.string() },
      annotations: READ,
    },
    async ({ hubUid, pageUid }) =>
      run(() => apiRequest("GET", `/oapi/hubs/${enc(hubUid)}/pages/${enc(pageUid)}`)),
  );

  server.registerTool(
    "yroun_hub_create_page",
    {
      description:
        "Create a page (optionally under a parent) and set its title/content in one step. " +
        "Content may be plain text (auto-converted to the page document format) or a full Tiptap doc JSON.",
      inputSchema: {
        hubUid: z.string(),
        title: z.string().describe("Page title"),
        content: z.string().optional().describe("Plain text or Tiptap doc JSON"),
        description: z
          .string()
          .optional()
          .describe("One-line semantic summary shown in page listings (agents navigate by it)"),
        parentPageUid: z.string().optional().describe("Parent page uid for a subpage"),
      },
    },
    async ({ hubUid, title, content, description, parentPageUid }) =>
      run(async () => {
        // The API creates blank (POST takes only parentPageUid), then
        // fields are set via update — one tool call wraps both steps.
        const page = await apiRequest<{ uid: string }>("POST", `/oapi/hubs/${enc(hubUid)}/pages`, {
          parentPageUid,
        });
        const update: Record<string, unknown> = { title };
        if (content != null) update.content = toTiptapContentString(content);
        if (description != null) update.description = description;
        // PUT answers 200 { warnings } (2026-08-08; older servers 204 →
        // undefined). Warnings are advisory widget-auth feedback — e.g. a
        // connectionRef naming no live connection, or a per-viewer 'shared'
        // key config. Surfacing them here is the whole point: the agent that
        // wrote the widget is the one who can fix it.
        const res = await apiRequest<{ warnings?: string[] } | undefined>(
          "PUT",
          `/oapi/hubs/${enc(hubUid)}/pages/${enc(page.uid)}`,
          update,
        );
        const warnings = res?.warnings ?? [];
        return { created: true, pageUid: page.uid, title, ...(warnings.length ? { warnings } : {}) };
      }),
  );

  server.registerTool(
    "yroun_hub_update_page",
    {
      description:
        "Update a page. IMPORTANT: omitted fields are PRESERVED (never pass an empty string to 'keep' a value). " +
        "Content may be plain text (auto-converted) or a full Tiptap doc JSON — it REPLACES the page body.",
      inputSchema: {
        hubUid: z.string(),
        pageUid: z.string(),
        title: z.string().optional(),
        content: z.string().optional(),
        description: z.string().optional(),
        visibility: z
          .enum(["PUBLIC", "INTERNAL", "PRIVATE", "OWNER_ONLY"])
          .optional()
          .describe("PUBLIC=anyone, INTERNAL=members, PRIVATE=admins, OWNER_ONLY=owner"),
        parentPageUid: z.string().optional().describe("Move under a new parent"),
        sortOrder: z.number().optional(),
      },
    },
    async ({ hubUid, pageUid, content, ...rest }) =>
      run(async () => {
        const body: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rest)) if (v !== undefined) body[k] = v;
        if (content != null) body.content = toTiptapContentString(content);
        if (Object.keys(body).length === 0) throw new Error("nothing to update — pass at least one field");
        // Same advisory warnings contract as create (see above).
        const res = await apiRequest<{ warnings?: string[] } | undefined>(
          "PUT",
          `/oapi/hubs/${enc(hubUid)}/pages/${enc(pageUid)}`,
          body,
        );
        const warnings = res?.warnings ?? [];
        return {
          updated: true,
          pageUid,
          fields: Object.keys(body),
          ...(warnings.length ? { warnings } : {}),
        };
      }),
  );

  server.registerTool(
    "yroun_hub_delete_page",
    {
      description:
        "Delete a page (soft delete — recoverable by the hub owner; child pages are soft-deleted too).",
      inputSchema: { hubUid: z.string(), pageUid: z.string() },
    },
    async ({ hubUid, pageUid }) =>
      run(async () => {
        await apiRequest("DELETE", `/oapi/hubs/${enc(hubUid)}/pages/${enc(pageUid)}`);
        return { deleted: true, pageUid };
      }),
  );

  // ── Posts ────────────────────────────────────────────────────────────

  server.registerTool(
    "yroun_hub_list_posts",
    {
      description: "List a hub's posts (newest first, cursor-paginated).",
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
        return apiRequest("GET", `/oapi/hubs/${enc(hubUid)}/posts${qs ? `?${qs}` : ""}`);
      }),
  );

  server.registerTool(
    "yroun_hub_get_post",
    {
      description: "Get one post.",
      inputSchema: { hubUid: z.string(), postUid: z.string() },
      annotations: READ,
    },
    async ({ hubUid, postUid }) =>
      run(() => apiRequest("GET", `/oapi/hubs/${enc(hubUid)}/posts/${enc(postUid)}`)),
  );

  server.registerTool(
    "yroun_hub_create_post",
    {
      description: "Create a post in a hub (plain text content; tags optional).",
      inputSchema: {
        hubUid: z.string(),
        content: z.string(),
        topicName: z.string().optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ hubUid, ...body }) => run(() => apiRequest("POST", `/oapi/hubs/${enc(hubUid)}/posts`, body)),
  );

  server.registerTool(
    "yroun_hub_update_post",
    {
      description: "Update a post's content (and optionally tags).",
      inputSchema: {
        hubUid: z.string(),
        postUid: z.string(),
        content: z.string(),
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ hubUid, postUid, ...body }) =>
      run(() => apiRequest("PUT", `/oapi/hubs/${enc(hubUid)}/posts/${enc(postUid)}`, body)),
  );

  server.registerTool(
    "yroun_hub_delete_post",
    {
      description: "Delete a post (soft delete).",
      inputSchema: { hubUid: z.string(), postUid: z.string() },
    },
    async ({ hubUid, postUid }) =>
      run(async () => {
        await apiRequest("DELETE", `/oapi/hubs/${enc(hubUid)}/posts/${enc(postUid)}`);
        return { deleted: true, postUid };
      }),
  );

  // ── Schedules ────────────────────────────────────────────────────────

  server.registerTool(
    "yroun_hub_list_schedules",
    {
      description: "List a hub's schedules inside a time window (ISO 8601 timestamps, e.g. 2026-07-01T00:00:00Z).",
      inputSchema: {
        hubUid: z.string(),
        startAt: z.string().describe("Window start, ISO 8601"),
        endAt: z.string().describe("Window end, ISO 8601"),
      },
      annotations: READ,
    },
    async ({ hubUid, startAt, endAt }) =>
      run(() =>
        apiRequest(
          "GET",
          `/oapi/hubs/${enc(hubUid)}/schedules?startAt=${enc(startAt)}&endAt=${enc(endAt)}`,
        ),
      ),
  );

  server.registerTool(
    "yroun_hub_upsert_schedule",
    {
      description:
        "Create-or-update a schedule keyed on externalId (idempotent — safe to re-run). " +
        "Use a stable externalId per real-world event.",
      inputSchema: {
        hubUid: z.string(),
        externalId: z.string().describe("Stable idempotency key for this event"),
        title: z.string(),
        startAt: z.string().describe("ISO 8601"),
        endAt: z.string().describe("ISO 8601"),
        body: z.string().optional(),
        location: z.string().optional(),
        url: z.string().optional(),
        isAllDay: z.boolean().optional(),
        scheduleType: z.string().optional().describe("Server schedule type code; omit for the default"),
      },
    },
    async ({ hubUid, ...body }) =>
      run(() => apiRequest("PUT", `/oapi/hubs/${enc(hubUid)}/schedules/upsert`, body)),
  );

  // ── Members ──────────────────────────────────────────────────────────

  server.registerTool(
    "yroun_hub_list_members",
    {
      description: "List a hub's members (authority, display name, handle; cursor-paginated).",
      inputSchema: {
        hubUid: z.string(),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(100).optional(),
      },
      annotations: READ,
    },
    async ({ hubUid, cursor, limit }) =>
      run(() => {
        const params = new URLSearchParams();
        if (cursor) params.set("cursor", cursor);
        if (limit != null) params.set("limit", String(limit));
        const qs = params.toString();
        return apiRequest("GET", `/oapi/hubs/${enc(hubUid)}/members${qs ? `?${qs}` : ""}`);
      }),
  );
}
