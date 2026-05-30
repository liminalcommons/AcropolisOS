import { describe, it, expect } from "vitest";
import path from "node:path";
import { listScenarioChoices } from "./scenario-choices";

const SCENARIOS_ROOT = path.resolve(__dirname, "..", "..", "scenarios");

describe("listScenarioChoices (S4-T19)", () => {
  it("returns default-first choices with small-community first", async () => {
    const choices = await listScenarioChoices(SCENARIOS_ROOT);
    expect(choices.length).toBeGreaterThanOrEqual(2);
    expect(choices[0].default).toBe(true);
    expect(choices[0].name).toBe("small-community");
    expect(
      choices.every(
        (c) => typeof c.description === "string" && c.description.length > 0,
      ),
    ).toBe(true);
  });

  it("includes the hostel scenario among the choices", async () => {
    const choices = await listScenarioChoices(SCENARIOS_ROOT);
    expect(choices.map((c) => c.name)).toContain("hostel");
  });

  it("marks exactly one choice as default", async () => {
    const choices = await listScenarioChoices(SCENARIOS_ROOT);
    expect(choices.filter((c) => c.default)).toHaveLength(1);
  });
});
