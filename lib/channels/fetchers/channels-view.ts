// lib/channels/fetchers/channels-view.ts
//
// The READ-ONLY server fetcher for the steward /channels page. It is the single
// place that touches the db for that page and the single place that reads env +
// the clock — keeping every module BELOW it pure and unit-testable.
//
// It composes the committed Phase-A/B building blocks:
//
//   discoverChannels(db)            — what raw_inbox has actually received (READ).
//   listBindings(db)                — the steward's curation ledger          (READ).
//   mergeDiscoveryWithBindings(...) — PURE fold into the flat item list,
//                                     with `now` + `configured` injected here.
//   groupChannelsByPlatform(...)    — PURE fold into the nested per-platform tree.
//
// `configured` per platform comes from env, EQUALLY for both platforms:
//   telegram = !!process.env.TELEGRAM_WEBHOOK_SECRET   (the webhook 503s without it)
//   discord  = !!process.env.DISCORD_BOT_TOKEN
//
// `now` is injected at the boundary (default Date.now()) so the pure modules never
// read the system clock — that is what keeps liveness honest and the composition
// deterministic under test.
//
// The returned shape is SERIALIZABLE: every Date becomes an ISO string (or null),
// so an RSC page can hand it straight across the server→client boundary.
//
// NO writes, NO ontology ctx, NO auth, NO intake/security path. Steward-gating
// lives in the route/page that CALLS this, not here.

import type { Database } from "@/lib/db/client";
import { discoverChannels } from "@/lib/channels/discovery";
import { listBindings, mergeDiscoveryWithBindings } from "@/lib/channels/bindings";
import { groupChannelsByPlatform } from "@/lib/channels/view";
import type { BindingState, MergedChannelItem } from "@/lib/channels/bindings";
import type { BindingStatus } from "@/lib/channels/status";

type Platform = "telegram" | "discord";

/** A sub-channel (Telegram topic / Discord channel) under a group — serializable. */
export interface SerializableChannelSub {
  subId: string;
  scope: string;
  title?: string;
  label?: string;
  status: BindingState;
  liveness: BindingStatus;
  messageCount: number;
  /** ISO 8601 string, or null when no message has ever been seen. */
  lastReceivedAt: string | null;
}

/** A discovered group (Telegram chat / Discord guild) with its sub-channels. */
export interface SerializableChannelGroup {
  platform: Platform;
  externalId: string;
  title?: string;
  label?: string;
  status: BindingState;
  liveness: BindingStatus;
  messageCount: number;
  lastReceivedAt: string | null;
  subChannels: SerializableChannelSub[];
  /** # of bound sub-channels (the group row itself is not counted). */
  boundCount: number;
  /** # of discovered-but-unbound sub-channels. */
  discoveredCount: number;
}

/**
 * The full steward channels view: the two platforms EQUALLY, plus the per-platform
 * `configured` flags (so the page can honestly say "offline — not wired up" vs.
 * "wired up, nothing bound yet"). Fully JSON-serializable.
 */
export interface ChannelsView {
  telegram: SerializableChannelGroup[];
  discord: SerializableChannelGroup[];
  configured: Record<Platform, boolean>;
}

export interface FetchChannelsViewOptions {
  /** Injected wall clock (epoch ms). Defaults to Date.now() at the boundary. */
  now?: number;
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/** Read env EQUALLY for both platforms — the same flags the webhook routes gate on. */
function readConfigured(): Record<Platform, boolean> {
  return {
    telegram: !!process.env.TELEGRAM_WEBHOOK_SECRET,
    discord: !!process.env.DISCORD_BOT_TOKEN,
  };
}

export async function fetchChannelsView(
  db: Database,
  opts: FetchChannelsViewOptions = {},
): Promise<ChannelsView> {
  const now = opts.now ?? Date.now();
  const configured = readConfigured();

  // Two READ-ONLY db hits: what we've seen, and what the steward has curated.
  const [discovery, bindings] = await Promise.all([
    discoverChannels(db),
    listBindings(db),
  ]);

  // Pure fold → flat items (now + configured injected here, never read below).
  const items: MergedChannelItem[] = mergeDiscoveryWithBindings(discovery, bindings, {
    configured,
    now,
  });

  // Pure fold → nested per-platform tree, then serialize timestamps.
  const grouped = groupChannelsByPlatform(items);

  return {
    telegram: grouped.telegram.map(serializeGroup),
    discord: grouped.discord.map(serializeGroup),
    configured,
  };
}

function serializeGroup(g: ReturnType<typeof groupChannelsByPlatform>["telegram"][number]): SerializableChannelGroup {
  return {
    platform: g.platform,
    externalId: g.externalId,
    title: g.title,
    label: g.label,
    status: g.status,
    liveness: g.liveness,
    messageCount: g.messageCount,
    lastReceivedAt: iso(g.lastReceivedAt),
    subChannels: g.subChannels.map((s) => ({
      subId: s.subId,
      scope: s.scope,
      title: s.title,
      label: s.label,
      status: s.status,
      liveness: s.liveness,
      messageCount: s.messageCount,
      lastReceivedAt: iso(s.lastReceivedAt),
    })),
    boundCount: g.boundCount,
    discoveredCount: g.discoveredCount,
  };
}
