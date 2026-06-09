// lib/channels/status.test.ts
//
// bindingLiveness is a PURE function deriving an honest, human-facing liveness
// status for a channel binding from four facts the caller supplies:
//   - configured: is the platform's webhook/token even set up (the same env flag
//     the routes 503 on)? If not, nothing can ever arrive → "offline".
//   - bound:      has the steward allow-listed this target into the org? If not,
//     it is merely discovered, not wired → "unbound".
//   - messageCount / lastReceivedAt: what raw_inbox actually shows.
//
// The wall clock is INJECTED as `now` (epoch ms) so the module never reads the
// system clock — this is what makes every branch unit-testable with a fixed time.
//
// Rules (precedence top-to-bottom):
//   !configured                         -> "offline"
//   !bound                              -> "unbound"
//   bound & messageCount === 0          -> "awaiting"
//   bound & last-seen within 24h        -> "receiving"
//   bound & last-seen older than 24h    -> "idle"

import { describe, expect, it } from "vitest";
import { bindingLiveness, type BindingStatus } from "@/lib/channels/status";

const NOW = Date.parse("2026-06-02T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("bindingLiveness", () => {
  it("'offline' when not configured (overrides everything else)", () => {
    const s: BindingStatus = bindingLiveness({
      configured: false,
      bound: true,
      messageCount: 99,
      lastReceivedAt: new Date(NOW - HOUR),
      now: NOW,
    });
    expect(s).toBe("offline");
  });

  it("'unbound' when configured but the steward has not bound the target", () => {
    const s = bindingLiveness({
      configured: true,
      bound: false,
      messageCount: 5,
      lastReceivedAt: new Date(NOW - HOUR),
      now: NOW,
    });
    expect(s).toBe("unbound");
  });

  it("'awaiting' when configured & bound but no messages have arrived yet", () => {
    const s = bindingLiveness({
      configured: true,
      bound: true,
      messageCount: 0,
      lastReceivedAt: null,
      now: NOW,
    });
    expect(s).toBe("awaiting");
  });

  it("'receiving' when bound and last message is within the 24h window", () => {
    const s = bindingLiveness({
      configured: true,
      bound: true,
      messageCount: 3,
      lastReceivedAt: new Date(NOW - HOUR),
      now: NOW,
    });
    expect(s).toBe("receiving");
  });

  it("'receiving' exactly at the 24h boundary (boundary is inclusive)", () => {
    const s = bindingLiveness({
      configured: true,
      bound: true,
      messageCount: 1,
      lastReceivedAt: new Date(NOW - DAY),
      now: NOW,
    });
    expect(s).toBe("receiving");
  });

  it("'idle' when bound but last message is older than 24h", () => {
    const s = bindingLiveness({
      configured: true,
      bound: true,
      messageCount: 10,
      lastReceivedAt: new Date(NOW - DAY - 1),
      now: NOW,
    });
    expect(s).toBe("idle");
  });

  it("accepts lastReceivedAt as an epoch-ms number too", () => {
    const s = bindingLiveness({
      configured: true,
      bound: true,
      messageCount: 2,
      lastReceivedAt: NOW - HOUR,
      now: NOW,
    });
    expect(s).toBe("receiving");
  });

  it("treats a positive messageCount with a null timestamp as 'idle' (seen, but age unknown)", () => {
    // Defensive: count says messages exist but we have no usable timestamp.
    const s = bindingLiveness({
      configured: true,
      bound: true,
      messageCount: 4,
      lastReceivedAt: null,
      now: NOW,
    });
    expect(s).toBe("idle");
  });
});
