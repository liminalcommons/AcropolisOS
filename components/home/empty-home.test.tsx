// UX: EmptyHome user-journey breadcrumb.
//
// No jsdom/RTL in this package (mirrors action-confirmation-card.test.tsx),
// so the component contract is asserted via renderToStaticMarkup: the rendered
// HTML must carry the 4-step journey copy AND keep the three seed prompt
// buttons as functional entry points.
//
// The breadcrumb makes the core loop visible BEFORE any chat interaction:
//   Chat → Review → Approve → Board grows
// This is the foundational "what happens next?" affordance on the empty board.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyHome } from "./empty-home";

describe("EmptyHome — user-journey breadcrumb", () => {
  it("renders a visible progress breadcrumb with 4 steps: Chat → Review → Approve → Board grows", () => {
    const html = renderToStaticMarkup(<EmptyHome />);
    expect(html).toContain("Chat with agent");
    expect(html).toContain("Review proposal");
    expect(html).toContain("Approve");
    expect(html).toContain("Your board grows");
    // The breadcrumb region itself is rendered visible — its className must not
    // carry a `hidden` display utility. (Decorative arrow separators legitimately
    // use aria-hidden, so we scope the check to the breadcrumb element's classes.)
    const breadcrumbTag = html.match(/<ol[^>]*data-journey="breadcrumb"[^>]*>/);
    expect(breadcrumbTag).not.toBeNull();
    expect(breadcrumbTag?.[0]).not.toContain("hidden");
  });

  it("displays all three seed prompt buttons as entry points to the journey", () => {
    const html = renderToStaticMarkup(<EmptyHome />);
    expect(html).toContain("housing co-op");
    expect(html).toContain("meditation group");
    expect(html).toContain("fire brigade");
  });

  it("marks the breadcrumb region for the agent/styling with a stable hook", () => {
    const html = renderToStaticMarkup(<EmptyHome />);
    expect(html).toContain('data-journey="breadcrumb"');
  });
});
