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

const PULSE_CLASSES = ["ring-2", "ring-violet-400", "animate-pulse"];
const PULSE_DURATION_MS = 3000;

interface MutationEventDetail {
  types: string[];
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
    };
    window.addEventListener("acropolisos:mutation", handler);
    return () => window.removeEventListener("acropolisos:mutation", handler);
  }, []);
  return null;
}
