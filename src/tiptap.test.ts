import { describe, expect, test } from "vitest";
import { tiptapContentToPlainText, toTiptapContentString } from "./tiptap.js";

// L1 matrix — the page-content conversion policy. A wrong shape here
// corrupts a hub page silently (the reader JSON.parses unconditionally).
describe("toTiptapContentString", () => {
  test("a full Tiptap doc passes through verbatim (re-serialized)", () => {
    const doc = { type: "doc", content: [{ type: "heading", attrs: { level: 2 } }] };
    expect(JSON.parse(toTiptapContentString(JSON.stringify(doc)))).toEqual(doc);
  });

  test("doc detection survives surrounding whitespace", () => {
    const doc = { type: "doc", content: [] };
    expect(JSON.parse(toTiptapContentString(`  ${JSON.stringify(doc)}  `))).toEqual(doc);
  });

  test("JSON that is not a doc is treated as literal text, not injected", () => {
    const out = JSON.parse(toTiptapContentString('{"type":"paragraph"}'));
    expect(out.type).toBe("doc");
    expect(out.content[0].type).toBe("paragraph");
    expect(out.content[0].content[0].text).toBe('{"type":"paragraph"}');
  });

  test("blank-line-separated text becomes one paragraph per block", () => {
    const out = JSON.parse(toTiptapContentString("first block\n\nsecond block\n\n\nthird"));
    expect(out.content).toHaveLength(3);
    expect(out.content.map((p: { content: Array<{ text: string }> }) => p.content[0].text)).toEqual([
      "first block",
      "second block",
      "third",
    ]);
  });

  test("single newlines inside a block collapse to spaces", () => {
    const out = JSON.parse(toTiptapContentString("line one\nline two"));
    expect(out.content).toHaveLength(1);
    expect(out.content[0].content[0].text).toBe("line one line two");
  });

  test("empty and whitespace-only input yields a valid empty doc", () => {
    for (const input of ["", "   ", "\n\n"]) {
      const out = JSON.parse(toTiptapContentString(input));
      expect(out).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    }
  });

  test("malformed JSON starting with a brace falls back to text wrapping", () => {
    const out = JSON.parse(toTiptapContentString("{not json at all"));
    expect(out.content[0].content[0].text).toBe("{not json at all");
  });
});

describe("tiptapContentToPlainText", () => {
  test("extracts blank-line-joined prose from a doc", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "첫 문단." }] },
        { type: "paragraph", content: [{ type: "text", text: "둘째 " }, { type: "text", text: "문단." }] },
      ],
    });
    expect(tiptapContentToPlainText(doc)).toBe("첫 문단.\n\n둘째 문단.");
  });

  test("round-trips through toTiptapContentString", () => {
    const prose = "A.\n\nB.\n\nC.";
    expect(tiptapContentToPlainText(toTiptapContentString(prose))).toBe(prose);
  });

  test("passes non-doc/legacy input through unchanged", () => {
    expect(tiptapContentToPlainText("plain legacy text")).toBe("plain legacy text");
    expect(tiptapContentToPlainText('{"not":"a doc"}')).toBe('{"not":"a doc"}');
  });

  test("skips empty blocks", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph" }, { type: "paragraph", content: [{ type: "text", text: "only" }] }],
    });
    expect(tiptapContentToPlainText(doc)).toBe("only");
  });
});
