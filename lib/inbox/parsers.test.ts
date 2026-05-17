import { describe, expect, it } from "vitest";
import { parseCsv, parseJson, parseMarkdown, parsePayload } from "./parsers";

describe("parseCsv", () => {
  it("returns one payload per data row using the header as keys", () => {
    const csv = "name,role\nada,steward\nlin,member\n";
    expect(parseCsv(csv)).toEqual([
      { name: "ada", role: "steward" },
      { name: "lin", role: "member" },
    ]);
  });

  it("handles quoted fields with embedded commas and quotes", () => {
    const csv = `title,body\n"hello, world","she said ""hi"""\n`;
    expect(parseCsv(csv)).toEqual([
      { title: "hello, world", body: 'she said "hi"' },
    ]);
  });

  it("returns an empty array when only a header is present", () => {
    expect(parseCsv("a,b,c\n")).toEqual([]);
  });

  it("trims trailing CR characters from CRLF line endings", () => {
    const csv = "a,b\r\n1,2\r\n";
    expect(parseCsv(csv)).toEqual([{ a: "1", b: "2" }]);
  });

  it("ignores blank lines", () => {
    const csv = "k\n\nv1\n\nv2\n";
    expect(parseCsv(csv)).toEqual([{ k: "v1" }, { k: "v2" }]);
  });
});

describe("parseJson", () => {
  it("expands a top-level array into one payload per element", () => {
    expect(parseJson('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("wraps a top-level object in a single-row array", () => {
    expect(parseJson('{"a":1}')).toEqual([{ a: 1 }]);
  });

  it("wraps a scalar in { value }", () => {
    expect(parseJson("42")).toEqual([{ value: 42 }]);
    expect(parseJson('"hi"')).toEqual([{ value: "hi" }]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseJson("{not json")).toThrow();
  });
});

describe("parseMarkdown", () => {
  it("returns a single row with body and parsed frontmatter", () => {
    const md = "---\ntitle: Hello\ntags:\n  - a\n  - b\n---\nBody text.\n";
    const rows = parseMarkdown(md);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      frontmatter: { title: "Hello", tags: ["a", "b"] },
      body: "Body text.\n",
    });
  });

  it("returns empty frontmatter when none is present", () => {
    const md = "Just body, no frontmatter.\n";
    expect(parseMarkdown(md)).toEqual([
      { frontmatter: {}, body: "Just body, no frontmatter.\n" },
    ]);
  });

  it("handles an empty frontmatter block as empty object", () => {
    const md = "---\n---\nBody only.\n";
    expect(parseMarkdown(md)).toEqual([
      { frontmatter: {}, body: "Body only.\n" },
    ]);
  });
});

describe("parsePayload (mime dispatch)", () => {
  it("dispatches text/csv to parseCsv", () => {
    expect(
      parsePayload({
        mime: "text/csv",
        filename: "x.csv",
        contents: "a\n1\n",
      }),
    ).toEqual([{ a: "1" }]);
  });

  it("dispatches application/json to parseJson", () => {
    expect(
      parsePayload({
        mime: "application/json",
        filename: "x.json",
        contents: "[1,2]",
      }),
    ).toEqual([{ value: 1 }, { value: 2 }]);
  });

  it("dispatches text/markdown to parseMarkdown", () => {
    expect(
      parsePayload({
        mime: "text/markdown",
        filename: "x.md",
        contents: "# Hi\n",
      }),
    ).toEqual([{ frontmatter: {}, body: "# Hi\n" }]);
  });

  it("falls back to filename extension when mime is generic", () => {
    expect(
      parsePayload({
        mime: "application/octet-stream",
        filename: "notes.md",
        contents: "Hi.\n",
      }),
    ).toEqual([{ frontmatter: {}, body: "Hi.\n" }]);
  });

  it("throws on unsupported types", () => {
    expect(() =>
      parsePayload({
        mime: "application/x-blob",
        filename: "x.bin",
        contents: "",
      }),
    ).toThrow(/unsupported/i);
  });
});
