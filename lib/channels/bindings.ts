// lib/channels/bindings.ts
//
// The bindings store — the steward's curation of which DISCOVERED channel targets
// are allow-listed into the org. It is a THIN Drizzle layer over the hand-managed
// channel_bindings infra table (key = (platform, external_id, sub_id), with
// sub_id "" meaning "the whole group/server"). Paired with a PURE merge that folds
// Phase-A discoverChannels output together with the stored bindings into the
// unified item list the management UI renders.
//
// Reads/writes ONLY channel_bindings (and the merge consumes a pre-fetched
// discovery). NO ontology ctx, NO auth, NO agent actions. The merge derives an
// honest liveness via bindingLiveness — `configured` and `now` are injected by the
// caller, so this module stays env-free and clock-free.

import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { channel_bindings, type ChannelBindingRow } from "@/lib/db/schema";
import type { ChannelDiscovery } from "@/lib/channels/discovery";
import { bindingLiveness, type BindingStatus } from "@/lib/channels/status";

type Platform = "telegram" | "discord";

/** Identifies a single binding row (sub_id "" = the whole group/server). */
export interface BindingKey {
  platform: string;
  external_id: string;
  sub_id?: string;
}

/** Full target for a bind/ignore/discovered upsert. */
export interface BindingTarget extends BindingKey {
  scope: string;
  title?: string;
  label?: string;
}

/** Curation state of a target as stored / displayed. */
export type BindingState = "discovered" | "bound" | "ignored";

/** One row of the merged channels view the UI renders. */
export interface MergedChannelItem {
  platform: Platform;
  externalId: string;
  subId: string; // "" = the whole group/server
  scope: string; // "group" | "topic" | "channel" | "thread"
  title?: string;
  label?: string;
  status: BindingState;
  liveness: BindingStatus;
  messageCount: number;
  lastReceivedAt: Date | null;
}

export interface MergeOptions {
  /** Per-platform "is the webhook/token wired up" flag (caller reads env). */
  configured: Record<Platform, boolean>;
  /** Injected wall clock (epoch ms). */
  now: number;
}

const sub = (k: BindingKey): string => k.sub_id ?? "";

// ── store ────────────────────────────────────────────────────────────────────

/** All binding rows (the steward's full curation ledger). */
export async function listBindings(db: Database): Promise<ChannelBindingRow[]> {
  return (await db.select().from(channel_bindings)) as ChannelBindingRow[];
}

/** UPSERT a target as bound + enabled (re-binding updates the same row, no dup). */
export async function bindTarget(db: Database, target: BindingTarget): Promise<void> {
  const sub_id = sub(target);
  await db
    .insert(channel_bindings)
    .values({
      platform: target.platform,
      scope: target.scope,
      external_id: target.external_id,
      sub_id,
      title: target.title ?? null,
      label: target.label ?? null,
      status: "bound",
      enabled: true,
    })
    .onConflictDoUpdate({
      target: [channel_bindings.platform, channel_bindings.external_id, channel_bindings.sub_id],
      set: {
        status: "bound",
        enabled: true,
        scope: target.scope,
        ...(target.title !== undefined ? { title: target.title } : {}),
        ...(target.label !== undefined ? { label: target.label } : {}),
        updated_at: new Date(),
      },
    });
}

/** UPSERT a target as ignored (muted — kept off the pipeline). */
export async function ignoreTarget(db: Database, key: BindingKey & { scope?: string }): Promise<void> {
  const sub_id = sub(key);
  await db
    .insert(channel_bindings)
    .values({
      platform: key.platform,
      scope: key.scope ?? "group",
      external_id: key.external_id,
      sub_id,
      status: "ignored",
      enabled: false,
    })
    .onConflictDoUpdate({
      target: [channel_bindings.platform, channel_bindings.external_id, channel_bindings.sub_id],
      set: { status: "ignored", updated_at: new Date() },
    });
}

/** Flip the on/off switch for an existing keyed row. */
export async function setEnabled(db: Database, key: BindingKey, enabled: boolean): Promise<void> {
  await db
    .update(channel_bindings)
    .set({ enabled, updated_at: new Date() })
    .where(keyWhere(key));
}

/** Set the steward label for an existing keyed row. */
export async function relabel(db: Database, key: BindingKey, label: string): Promise<void> {
  await db
    .update(channel_bindings)
    .set({ label, updated_at: new Date() })
    .where(keyWhere(key));
}

/**
 * Inventory upsert used by the Gateway worker: record a freshly-seen target as
 * status:"discovered", enabled:false IF it isn't already present. An existing row
 * (discovered/bound/ignored) is left UNTOUCHED — the steward's curation wins.
 */
export async function upsertDiscovered(db: Database, target: BindingTarget): Promise<void> {
  await db
    .insert(channel_bindings)
    .values({
      platform: target.platform,
      scope: target.scope,
      external_id: target.external_id,
      sub_id: sub(target),
      title: target.title ?? null,
      status: "discovered",
      enabled: false,
    })
    .onConflictDoNothing({
      target: [channel_bindings.platform, channel_bindings.external_id, channel_bindings.sub_id],
    });
}

function keyWhere(key: BindingKey) {
  return and(
    eq(channel_bindings.platform, key.platform),
    eq(channel_bindings.external_id, key.external_id),
    eq(channel_bindings.sub_id, sub(key)),
  );
}

// ── pure merge ───────────────────────────────────────────────────────────────

const keyOf = (platform: string, externalId: string, subId: string) =>
  `${platform}:${externalId}:${subId}`;

/**
 * Fold discovery (what raw_inbox has actually seen) together with the stored
 * bindings (the steward's curation) into the unified item list the UI renders.
 * One item per discovered group AND per discovered sub-channel; each tagged with
 * its binding state and an honest liveness. PURE — `now`/`configured` injected.
 */
export function mergeDiscoveryWithBindings(
  discovery: ChannelDiscovery,
  bindings: ChannelBindingRow[],
  opts: MergeOptions,
): MergedChannelItem[] {
  const byKey = new Map<string, ChannelBindingRow>();
  for (const b of bindings) {
    byKey.set(keyOf(b.platform, b.external_id, b.sub_id), b);
  }

  const items: MergedChannelItem[] = [];
  const platforms: Platform[] = ["telegram", "discord"];

  for (const platform of platforms) {
    const configured = opts.configured[platform] ?? false;
    for (const group of discovery[platform]) {
      // the group itself (sub_id "")
      items.push(
        toItem(platform, group.externalId, "", "group", group.title, group.messageCount, group.lastReceivedAt, byKey, configured, opts.now),
      );
      // each sub-channel
      for (const s of group.subChannels) {
        items.push(
          toItem(platform, group.externalId, s.subId, s.scope, s.title, s.messageCount, s.lastReceivedAt, byKey, configured, opts.now),
        );
      }
    }
  }

  return items;
}

function toItem(
  platform: Platform,
  externalId: string,
  subId: string,
  scope: string,
  discoveredTitle: string | undefined,
  messageCount: number,
  lastReceivedAt: Date | null,
  byKey: Map<string, ChannelBindingRow>,
  configured: boolean,
  now: number,
): MergedChannelItem {
  const b = byKey.get(keyOf(platform, externalId, subId));
  const status: BindingState = (b?.status as BindingState) ?? "discovered";
  // "bound" is the only state that wires the target onto the pipeline; ignored
  // and discovered are both effectively unbound for liveness purposes.
  const bound = status === "bound";
  const liveness = bindingLiveness({
    configured,
    bound,
    messageCount,
    lastReceivedAt,
    now,
  });
  return {
    platform,
    externalId,
    subId,
    scope: b?.scope ?? scope,
    title: b?.title ?? discoveredTitle,
    label: b?.label ?? undefined,
    status,
    liveness,
    messageCount,
    lastReceivedAt,
  };
}
