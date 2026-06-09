// UX: proposal-landing toast contract.
//
// MutationPulseMount is the single global listener for `acropolisos:mutation`
// (a fresh proposal landed). Besides pulsing the touched type cards, it now
// surfaces a transient toast that tells the user a proposal is ready and links
// to the review gate. We unit-test the pure toast-content + target helpers; the
// DOM/timer wiring (no jsdom in this package) is exercised in the live app.

import { describe, expect, it } from "vitest";
import {
  proposalToastMessage,
  TOAST_LINK_HREF,
  TOAST_DURATION_MS,
} from "./mutation-pulse-mount";

describe("MutationPulseMount — proposal toast", () => {
  it("announces a ready proposal and invites review", () => {
    const msg = proposalToastMessage(["Member"]);
    expect(msg.toLowerCase()).toContain("proposal");
    expect(msg.toLowerCase()).toContain("review");
  });

  it("links to the proposal review gate", () => {
    expect(TOAST_LINK_HREF).toBe("/organize");
  });

  it("auto-dismisses after a brief, non-zero window", () => {
    expect(TOAST_DURATION_MS).toBeGreaterThanOrEqual(3000);
    expect(TOAST_DURATION_MS).toBeLessThanOrEqual(8000);
  });
});
