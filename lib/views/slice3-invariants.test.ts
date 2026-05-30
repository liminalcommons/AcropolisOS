// lib/views/slice3-invariants.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const VIEWS = path.resolve(__dirname);

function read(rel: string): string {
  return readFileSync(path.join(VIEWS, rel), "utf8");
}

describe("Slice 3 §11 invariants", () => {
  it("the domain-literal guard regex actually has teeth", () => {
    const re = (d: string) => new RegExp(String.raw`\b${d}\b`);
    expect(re("bed").test("const bed = computeBeds()")).toBe(true); // catches a real literal
    expect(re("bed").test("embedded")).toBe(false); // word-boundary: no false-positive on substrings
  });

  it("invariant 1 — new view/board-derivation code names NO domain type literal", () => {
    // The derivation surface decontamination cares about: the view registry +
    // merge/resolve/proposal pipeline AND the board-derivation kernel (widgets).
    const files = [
      "registry.ts",
      "merge.ts",
      "resolve.ts",
      "view-proposal.ts",
      "registry-pg.ts",
      "../widgets/derive-board.ts",
      "../widgets/per-user.ts",
    ];
    for (const f of files) {
      const src = read(f).toLowerCase();
      for (const domain of ["bed", "guest", "booking", "room", "shift"]) {
        // String.raw keeps \b a word boundary (a plain template literal collapses
        // \\b to U+0008 backspace, defeating the guard). Word-boundary so
        // "embedded"/"bookings" substrings don't false-positive.
        expect(new RegExp(String.raw`\b${domain}\b`).test(src)).toBe(false);
      }
    }
  });

  it("invariant 2/3 — the view payload carries config (descriptors), never tsx/code", () => {
    const proposal = read("view-proposal.ts");
    expect(proposal).not.toMatch(/tsx_body/);
    expect(proposal).toMatch(/descriptors/);
  });
});
