import { describe, it, expect } from "vitest";
import { THEME_PRESETS, DEFAULT_PRESET_ID } from "./presets";
import { isValidTokenSet, BASE_TOKENS } from "./tokens";
import { validateContrast } from "./contrast";

describe("theme presets", () => {
  it("every preset is a structurally valid TokenSet", () => {
    for (const p of THEME_PRESETS) {
      expect(isValidTokenSet(p.tokens), `${p.id} structure`).toBe(true);
    }
  });
  it("every preset passes the WCAG contrast validator", () => {
    for (const p of THEME_PRESETS) {
      const v = validateContrast(p.tokens);
      expect(v.ok, `${p.id} contrast: ${JSON.stringify(v.failures)}`).toBe(true);
    }
  });
  it("preset ids are unique", () => {
    const ids = THEME_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("the default preset exists and equals BASE_TOKENS", () => {
    const def = THEME_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID);
    expect(def).toBeDefined();
    expect(def!.tokens).toEqual(BASE_TOKENS);
  });
});
