// lib/channels/eligibility.ts
//
// The pipeline allow-list (Task B3). A PURE predicate over the bindings ledger
// answering "may this channel source be auto-pipelined?" A source is eligible
// ONLY when the steward has BOUND and ENABLED its target:
//
//   - a group-level bind (sub_id "") allow-lists the whole group, including every
//     sub-channel/topic/thread under it;
//   - a sub-channel bind (non-empty sub_id) allow-lists just that sub — its parent
//     group is NOT implicitly allowed.
//
// "discovered" and "ignored" rows are NOT eligible; a "bound" row whose `enabled`
// switch is off is NOT eligible either (the steward's pause is honored).
//
// PURE: no db, no env, no clock. Bindings arrive pre-fetched (listBindings). This
// is the soft allow-list consulted by batch-classify (and reusable by grow): it
// never mutates the pipeline, it only decides which channel rows are sampled.

import type { ChannelBindingRow } from "@/lib/db/schema";

/** A channel source key derived from a raw_inbox row (sub_id "" = whole group). */
export interface SourceKey {
  platform: string;
  externalId: string;
  /** topic/channel/thread id; omit/"" for a message outside any sub-channel. */
  subId?: string;
}

/** A bound row counts toward the allow-list only when it is also enabled. */
function isLive(b: ChannelBindingRow): boolean {
  return b.status === "bound" && b.enabled === true;
}

/**
 * Is this channel source allow-listed for the pipeline? True iff the ledger holds
 * a bound+enabled row for either (a) the whole group (matching platform +
 * external_id with sub_id "") or (b) this exact sub-channel.
 */
export function isBound(bindings: ChannelBindingRow[], key: SourceKey): boolean {
  const subId = key.subId ?? "";
  for (const b of bindings) {
    if (!isLive(b)) continue;
    if (b.platform !== key.platform || b.external_id !== key.externalId) continue;
    // whole-group bind covers everything; otherwise the sub must match exactly.
    if (b.sub_id === "" || b.sub_id === subId) return true;
  }
  return false;
}

/**
 * Close over the ledger and return a reusable eligibility predicate. The caller
 * (batch-classify) maps each sampled raw_inbox row to a SourceKey and keeps only
 * the eligible ones.
 */
export function boundSourceFilter(
  bindings: ChannelBindingRow[],
): (key: SourceKey) => boolean {
  return (key: SourceKey) => isBound(bindings, key);
}

/** Is this raw_inbox `source` a managed channel platform (vs csv-upload etc.)? */
export function isChannelSource(source: string): source is "telegram" | "discord" {
  return source === "telegram" || source === "discord";
}

function field(p: Record<string, unknown>, k: string): string {
  const v = p[k];
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return "";
}

/**
 * Derive a SourceKey from a channel raw_inbox row's payload — mirrors the per-row
 * extraction the discovery layer uses (telegram: chat_id + message_thread_id;
 * discord: guild_id + channel_id). Returns null when the platform isn't a managed
 * channel or the group id is absent (such rows are left untouched by the filter).
 */
export function sourceKeyFromRow(
  source: string,
  payload: unknown,
): SourceKey | null {
  if (!isChannelSource(source)) return null;
  const p =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const externalId = source === "telegram" ? field(p, "chat_id") : field(p, "guild_id");
  if (externalId === "") return null;
  const subId = source === "telegram" ? field(p, "message_thread_id") : field(p, "channel_id");
  return { platform: source, externalId, subId };
}
