// UX: FileDropStrip success affordance.
//
// After a file drop completes, the strip must (a) state how many rows landed
// in a way that points the user at the NEXT step (classify), not a dead-end
// "view" link, and (b) expose a stable auto-nav target so the success view can
// route the user to /organize. We test the pure copy/target helpers — the async
// upload + router side-effects are exercised manually in the live app.

import { describe, expect, it } from "vitest";
import { successHeadline, ORGANIZE_HREF, AUTO_NAV_MS } from "./FileDropStrip";

describe("FileDropStrip — success affordance", () => {
  it("frames success as a call to classify, with correct pluralization", () => {
    expect(successHeadline(1)).toContain("Pushed 1 row");
    expect(successHeadline(1)).toContain("classify");
    expect(successHeadline(12)).toContain("Pushed 12 rows");
    expect(successHeadline(12)).toContain("classify");
  });

  it("targets /organize for the auto-nav and manual button", () => {
    expect(ORGANIZE_HREF).toBe("/organize");
  });

  it("auto-navigates after a brief, non-zero, dismissable delay", () => {
    expect(AUTO_NAV_MS).toBeGreaterThanOrEqual(2000);
    expect(AUTO_NAV_MS).toBeLessThanOrEqual(4000);
  });
});
