// lib/theme/resolve.test.ts
import { describe, it, expect } from "vitest";
import { resolveTheme } from "@/lib/theme/resolve";
import { BASE_TOKENS } from "@/lib/theme/tokens";

const customPref = JSON.stringify({ ...BASE_TOKENS, primary: "oklch(0.7 0.2 30)" });

describe("resolveTheme", () => {
  it("uses a valid explicit member pref over everything", () => {
    const t = resolveTheme({ memberPref: customPref, role: "manager", orgSeed: null });
    expect(t.primary).toBe("oklch(0.7 0.2 30)");
  });
  it("falls back to base when member pref is null", () => {
    const t = resolveTheme({ memberPref: null, role: "staff", orgSeed: null });
    expect(t).toEqual(BASE_TOKENS);
  });
  it("falls back to base when member pref is corrupt", () => {
    const t = resolveTheme({ memberPref: "{garbage", role: "staff", orgSeed: null });
    expect(t).toEqual(BASE_TOKENS);
  });
  it("falls back to base when member pref is an invalid TokenSet", () => {
    const t = resolveTheme({ memberPref: JSON.stringify({ primary: "x" }), role: "staff", orgSeed: null });
    expect(t).toEqual(BASE_TOKENS);
  });
});
