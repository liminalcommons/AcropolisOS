// Affordance contract for the decision pathway's two chat entry points:
//   1. DecisionFocus's "Discuss with the agent" button — the 4th affordance that
//      opens the co-pilot scoped to a decision WITHOUT disposing it.
//   2. CoPilotDock's collapse/expand toggle — the control that houses (1).
//
// Both render in the node env via renderToStaticMarkup (no jsdom in this repo).
// The dock toggle classNames are GOVERNED as named constants in
// components/shell/dock-affordance.ts so the hit-target/affordance contract is
// testable without mounting ChatPanel's streaming stack — and so the component
// can only consume the audited vocabulary, never diverge into a bare inline
// literal that regresses the "calm prosumer bar" surface quality.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DecisionFocus } from "./decision-focus";
import { CoPilotDock } from "@/components/shell/co-pilot-dock";
import {
  DOCK_TOGGLE_EXPANDED_CLS,
  DOCK_TOGGLE_COLLAPSED_CLS,
} from "@/components/shell/dock-affordance";
import type { DecisionView } from "@/lib/blockers/decision-view";

const noop = async (): Promise<void> => {};

function decision(over: Partial<DecisionView> = {}): DecisionView {
  return {
    id: "b1",
    summary: "Approve the new member type?",
    detail: "",
    reasonKind: "ambiguous",
    createdAt: "2026-06-01T00:00:00Z",
    blockedActorId: null,
    mode: "pathways",
    scenarios: [],
    inputPrompt: null,
    confirm: null,
    trace: null,
    ...over,
  };
}

describe("DecisionFocus — discuss affordance", () => {
  it("renders the 'Discuss with the agent' button when a decision is present", () => {
    const html = renderToStaticMarkup(
      <DecisionFocus
        decisions={[decision()]}
        resolveAction={noop}
        resolveInputAction={noop as never}
        confirmAction={noop as never}
        dismissAction={noop}
      />,
    );
    expect(html).toContain("Discuss with the agent");
  });

  it("renders the discuss control as a non-submit button (talks, does not dispose)", () => {
    const html = renderToStaticMarkup(
      <DecisionFocus
        decisions={[decision()]}
        resolveAction={noop}
        resolveInputAction={noop as never}
        confirmAction={noop as never}
        dismissAction={noop}
      />,
    );
    // The discuss button is type="button" (it opens chat) — never a submit that
    // would fire a server action and dispose the decision. Its <button> tag and
    // the label are separated by the MessageSquare <svg>, so match from the
    // distinctive discuss-button class fragment (which only this control carries)
    // through to the label, and assert the opening tag declared type="button".
    const tag = '<button type="button"';
    const labelIdx = html.indexOf("Discuss with the agent");
    const openIdx = html.lastIndexOf(tag, labelIdx);
    expect(openIdx).toBeGreaterThanOrEqual(0);
    // The nearest preceding opening tag before the discuss label is the discuss
    // button itself, and it is declared type="button".
    expect(html.slice(openIdx, labelIdx)).toContain('rounded-lg border border-border bg-card/30');
  });
});

describe("CoPilotDock — toggle affordance vocabulary", () => {
  it("expanded toggle is a 32x32 padded, rounded, hover-filled hit target", () => {
    // A real control, not a bare 4x4 icon: visible hit area + hover background.
    expect(DOCK_TOGGLE_EXPANDED_CLS).toContain("flex");
    expect(DOCK_TOGGLE_EXPANDED_CLS).toContain("h-8");
    expect(DOCK_TOGGLE_EXPANDED_CLS).toContain("w-8");
    expect(DOCK_TOGGLE_EXPANDED_CLS).toContain("items-center");
    expect(DOCK_TOGGLE_EXPANDED_CLS).toContain("justify-center");
    expect(DOCK_TOGGLE_EXPANDED_CLS).toContain("rounded-md");
    expect(DOCK_TOGGLE_EXPANDED_CLS).toContain("hover:bg-card");
    expect(DOCK_TOGGLE_EXPANDED_CLS).toContain("transition-colors");
  });

  it("collapsed toggle is a full-height 40px edge bar with a smooth hover fill", () => {
    expect(DOCK_TOGGLE_COLLAPSED_CLS).toContain("flex");
    expect(DOCK_TOGGLE_COLLAPSED_CLS).toContain("h-full");
    expect(DOCK_TOGGLE_COLLAPSED_CLS).toContain("w-10");
    expect(DOCK_TOGGLE_COLLAPSED_CLS).toContain("shrink-0");
    expect(DOCK_TOGGLE_COLLAPSED_CLS).toContain("border-l");
    expect(DOCK_TOGGLE_COLLAPSED_CLS).toContain("bg-card");
    expect(DOCK_TOGGLE_COLLAPSED_CLS).toContain("hover:bg-card/80");
    expect(DOCK_TOGGLE_COLLAPSED_CLS).toContain("transition-colors");
  });

  it("the dock consumes the governed expanded-toggle vocabulary (no divergent inline literal)", () => {
    // Default static render is the expanded state (collapse lives in an effect
    // that does not run during renderToStaticMarkup). The rendered toggle must
    // carry the exact governed class string.
    const html = renderToStaticMarkup(<CoPilotDock actorRole={"steward" as never} />);
    expect(html).toContain(DOCK_TOGGLE_EXPANDED_CLS);
  });
});
