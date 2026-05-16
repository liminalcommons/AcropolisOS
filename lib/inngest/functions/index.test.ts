import { describe, expect, it } from "vitest";
import { declarativeActionFunctions } from "../declarative-actions.generated";
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

  it("includes every generated declarative action function", () => {
    for (const fn of declarativeActionFunctions) {
      expect(functions).toContain(fn);
    }
  });
});
