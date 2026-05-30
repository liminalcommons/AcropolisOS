import { describe, expect, it } from "vitest";
import { inferElementKind } from "./infer-kind";

describe("inferElementKind", () => {
  it("classifies by name keyword across all four kinds", () => {
    expect(inferElementKind("Booking")).toBe("commitment");
    expect(inferElementKind("Vehicle")).toBe("resource");
    expect(inferElementKind("Volunteer")).toBe("agent");
    expect(inferElementKind("IncidentLog")).toBe("event"); // tokens: incident, log
    expect(inferElementKind("work_trade_agreement")).toBe("commitment");
  });

  it("falls back to concept when no signal matches (never a confident wrong guess)", () => {
    expect(inferElementKind("Sprocket")).toBe("concept");
    expect(inferElementKind("Widget")).toBe("concept");
    expect(inferElementKind("")).toBe("concept");
  });

  it("priority: agent wins over a later-category token", () => {
    // "member_payment" → member (agent) beats payment (event)
    expect(inferElementKind("member_payment")).toBe("agent");
  });
});
