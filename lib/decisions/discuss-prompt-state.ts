// lib/decisions/discuss-prompt-state.ts
//
// Resilience for the "Discuss with the agent" flow on a decision. Clicking it
// dispatches acropolisos:open-chat (expands the co-pilot dock → mounts
// ChatPanel) and acropolisos:prompt (fills the composer). Those two are racy:
// while the dock is collapsed ChatPanel is unmounted and so deaf to
// acropolisos:prompt, and a freshly-mounted ChatPanel may miss the in-memory
// event entirely. Parking the prompt in sessionStorage lets ChatPanel consume
// it on hydration regardless of mount timing — survives the race without a
// setTimeout gamble. Single-tab scoped (sessionStorage), so a stale prompt
// can't bleed across browser sessions.
//
// Mirrors the shell-state storage-wrapper pattern: globalThis.sessionStorage?
// guarded by try/catch (private browsing / quota / SSR all degrade to no-op).

const DISCUSS_PENDING_KEY = "acro.discuss.pending";

export function getPendingDiscussPrompt(): string | null {
  try {
    return globalThis.sessionStorage?.getItem(DISCUSS_PENDING_KEY) ?? null;
  } catch {
    return null;
  }
}

export function storePendingDiscussPrompt(prompt: string | null): void {
  // A null/empty prompt is a clear, never a stored sentinel — so a later read
  // returns null and ChatPanel doesn't fill the composer with garbage.
  if (!prompt) {
    clearPendingDiscussPrompt();
    return;
  }
  try {
    globalThis.sessionStorage?.setItem(DISCUSS_PENDING_KEY, prompt);
  } catch {
    // private browsing / quota — ignore; the in-memory event is the fallback.
  }
}

export function clearPendingDiscussPrompt(): void {
  try {
    globalThis.sessionStorage?.removeItem(DISCUSS_PENDING_KEY);
  } catch {
    // ignore
  }
}
