import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";

// S4 "demote the scenario": the privileged top-level seed/ dir is gone, every
// scenario is a self-describing bundle under scenarios/<name>/, and the default
// scenario carries a manifest. The no-domain-literal coverage itself lives in
// lib/views/slice3-invariants.test.ts (widened to read-api + target-table here).
const PKG = path.resolve(__dirname, "..", "..");

describe("Slice 4 — scenario demote invariants", () => {
  it("the top-level seed/ dir is gone (scenarios/ supersedes it)", () => {
    expect(existsSync(path.join(PKG, "seed"))).toBe(false);
  });

  it("the default scenario (small-community) has a manifest", () => {
    expect(
      existsSync(path.join(PKG, "scenarios", "small-community", "scenario.json")),
    ).toBe(true);
  });

  it("the hostel scenario is a full bundle (manifest + ontology + seed data)", () => {
    const base = path.join(PKG, "scenarios", "hostel");
    expect(existsSync(path.join(base, "scenario.json"))).toBe(true);
    expect(existsSync(path.join(base, "ontology"))).toBe(true);
    expect(existsSync(path.join(base, "seed"))).toBe(true);
  });
});
