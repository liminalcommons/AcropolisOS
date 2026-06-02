"use client";

import { useEffect } from "react";

// S4 · Widget glow on mutation.
//
// Listens for `window` `acropolisos:mutation` CustomEvents dispatched by the
// chat panel after a fresh proposal lands. The event detail carries a list of
// type keys touched by the proposal; this mount finds the matching type cards
// in the DOM (via `[data-type="..."]`, case-insensitive — proposal
// impacted_tables are snake_case while ontology keys are PascalCase) and
// applies a 3-second pulse class.
//
// Mounted once in app/layout.tsx so every home variant (Empty/Seeded/Live)
// gets the same animation without each component having to wire up its own
// listener.

const PULSE_CLASSES = ["ring-2", "ring-primary", "animate-pulse"];
const PULSE_DURATION_MS = 3000;

// ── Proposal-landing toast contract (exported for tests + reuse) ───────────────

// Where the toast's review CTA points: the human-in-the-loop proposal gate.
export const TOAST_LINK_HREF = "/organize";

// How long the "proposal is ready" toast stays before auto-dismissing.
export const TOAST_DURATION_MS = 5000;

// Toast copy — names the moment (a proposal landed) and the next action
// (review it). Kept pure so the contract is unit-testable. `types` is accepted
// so the message can hint at scale without leaking domain literals.
export function proposalToastMessage(types: string[]): string {
  const n = types.length;
  const scope =
    n === 1 ? "a new type" : n > 1 ? `${n} types` : "your data";
  return `Proposal ready for ${scope} — review it at /organize`;
}

const TOAST_ID = "acropolisos-proposal-toast";

interface MutationEventDetail {
  types: string[];
}

// Imperative DOM toast (this mount renders null and already manipulates the DOM
// for the pulse — keeping the toast in the same style avoids adding a portal /
// state machine for a 5s ephemeral notice). Themed via shell CSS vars so it
// inherits whatever skin is resolved server-side.
function showProposalToast(types: string[]): void {
  if (typeof document === "undefined") return;
  document.getElementById(TOAST_ID)?.remove();

  const toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.setAttribute("role", "status");
  toast.style.cssText = [
    "position:fixed",
    "left:50%",
    "bottom:5rem",
    "transform:translateX(-50%)",
    "z-index:50",
    "display:flex",
    "align-items:center",
    "gap:0.75rem",
    "max-width:90vw",
    "padding:0.625rem 1rem",
    "border-radius:0.75rem",
    "border:1px solid var(--border)",
    "background:var(--card)",
    "color:var(--card-foreground)",
    "box-shadow:0 8px 30px rgba(0,0,0,0.35)",
    "font-size:0.8125rem",
  ].join(";");

  const label = document.createElement("span");
  label.textContent = proposalToastMessage(types);
  toast.appendChild(label);

  const link = document.createElement("a");
  link.href = TOAST_LINK_HREF;
  link.textContent = "Review →";
  link.style.cssText = [
    "color:var(--primary)",
    "font-weight:600",
    "text-decoration:none",
    "white-space:nowrap",
  ].join(";");
  toast.appendChild(link);

  document.body.appendChild(toast);
  setTimeout(() => {
    document.getElementById(TOAST_ID)?.remove();
  }, TOAST_DURATION_MS);
}

export function MutationPulseMount(): null {
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<MutationEventDetail>).detail;
      if (!detail || !Array.isArray(detail.types) || detail.types.length === 0)
        return;
      const wanted = new Set(detail.types.map((t) => t.toLowerCase()));
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>("[data-type]"),
      );
      const targets = candidates.filter((el) => {
        const dt = el.getAttribute("data-type")?.toLowerCase();
        return dt ? wanted.has(dt) : false;
      });
      targets.forEach((el) => {
        el.classList.add(...PULSE_CLASSES);
        setTimeout(() => {
          el.classList.remove(...PULSE_CLASSES);
        }, PULSE_DURATION_MS);
      });

      // Surface a transient toast so the user knows a proposal landed and where
      // to review it — the chat → proposal → approve loop becomes visible even
      // when no matching card is on screen yet (empty board, first proposal).
      showProposalToast(detail.types);
    };
    window.addEventListener("acropolisos:mutation", handler);
    return () => window.removeEventListener("acropolisos:mutation", handler);
  }, []);
  return null;
}
