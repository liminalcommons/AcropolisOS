import { describe, expect, it } from "vitest";
import { ScenarioManifest, parseScenarioManifest } from "./scenarios";

describe("ScenarioManifest", () => {
  it("parses name/description/default/version", () => {
    const m = parseScenarioManifest({
      name: "small-community",
      description: "Member, Event, MeetingMinute kernel",
      default: true,
      version: "1.0.0",
    });
    expect(m.name).toBe("small-community");
    expect(m.default).toBe(true);
    expect(m.version).toBe("1.0.0");
  });

  it("default is optional and falls back to false", () => {
    const m = parseScenarioManifest({
      name: "hostel",
      description: "Hostel domain",
      version: "1.0.0",
    });
    expect(m.default).toBe(false);
  });

  it("rejects a manifest missing name", () => {
    expect(() => parseScenarioManifest({ description: "x", version: "1.0.0" })).toThrow();
  });
});
