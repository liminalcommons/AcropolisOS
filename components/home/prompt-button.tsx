"use client";

import { storePendingDiscussPrompt } from "@/lib/decisions/discuss-prompt-state";

interface PromptButtonProps {
  prompt: string;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}

// Seeds a prompt into the co-pilot chat, auto-expanding a collapsed dock first.
//
// On a first visit the CoPilotDock is collapsed (its default), so ChatPanel is
// unmounted and deaf to acropolisos:prompt — the seed would silently vanish,
// breaking the storyboard's magic moment. We reuse the proven decision-focus
// "Discuss with the agent" seam (decision-focus.tsx):
//   1. acropolisos:open-chat → CoPilotDock expands, ChatPanel (re)mounts
//   2. park the prompt in sessionStorage → the freshly-mounted ChatPanel reads
//      it on hydration, surviving the collapse→remount race without a timeout
//      gamble (the in-memory event below covers the already-open common case)
//   3. acropolisos:prompt → fills + focuses the composer for the open dock
export function seedPromptIntoChat(prompt: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("acropolisos:open-chat"));
  storePendingDiscussPrompt(prompt);
  window.dispatchEvent(
    new CustomEvent("acropolisos:prompt", { detail: { prompt } }),
  );
}

// Clicking a seed staging button populates the chat composer so the user can
// review/edit before sending (Voice 1 staging) — and auto-expands the dock so
// the effect is visible even from a fresh (collapsed) board.
export function PromptButton({
  prompt,
  children,
  className,
  testId,
}: PromptButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => seedPromptIntoChat(prompt)}
      className={className}
    >
      {children}
    </button>
  );
}
