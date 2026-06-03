// lib/channels/status.ts
//
// bindingLiveness — a PURE derivation of an honest, human-facing liveness status
// for a single channel binding. It reads NOTHING (no env, no clock, no db): every
// fact it needs is passed in, and the wall clock arrives as the `now` epoch-ms
// argument. That is what keeps it unit-testable and free of "fake green" — the
// status is computed only from what the caller actually observed.
//
//   configured     — is the platform even wired up (the same env flag the
//                    webhook routes 503 on)? Caller reads process.env, not us.
//   bound          — has the steward allow-listed this target into the org?
//   messageCount   — how many raw_inbox rows this target has produced.
//   lastReceivedAt — newest raw_inbox.received_at for this target (or null/none).
//   now            — injected current time (epoch ms).
//
// NO writes, NO ontology, NO auth.

/** Honest liveness of a channel binding, derived from observed facts. */
export type BindingStatus =
  | "offline" // platform not configured — nothing can ever arrive
  | "unbound" // configured, but steward has not bound this target
  | "awaiting" // bound, but no messages have arrived yet
  | "receiving" // bound, last message within the freshness window
  | "idle"; // bound, last message older than the freshness window

/** Messages newer than this (relative to `now`) count as "receiving". */
export const RECEIVING_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

export interface BindingLivenessInput {
  configured: boolean;
  bound: boolean;
  messageCount: number;
  /** Newest received_at for the target; Date | epoch-ms | null/undefined. */
  lastReceivedAt: Date | number | null | undefined;
  /** Injected wall clock (epoch ms). The module never reads the system clock. */
  now: number;
}

function toEpochMs(v: Date | number | null | undefined): number | null {
  if (v == null) return null;
  const ms = typeof v === "number" ? v : v.getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function bindingLiveness(input: BindingLivenessInput): BindingStatus {
  const { configured, bound, messageCount, now } = input;

  if (!configured) return "offline";
  if (!bound) return "unbound";
  if (messageCount <= 0) return "awaiting";

  // Bound with messages: freshness decides receiving vs idle. If we somehow have
  // a count but no usable timestamp, we cannot prove freshness → "idle".
  const lastMs = toEpochMs(input.lastReceivedAt);
  if (lastMs === null) return "idle";

  return now - lastMs <= RECEIVING_WINDOW_MS ? "receiving" : "idle";
}
