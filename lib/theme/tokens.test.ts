// lib/theme/tokens.test.ts
import { describe, it, expect } from "vitest";
import { TOKEN_KEYS, BASE_TOKENS, isValidTokenSet, parseTokenSet } from "@/lib/theme/tokens";

describe("tokens", () => {
  it("BASE_TOKENS defines every token key", () => {
    for (const k of TOKEN_KEYS) {
      expect(typeof BASE_TOKENS[k]).toBe("string");
      expect(BASE_TOKENS[k].length).toBeGreaterThan(0);
    }
  });
  it("isValidTokenSet accepts BASE_TOKENS", () => {
    expect(isValidTokenSet(BASE_TOKENS)).toBe(true);
  });
  it("isValidTokenSet rejects a set missing a key", () => {
    const { background: _omit, ...partial } = BASE_TOKENS;
    expect(isValidTokenSet(partial)).toBe(false);
  });
  it("isValidTokenSet rejects non-string values", () => {
    expect(isValidTokenSet({ ...BASE_TOKENS, primary: 123 })).toBe(false);
  });
  it("parseTokenSet returns null on invalid JSON", () => {
    expect(parseTokenSet("{not json")).toBeNull();
  });
  it("parseTokenSet round-trips BASE_TOKENS", () => {
    expect(parseTokenSet(JSON.stringify(BASE_TOKENS))).toEqual(BASE_TOKENS);
  });
});
