import { describe, expect, it } from "vitest";
import { inngest } from "./client";

describe("inngest client", () => {
  it("registers the acropolisos app id", () => {
    expect(inngest.id).toBe("acropolisos");
  });

  it("is an Inngest instance with createFunction available", () => {
    expect(typeof inngest.createFunction).toBe("function");
  });
});
