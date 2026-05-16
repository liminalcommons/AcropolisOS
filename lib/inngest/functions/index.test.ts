import { describe, expect, it } from "vitest";
import { functions } from "./index";
import { testEcho } from "./test-echo";

describe("inngest functions registry", () => {
  it("registers testEcho so the route handler picks it up", () => {
    expect(functions).toContain(testEcho);
  });

  it("contains only Inngest function instances", () => {
    for (const fn of functions) {
      expect(typeof (fn as { id: () => string }).id).toBe("function");
    }
  });
});
