// components/shell/dock-affordance.ts
// Governed className vocabulary for the CoPilotDock collapse/expand toggle.
//
// The toggle houses the decision queue's "Discuss with the agent" flow, so its
// surface quality is load-bearing for the calm-prosumer-bar feel — not a dev
// affordance. Holding the two strings here (a) lets the affordance contract be
// unit-tested without mounting ChatPanel's streaming stack, and (b) keeps the
// component a pure consumer of audited vocabulary rather than free inline
// literals that can quietly regress to a bare 4x4 icon.
//
// EXPANDED: a 32x32 padded, rounded hit target pinned top-right of the dock,
// with a hover fill (not just a color shift) so it reads as a real control.
// COLLAPSED: a full-height 40px-wide edge bar — large, obvious re-entry point —
// with a smooth hover fill.

export const DOCK_TOGGLE_EXPANDED_CLS =
  "absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card hover:text-foreground";

export const DOCK_TOGGLE_COLLAPSED_CLS =
  "flex h-full w-10 shrink-0 items-center justify-center border-l border-border bg-card text-muted-foreground transition-colors hover:bg-card/80 hover:text-foreground";
