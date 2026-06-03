// lib/channels/discovery.ts
//
// discoverChannels(db) — a READ-ONLY aggregation over raw_inbox answering
// "what groups / channels / threads have we actually received messages from?"
//
// It selects the staged rows and reduces them IN JS (correctness over cleverness;
// the plan explicitly permits fetch-and-reduce over an awkward SQL-json group-by).
// Per platform it returns a list of discovered groups:
//
//   { platform, externalId, title, messageCount, firstReceivedAt, lastReceivedAt,
//     subChannels: [{ subId, scope, title?, messageCount, lastReceivedAt }] }
//
//   Telegram: group by payload.chat_id; sub-channels = message_thread_id topics.
//   Discord:  group by payload.guild_id; sub-channels = channel_id channels.
//
// Rows whose id bucket is absent fall under the "(unknown)" group — never dropped.
// A row with no sub-id (e.g. a Telegram message outside any topic) counts toward
// the group only, never inventing a sub-channel.
//
// NO writes, NO ontology, NO auth. This module reads raw_inbox and nothing else.

import type { Database } from "@/lib/db/client";
import { raw_inbox } from "@/lib/db/schema";

export const UNKNOWN_BUCKET = "(unknown)";

/** A topic (Telegram) or channel (Discord) within a discovered group. */
export interface DiscoveredSubChannel {
  subId: string;
  scope: "topic" | "channel";
  title?: string;
  messageCount: number;
  lastReceivedAt: Date;
}

/** A discovered group: a Telegram chat or a Discord guild. */
export interface DiscoveredGroup {
  platform: "telegram" | "discord";
  externalId: string;
  title?: string;
  messageCount: number;
  firstReceivedAt: Date;
  lastReceivedAt: Date;
  subChannels: DiscoveredSubChannel[];
}

export interface ChannelDiscovery {
  telegram: DiscoveredGroup[];
  discord: DiscoveredGroup[];
}

// Per-platform extraction of (groupId, groupTitle, subId, subTitle) from a row's
// payload. Kept as data so the reduce loop stays uniform across platforms.
interface PlatformSpec {
  platform: "telegram" | "discord";
  subScope: "topic" | "channel";
  groupId: (p: Record<string, unknown>) => string | null;
  groupTitle: (p: Record<string, unknown>) => string | undefined;
  subId: (p: Record<string, unknown>) => string | null;
  subTitle: (p: Record<string, unknown>) => string | undefined;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.length > 0 ? v : null;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return null;
}

function title(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

const SPECS: Record<string, PlatformSpec> = {
  telegram: {
    platform: "telegram",
    subScope: "topic",
    groupId: (p) => str(p.chat_id),
    groupTitle: (p) => title(p.chat_title),
    subId: (p) => str(p.message_thread_id),
    subTitle: (p) => title(p.thread_title), // optional; usually absent
  },
  discord: {
    platform: "discord",
    subScope: "channel",
    groupId: (p) => str(p.guild_id),
    groupTitle: (p) => title(p.guild_name),
    subId: (p) => str(p.channel_id),
    subTitle: (p) => title(p.channel_name), // optional; absent on the webhook path
  },
};

// Mutable accumulators (converted to the immutable result shape at the end).
interface GroupAcc {
  platform: "telegram" | "discord";
  externalId: string;
  title?: string;
  messageCount: number;
  first: Date;
  last: Date;
  subs: Map<string, SubAcc>;
}
interface SubAcc {
  subId: string;
  scope: "topic" | "channel";
  title?: string;
  messageCount: number;
  last: Date;
}

type RawRow = { source: string; payload: unknown; received_at: Date };

export async function discoverChannels(db: Database): Promise<ChannelDiscovery> {
  const rows = (await db.select().from(raw_inbox)) as RawRow[];

  const groupsByPlatform: Record<string, Map<string, GroupAcc>> = {
    telegram: new Map(),
    discord: new Map(),
  };

  for (const row of rows) {
    const spec = SPECS[row.source];
    if (!spec) continue; // unrelated source (csv webhook, etc.)

    const payload =
      row.payload && typeof row.payload === "object"
        ? (row.payload as Record<string, unknown>)
        : {};
    const receivedAt =
      row.received_at instanceof Date ? row.received_at : new Date(row.received_at as never);

    const gid = spec.groupId(payload) ?? UNKNOWN_BUCKET;
    const groups = groupsByPlatform[spec.platform];

    let g = groups.get(gid);
    if (!g) {
      g = {
        platform: spec.platform,
        externalId: gid,
        title: spec.groupTitle(payload),
        messageCount: 0,
        first: receivedAt,
        last: receivedAt,
        subs: new Map(),
      };
      groups.set(gid, g);
    }
    g.messageCount += 1;
    if (receivedAt < g.first) g.first = receivedAt;
    if (receivedAt > g.last) g.last = receivedAt;
    if (g.title === undefined) g.title = spec.groupTitle(payload);

    const sid = spec.subId(payload);
    if (sid !== null) {
      let s = g.subs.get(sid);
      if (!s) {
        s = {
          subId: sid,
          scope: spec.subScope,
          title: spec.subTitle(payload),
          messageCount: 0,
          last: receivedAt,
        };
        g.subs.set(sid, s);
      }
      s.messageCount += 1;
      if (receivedAt > s.last) s.last = receivedAt;
      if (s.title === undefined) s.title = spec.subTitle(payload);
    }
  }

  const finalize = (groups: Map<string, GroupAcc>): DiscoveredGroup[] =>
    [...groups.values()].map((g) => ({
      platform: g.platform,
      externalId: g.externalId,
      title: g.title,
      messageCount: g.messageCount,
      firstReceivedAt: g.first,
      lastReceivedAt: g.last,
      subChannels: [...g.subs.values()].map((s) => ({
        subId: s.subId,
        scope: s.scope,
        title: s.title,
        messageCount: s.messageCount,
        lastReceivedAt: s.last,
      })),
    }));

  return {
    telegram: finalize(groupsByPlatform.telegram),
    discord: finalize(groupsByPlatform.discord),
  };
}
