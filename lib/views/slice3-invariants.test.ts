// lib/views/slice3-invariants.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const VIEWS = path.resolve(__dirname);

function read(rel: string): string {
  return readFileSync(path.join(VIEWS, rel), "utf8");
}

describe("Slice 3 §11 invariants", () => {
  it("invariant 1 — new lib/views/* code names NO domain type literal", () => {
    for (const f of ["registry.ts", "merge.ts", "resolve.ts", "view-proposal.ts"]) {
      const src = read(f).toLowerCase();
      for (const domain of ["bed", "guest", "booking", "room", "shift"]) {
        // word-boundary check so "embedded"/"booking" substrings in comments don't false-positive
        expect(new RegExp(`\\b${domain}\\b`).test(src)).toBe(false);
      }
    }
  });

  it("invariant 2/3 — the view payload carries config (descriptors), never tsx/code", () => {
    const proposal = read("view-proposal.ts");
    expect(proposal).not.toMatch(/tsx_body/);
    expect(proposal).toMatch(/descriptors/);
  });
});
