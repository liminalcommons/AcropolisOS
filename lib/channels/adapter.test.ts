// lib/channels/adapter.test.ts
//
// The ChannelAdapter interface is the abstraction that lets new inbound
// channels (Telegram now; Discord/WhatsApp/Matrix later) slot in as data-only
// adapters over the shared raw_inbox intake path. It is a TYPE — there is no
// runtime value to assert against directly, so this test exercises the contract
// structurally: a conforming object compiles against the interface and exposes
// the three members (verifyRequest, parsePayload, source). If the interface
// shape drifts, tsc fails the build and this assertion fails at runtime.

import { describe, expect, it } from "vitest";
import type { ChannelAdapter } from "@/lib/channels/adapter";

describe("ChannelAdapter interface", () => {
  it("a conforming adapter exposes verifyRequest, parsePayload, and source", () => {
    const fake: ChannelAdapter = {
      source: "fake",
      verifyRequest(_req: Request, envSecret: string | undefined): boolean {
        return envSecret !== undefined;
      },
      async parsePayload(_body: unknown): Promise<Record<string, unknown>[]> {
        return [];
      },
    };

    expect(fake.source).toBe("fake");
    expect(typeof fake.verifyRequest).toBe("function");
    expect(typeof fake.parsePayload).toBe("function");

    // verifyRequest is a synchronous boolean
    const req = new Request("http://localhost/", { method: "POST" });
    expect(fake.verifyRequest(req, "secret")).toBe(true);
    expect(fake.verifyRequest(req, undefined)).toBe(false);
  });

  it("parsePayload resolves to an array", async () => {
    const fake: ChannelAdapter = {
      source: "fake",
      verifyRequest: () => true,
      parsePayload: async () => [{ text: "hi" }],
    };
    const rows = await fake.parsePayload({});
    expect(Array.isArray(rows)).toBe(true);
    expect(rows[0]).toEqual({ text: "hi" });
  });
});
