import { describe, it, expect } from "vitest";
import { computeAdaptiveLayout } from "./live-home";

describe("computeAdaptiveLayout · S5 queue takeover", () => {
  it("returns the types-dominant layout when no proposals are pending", () => {
    const layout = computeAdaptiveLayout(0);
    expect(layout.queueDominant).toBe(false);
    expect(layout.typesSpan).toBe("md:col-span-3");
    expect(layout.centerSpan).toBe("md:col-span-9");
    expect(layout.centerOrder).toBe("");
  });

  it("flips to queue-dominant 8/4 grid when pendingCount >= 1", () => {
    const layout = computeAdaptiveLayout(1);
    expect(layout.queueDominant).toBe(true);
    expect(layout.typesSpan).toContain("md:col-span-4");
    expect(layout.typesSpan).toContain("md:order-2");
    expect(layout.centerSpan).toBe("md:col-span-8");
    expect(layout.centerOrder).toBe("md:order-1");
  });

  it("stays queue-dominant for any positive pendingCount", () => {
    expect(computeAdaptiveLayout(2).queueDominant).toBe(true);
    expect(computeAdaptiveLayout(99).queueDominant).toBe(true);
  });
});
