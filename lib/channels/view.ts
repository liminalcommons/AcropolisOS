// lib/channels/view.ts
//
// The /channels PRESENTATION layer — two PURE functions the steward-gated RSC page
// composes over the flat MergedChannelItem[] that mergeDiscoveryWithBindings yields.
// NO db, NO env, NO clock, NO ontology, NO auth: just shaping + governed-token class
// maps. This is the unit-lockable core of the page (the JSX itself is held by tsc +
// the lib/route tests + the approved mockup contract).
//
//   livenessPill(status)           — BindingStatus → { label, dotClass, pillClass }.
//                                     Liveness is honest: a count + last-seen, never a
//                                     fake green light. The class strings use GOVERNED
//                                     THEME TOKENS ONLY (success / warning / destructive
//                                     / muted-foreground / border / card / foreground) —
//                                     no palette literal ever leaks out of this map.
//
//   groupChannelsByPlatform(items) — folds the FLAT list (one row per group AND per
//                                     sub-channel) into the nested tree the page paints:
//                                     per platform a list of groups (the sub_id "" rows)
//                                     each carrying its child sub-channels, plus the
//                                     bound/discovered tallies the section header shows.

import type { MergedChannelItem } from "@/lib/channels/bindings";
import type { BindingStatus } from "@/lib/channels/status";

// ── livenessPill ──────────────────────────────────────────────────────────────

export interface LivenessPill {
  label: string;
  /** Classes for the small status dot. */
  dotClass: string;
  /** Classes for the pill chip wrapper (text + faint background). */
  pillClass: string;
}

// Governed-token recipes. `bg-success/15` etc. are Tailwind opacity modifiers on a
// governed token — still the same token, just a faint fill — so the palette-literal
// discipline holds (no emerald/amber/rose literals anywhere).
const PILLS: Record<BindingStatus, LivenessPill> = {
  receiving: {
    label: "receiving",
    dotClass: "bg-success",
    pillClass: "text-success bg-success/15",
  },
  idle: {
    label: "idle",
    dotClass: "bg-warning",
    pillClass: "text-warning bg-warning/15",
  },
  awaiting: {
    label: "awaiting first message",
    dotClass: "bg-muted-foreground",
    pillClass: "text-muted-foreground bg-card",
  },
  unbound: {
    label: "discovered · unbound",
    dotClass: "bg-transparent border border-muted-foreground",
    pillClass: "text-muted-foreground bg-transparent border border-dashed border-border",
  },
  offline: {
    label: "offline",
    dotClass: "bg-destructive",
    pillClass: "text-destructive bg-destructive/15",
  },
};

export function livenessPill(status: BindingStatus): LivenessPill {
  return PILLS[status];
}

// ── groupChannelsByPlatform ─────────────────────────────────────────────────────

type Platform = "telegram" | "discord";

/** One sub-channel (topic / channel / thread) under a group, for rendering. */
export interface ChannelSubView {
  subId: string;
  scope: string;
  title?: string;
  label?: string;
  status: MergedChannelItem["status"];
  liveness: BindingStatus;
  messageCount: number;
  lastReceivedAt: Date | null;
}

/** One discovered group (a Telegram chat / Discord guild) with its sub-channels. */
export interface ChannelGroupView {
  platform: Platform;
  externalId: string;
  title?: string;
  label?: string;
  status: MergedChannelItem["status"];
  liveness: BindingStatus;
  messageCount: number;
  lastReceivedAt: Date | null;
  subChannels: ChannelSubView[];
  /** # of bound sub-channels (the group row itself is not counted). */
  boundCount: number;
  /** # of discovered-but-unbound sub-channels. */
  discoveredCount: number;
}

export interface GroupedChannels {
  telegram: ChannelGroupView[];
  discord: ChannelGroupView[];
}

function subView(it: MergedChannelItem): ChannelSubView {
  return {
    subId: it.subId,
    scope: it.scope,
    title: it.title,
    label: it.label,
    status: it.status,
    liveness: it.liveness,
    messageCount: it.messageCount,
    lastReceivedAt: it.lastReceivedAt,
  };
}

function emptyGroup(platform: Platform, externalId: string): ChannelGroupView {
  return {
    platform,
    externalId,
    title: undefined,
    label: undefined,
    status: "discovered",
    liveness: "unbound",
    messageCount: 0,
    lastReceivedAt: null,
    subChannels: [],
    boundCount: 0,
    discoveredCount: 0,
  };
}

export function groupChannelsByPlatform(items: MergedChannelItem[]): GroupedChannels {
  const buckets: Record<Platform, Map<string, ChannelGroupView>> = {
    telegram: new Map(),
    discord: new Map(),
  };
  // Preserve first-seen order within each platform.
  const order: Record<Platform, string[]> = { telegram: [], discord: [] };

  const ensure = (platform: Platform, externalId: string): ChannelGroupView => {
    const map = buckets[platform];
    let g = map.get(externalId);
    if (!g) {
      g = emptyGroup(platform, externalId);
      map.set(externalId, g);
      order[platform].push(externalId);
    }
    return g;
  };

  for (const it of items) {
    const platform = it.platform;
    const g = ensure(platform, it.externalId);
    if (it.subId === "") {
      // the group row carries the group-level facts
      g.title = it.title;
      g.label = it.label;
      g.status = it.status;
      g.liveness = it.liveness;
      g.messageCount = it.messageCount;
      g.lastReceivedAt = it.lastReceivedAt;
    } else {
      g.subChannels.push(subView(it));
      if (it.status === "bound") g.boundCount += 1;
      else if (it.status === "discovered") g.discoveredCount += 1;
    }
  }

  return {
    telegram: order.telegram.map((id) => buckets.telegram.get(id)!),
    discord: order.discord.map((id) => buckets.discord.get(id)!),
  };
}
