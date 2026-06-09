// Critic #5: after a steward commits a proposal on /organize, the success state
// must close the feedback loop — not just "Committed — <type> row <id>", but a
// navigation affordance telling the steward WHERE their data now lives so they
// can go operate on it.
//
// The committed state lives inside ProposalCard behind async useState, which the
// node-env renderToStaticMarkup pattern (no jsdom in this repo) cannot drive.
// proposal-review-list.tsx itself imports ./actions ("use server" → next-auth),
// which vitest cannot resolve. So the success surface is extracted into its own
// PURE presentational module, CommittedBanner, with no server-action imports —
// rendered here directly. This keeps the affordance contract testable without
// mounting the classify/confirm streaming stack or the auth chain.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CommittedBanner } from "./committed-banner";

describe("CommittedBanner — committed state success affordance (Critic #5)", () => {
  it("names the target type so the steward sees what was integrated", () => {
    const html = renderToStaticMarkup(
      <CommittedBanner target_type="booking" typed_row_id="abc-123" />,
    );
    // Readable type label is present.
    expect(html).toContain("Booking");
  });

  it("offers a navigation affordance pointing at the committed type's view", () => {
    const html = renderToStaticMarkup(
      <CommittedBanner target_type="booking" typed_row_id="abc-123" />,
    );
    // A real link to the generated /[type] view so the steward can go operate.
    expect(html).toContain('href="/booking"');
    // Action-oriented label closing the loop ("View in …" / "Go to …").
    expect(html).toMatch(/View in|Go to/);
  });

  it("still shows the committed row id (does not regress the existing receipt)", () => {
    const html = renderToStaticMarkup(
      <CommittedBanner target_type="booking" typed_row_id="abc-123" />,
    );
    expect(html).toContain("abc-123");
  });

  it("renders underscore type names as spaced, readable labels but routes on the token", () => {
    const html = renderToStaticMarkup(
      <CommittedBanner target_type="work_trade" typed_row_id="row-9" />,
    );
    // Readable label uses spaces, not underscores.
    expect(html).toContain("Work Trade");
    // The route still uses the raw snake token (matches the (generated)/[type] route).
    expect(html).toContain('href="/work_trade"');
  });

  it("keeps the affordance compact for mobile (text-xs, single-line link)", () => {
    const html = renderToStaticMarkup(
      <CommittedBanner target_type="booking" typed_row_id="abc-123" />,
    );
    // Small text so the banner fits a 375px viewport without forcing wraps.
    expect(html).toContain("text-xs");
    // whitespace-nowrap on the link keeps the tappable affordance on one line.
    expect(html).toContain("whitespace-nowrap");
  });
});
