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
