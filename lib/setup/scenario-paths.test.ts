import { describe, it, expect, afterEach } from "vitest";
import {
  getScenariosRoot,
  scenarioOntologyDir,
  scenarioSeedDir,
} from "./scenarios";

const norm = (p: string) => p.replace(/\\/g, "/");

describe("scenario path helpers (S4-T16)", () => {
  afterEach(() => {
    delete process.env.ACROPOLISOS_SCENARIOS_ROOT;
  });

  it("getScenariosRoot ends with /scenarios by default", () => {
    expect(norm(getScenariosRoot())).toMatch(/\/scenarios$/);
  });

  it("getScenariosRoot honors ACROPOLISOS_SCENARIOS_ROOT", () => {
    process.env.ACROPOLISOS_SCENARIOS_ROOT = "/custom/scn";
    expect(norm(getScenariosRoot())).toBe("/custom/scn");
  });

  it("scenarioOntologyDir(name) resolves to scenarios/<name>/ontology", () => {
    expect(norm(scenarioOntologyDir("hostel"))).toMatch(
      /\/scenarios\/hostel\/ontology$/,
    );
  });

  it("scenarioSeedDir(name) resolves to scenarios/<name>/seed", () => {
    expect(norm(scenarioSeedDir("hostel"))).toMatch(/\/scenarios\/hostel\/seed$/);
  });
});
