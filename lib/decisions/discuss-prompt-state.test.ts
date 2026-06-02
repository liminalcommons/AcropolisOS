// lib/decisions/discuss-prompt-state.test.ts
//
// Storage-resilience for the "Discuss with the agent" flow. The pending prompt
// is parked in sessionStorage so it survives the race between
// acropolisos:open-chat (dock expansion → ChatPanel mount) and the in-memory
// acropolisos:prompt event — ChatPanel consumes it on hydration regardless of
// mount timing. Mirrors the shell-state storage-wrapper test (environment:
// node, sessionStorage stubbed via vi.stubGlobal).
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getPendingDiscussPrompt,
  storePendingDiscussPrompt,
  clearPendingDiscussPrompt,
} from "@/lib/decisions/discuss-prompt-state";

describe("Pending Discuss Prompt Storage", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  it("stores and retrieves pending discuss prompt", () => {
    const prompt = "Why these options for the overbooking decision?";
    storePendingDiscussPrompt(prompt);
    expect(getPendingDiscussPrompt()).toBe(prompt);
  });

  it("returns null when no prompt is pending", () => {
    clearPendingDiscussPrompt();
    expect(getPendingDiscussPrompt()).toBeNull();
  });

  it("clears the pending prompt after retrieval", () => {
    storePendingDiscussPrompt("anything");
    getPendingDiscussPrompt();
    clearPendingDiscussPrompt();
    expect(getPendingDiscussPrompt()).toBeNull();
  });

  it("overwrites previous pending prompt when storing a new one", () => {
    storePendingDiscussPrompt("first prompt");
    storePendingDiscussPrompt("second prompt");
    expect(getPendingDiscussPrompt()).toBe("second prompt");
  });

  it("treats a null/empty prompt as a clear (stores nothing retrievable)", () => {
    storePendingDiscussPrompt("seeded");
    storePendingDiscussPrompt(null);
    expect(getPendingDiscussPrompt()).toBeNull();
  });

  it("returns null when sessionStorage throws", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(getPendingDiscussPrompt()).toBeNull();
  });
});
