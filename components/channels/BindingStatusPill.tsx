// components/channels/BindingStatusPill.tsx
//
// The honest liveness chip for the steward /channels surface. A BindingStatus is
// mapped to a governed-token pill (text + faint fill + dot) and the stable human
// label fixed by the approved mockup legend
// (.chora/artifacts/2026-06-02-acropolisos-channels-ui-mockup.html):
//   receiving → success · idle → warning · awaiting/unbound → muted · offline →
//   destructive. Liveness is honest — a count + last-seen, never a fake green light.
//
// The token recipes live in the already-tested PURE livenessPill map
// (lib/channels/view.ts); this module composes them with the chip wrapper layout
// and exposes a render-free `bindingStatusPill()` so the mapping is unit-lockable
// (BindingStatusPill.test.ts) without a DOM env. GOVERNED THEME TOKENS ONLY.
//
// No db, no env, no clock, no client state — pure presentation.

import { livenessPill } from "@/lib/channels/view";
import type { BindingStatus } from "@/lib/channels/status";

/** Full presentation for a liveness chip: label + dot/pill/wrapper class strings. */
export interface BindingStatusPresentation {
  label: string;
  /** Classes for the small status dot (governed token fill / border). */
  dotClass: string;
  /** Classes for the text + faint background of the chip (governed tokens). */
  pillClass: string;
  /** The chip wrapper layout (rounded-full + padding + type scale). */
  wrapperClass: string;
}

const WRAPPER =
  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold";

/**
 * PURE: BindingStatus → its label + governed-token classes. Delegates the token
 * recipe to livenessPill (single source of truth) and adds the chip wrapper.
 */
export function bindingStatusPill(status: BindingStatus): BindingStatusPresentation {
  const p = livenessPill(status);
  return {
    label: p.label,
    dotClass: p.dotClass,
    pillClass: p.pillClass,
    wrapperClass: WRAPPER,
  };
}

/** The honest liveness chip (dot + label) for a single binding status. */
export function BindingStatusPill({
  status,
}: {
  status: BindingStatus;
}): React.ReactElement {
  const p = bindingStatusPill(status);
  return (
    <span className={`${p.wrapperClass} ${p.pillClass}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${p.dotClass}`} />
      {p.label}
    </span>
  );
}

/** The standalone leading status dot (used on a card's left rail). */
export function LivenessDot({
  status,
}: {
  status: BindingStatus;
}): React.ReactElement {
  const p = bindingStatusPill(status);
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${p.dotClass}`} />;
}
