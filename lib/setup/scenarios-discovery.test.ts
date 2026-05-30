import { describe, it, expect } from "vitest";
import path from "node:path";
import { discoverScenarios } from "./scenarios";

// Points at the REAL demoted bundle tree (created in S4-T15). RED before the
// move (scenarios/ missing + discoverScenarios undefined); GREEN after.
const SCENARIOS_ROOT = path.resolve(__dirname, "..", "..", "scenarios");

const norm = (p: string) => p.replace(/\\/g, "/");

describe("discoverScenarios", () => {
  it("finds small-community (default) and hostel with ontology dirs", async () => {
    const found = await discoverScenarios(SCENARIOS_ROOT);
    const byName = new Map(found.map((s) => [s.manifest.name, s]));

    expect(byName.has("small-community")).toBe(true);
    expect(byName.has("hostel")).toBe(true);

    const sc = byName.get("small-community")!;
    expect(sc.manifest.default).toBe(true);
    expect(norm(sc.ontologyDir)).toMatch(/scenarios\/small-community\/ontology$/);

    const hostel = byName.get("hostel")!;
    expect(hostel.manifest.default).toBe(false);
    expect(norm(hostel.ontologyDir)).toMatch(/scenarios\/hostel\/ontology$/);
    expect(norm(hostel.seedDir)).toMatch(/scenarios\/hostel\/seed$/);
  });

  it("discovers all six bundled scenarios", async () => {
    const found = await discoverScenarios(SCENARIOS_ROOT);
    const names = found.map((s) => s.manifest.name).sort();
    expect(names).toEqual(
      [
        "book-club",
        "book-club-org",
        "empty",
        "hostel",
        "permaculture-org",
        "small-community",
      ].sort(),
    );
  });

  it("returns exactly one default scenario (small-community)", async () => {
    const found = await discoverScenarios(SCENARIOS_ROOT);
    const defaults = found.filter((s) => s.manifest.default).map((s) => s.manifest.name);
    expect(defaults).toEqual(["small-community"]);
  });

  it("skips directories without a scenario.json manifest", async () => {
    // README.md at the scenarios root is a file, not a bundle; discovery must
    // not choke on non-manifest entries.
    const found = await discoverScenarios(SCENARIOS_ROOT);
    expect(found.every((s) => typeof s.manifest.name === "string")).toBe(true);
  });
});
