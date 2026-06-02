// UX: EmptyHome seed-prompt → auto-expand the co-pilot dock.
//
// The storyboard's magic moment ("drop in a domain → the magic starts") breaks
// when a first-time visitor clicks a seed prompt while the CoPilotDock is
// collapsed (the default). A collapsed dock has ChatPanel unmounted, so it is
// deaf to acropolisos:prompt — the click "succeeds" with no visible effect.
//
// The fix reuses the PROVEN decision-focus "Discuss with the agent" seam:
//   1. acropolisos:open-chat   → CoPilotDock expands, ChatPanel mounts
//   2. storePendingDiscussPrompt(prompt) → parks prompt in sessionStorage so the
//      freshly-mounted ChatPanel reads it on hydration (survives the race; the
//      in-memory event alone misses while the dock is collapsed)
//   3. acropolisos:prompt      → fills the composer for the common (open) case
//
// No jsdom/RTL in this package (environment: "node"), so we assert the click
// CONTRACT on the extracted pure helper seedPromptIntoChat() via a
// window.dispatchEvent spy + the sessionStorage seam — not a DOM render.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedPromptIntoChat } from "./prompt-button";
import {
  getPendingDiscussPrompt,
  clearPendingDiscussPrompt,
} from "@/lib/decisions/discuss-prompt-state";

describe("PromptButton — auto-expand the collapsed dock on seed click", () => {
  const SEED = "Set up a housing co-op";
  // The node environment has no `window`; stub a minimal one exposing
  // dispatchEvent so we can record the CustomEvent sequence (mirrors the
  // sessionStorage stub pattern in discuss-prompt-state.test.ts).
  let dispatched: Event[];

  beforeEach(() => {
    dispatched = [];
    vi.stubGlobal("window", {
      dispatchEvent: (e: Event): boolean => {
        dispatched.push(e);
        return true;
      },
    });

    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    clearPendingDiscussPrompt();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fires acropolisos:open-chat (to expand the dock) BEFORE acropolisos:prompt", () => {
    seedPromptIntoChat(SEED);

    // open-chat must precede prompt: a collapsed dock has to expand (re-mount
    // ChatPanel) before the prompt event can land.
    expect(dispatched.map((e) => e.type)).toEqual([
      "acropolisos:open-chat",
      "acropolisos:prompt",
    ]);
  });

  it("parks the prompt in sessionStorage so a re-mounted ChatPanel reads it (survives the collapse→remount race)", () => {
    seedPromptIntoChat(SEED);

    expect(getPendingDiscussPrompt()).toBe(SEED);
  });

  it("carries the prompt text in the acropolisos:prompt event detail", () => {
    seedPromptIntoChat(SEED);

    const promptEvent = dispatched.find(
      (e) => e.type === "acropolisos:prompt",
    );
    expect(promptEvent).toBeInstanceOf(CustomEvent);
    expect((promptEvent as CustomEvent).detail).toEqual({ prompt: SEED });
  });
});
