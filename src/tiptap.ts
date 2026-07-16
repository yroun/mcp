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

export function toTiptapContentString(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && parsed.type === "doc") {
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
