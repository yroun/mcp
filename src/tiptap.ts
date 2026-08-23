/**
 * Hub pages store content as a Tiptap document serialized to a JSON
 * string (`JSON.stringify(editor.getJSON())`) — the repo-wide Hub Page
 * Content Standard. Agents shouldn't need to know that (Tesler: the
 * system carries the complexity), so tool input accepts EITHER:
 *   - a Tiptap doc (object or JSON string with type === "doc") → passed
 *     through verbatim, or
 *   - plain text / markdown-ish text → wrapped into paragraphs.
 * Output is always the exact string the server expects.
 */
/**
 * Inverse of toTiptapContentString for the read tools: extract plain
 * prose from a stored Tiptap document string. Block nodes join with a
 * blank line — the same shape the write tools accept, so a read → edit →
 * upsert round-trip preserves paragraph structure. Non-doc input (legacy
 * raw text rows) passes through unchanged.
 */
export function tiptapContentToPlainText(stored: string): string {
  let doc: unknown;
  try {
    doc = JSON.parse(stored);
  } catch {
    return stored;
  }
  if (!doc || typeof doc !== "object" || (doc as { type?: string }).type !== "doc") return stored;
  const collect = (node: unknown): string => {
    if (!node || typeof node !== "object") return "";
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (n.type === "text") return n.text ?? "";
    return (n.content ?? []).map(collect).join("");
  };
  const blocks = ((doc as { content?: unknown[] }).content ?? [])
    .map(collect)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return blocks.join("\n\n");
}

/**
 * Array-shaped widget attrs agents recurringly send as a JSON STRING
 * (`"columns": "[{...}]"`): the top-level content field IS stringified,
 * and an author generalizes that one rule to nested attrs. A string
 * that parses as a JSON array is replaced with the parsed array before
 * the doc ships; anything else is left as sent (the widget degrades to
 * its empty state and names the reason). Mirrors the server's
 * TiptapInlineCodePolicy write-boundary reconciliation — fixing it here
 * too means the agent's very next read shows the clean shape.
 * 2026-08-05 incident: a stringified columns crashed the table widget.
 */
const WIDGET_ARRAY_ATTRS: Record<string, string[]> = {
  apiTableBlock: ["columns", "staticData"],
  chartBlock: ["yAxisKeys", "filterConfigs", "staticData"],
  // apiChartBlock is a tolerated alias (the server canonicalizes the name).
  apiChartBlock: ["yAxisKeys", "filterConfigs", "staticData"],
  apiRequestBlock: ["bodyFields", "customHeaders"],
  apiQueueBlock: ["groupOrder", "rowColumns"],
  faqBlock: ["staticData"],
  statGridBlock: ["tiles"],
  // statGrid is a tolerated alias (the server canonicalizes the name).
  statGrid: ["tiles"],
};

function normalizeWidgetArrayAttrs(node: unknown): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) normalizeWidgetArrayAttrs(child);
    return;
  }
  const n = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown };
  const arrayKeys = n.type ? WIDGET_ARRAY_ATTRS[n.type] : undefined;
  if (arrayKeys && n.attrs && typeof n.attrs === "object") {
    for (const key of arrayKeys) {
      const value = n.attrs[key];
      if (typeof value !== "string") continue;
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) n.attrs[key] = parsed;
      } catch {
        // Not JSON — leave as sent; the widget renders its empty state.
      }
    }
  }
  if (n.content) normalizeWidgetArrayAttrs(n.content);
}

export function toTiptapContentString(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && parsed.type === "doc") {
        normalizeWidgetArrayAttrs(parsed);
        return JSON.stringify(parsed);
      }
    } catch {
      // Not JSON after all — fall through to plain-text wrapping.
    }
  }
  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => ({
      type: "paragraph",
      content: [{ type: "text", text: block.replace(/\n/g, " ") }],
    }));
  return JSON.stringify({
    type: "doc",
    content: paragraphs.length > 0 ? paragraphs : [{ type: "paragraph" }],
  });
}
