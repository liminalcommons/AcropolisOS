import { describe, it, expect } from "vitest";
import { contrastRatio, validateContrast } from "./contrast";
import { BASE_TOKENS } from "./tokens";

describe("contrastRatio", () => {
  it("white vs black ≈ 21:1", () => {
    const r = contrastRatio("oklch(1 0 0)", "oklch(0 0 0)");
    expect(r).toBeGreaterThan(20);
    expect(r).toBeLessThanOrEqual(21.01);
  });
  it("is symmetric", () => {
    const a = contrastRatio("oklch(0.62 0.19 280)", "oklch(0.18 0.01 280)");
    const b = contrastRatio("oklch(0.18 0.01 280)", "oklch(0.62 0.19 280)");
    expect(Math.abs(a - b)).toBeLessThan(1e-9);
  });
  it("identical colors ≈ 1:1", () => {
    expect(contrastRatio("oklch(0.5 0.1 200)", "oklch(0.5 0.1 200)")).toBeCloseTo(1, 5);
  });
});

describe("validateContrast", () => {
  it("BASE_TOKENS passes AA on all checked pairs", () => {
    const r = validateContrast(BASE_TOKENS);
    expect(r.ok).toBe(true);
    expect(r.failures).toHaveLength(0);
  });
  it("flags a low-contrast foreground/background pair", () => {
    const bad = { ...BASE_TOKENS, foreground: BASE_TOKENS.background };
    const r = validateContrast(bad);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.pair === "foreground/background")).toBe(true);
  });
});
