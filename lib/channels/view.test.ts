// lib/channels/view.test.ts
//
// The /channels PRESENTATION layer is two PURE functions — no db, no env, no clock:
//
//   livenessPill(status)          — maps a BindingStatus to the governed-token
//                                    classes + human label the UI paints. The pill
//                                    vocabulary is the SAME one the approved mockup
//                                    fixes: receiving / idle / awaiting / unbound /
//                                    ignored / offline. NO palette literal ever
//                                    leaks out of this map — every class is a
//                                    governed token (success / warning / destructive
//                                    / muted-foreground / border / card / foreground).
//
//   groupChannelsByPlatform(items)— folds the FLAT MergedChannelItem[] (one row per
//                                    group AND per sub-channel, as produced by
//                                    mergeDiscoveryWithBindings) into the nested tree
//                                    the page renders: per platform, a list of groups
//                                    (sub_id "") each carrying its child sub-channels.
//                                    Orphan sub-channels (a sub_id with no group row —
//                                    should never happen, but be safe) get a synthetic
//                                    group so nothing is silently dropped.
//
// Together these are the unit-lockable core of the RSC page; the page itself is
// covered by tsc + the route/lib tests + the mockup contract.

import { describe, expect, it } from "vitest";
import type { MergedChannelItem } from "@/lib/channels/bindings";
import type { BindingStatus } from "@/lib/channels/status";
import {
  livenessPill,
  groupChannelsByPlatform,
  type ChannelGroupView,
} from "@/lib/channels/view";

// ── livenessPill ──────────────────────────────────────────────────────────────

describe("livenessPill", () => {
  const ALL: BindingStatus[] = [
    "offline",
    "unbound",
    "awaiting",
    "receiving",
    "idle",
  ];

  it("returns a non-empty human label for every status", () => {
    for (const s of ALL) {
      const p = livenessPill(s);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it("maps each status to a STABLE distinct label (mockup vocabulary)", () => {
    expect(livenessPill("receiving").label).toBe("receiving");
    expect(livenessPill("idle").label).toBe("idle");
    expect(livenessPill("awaiting").label).toBe("awaiting first message");
    expect(livenessPill("unbound").label).toBe("discovered · unbound");
    expect(livenessPill("offline").label).toBe("offline");
  });

  it("uses ONLY governed theme tokens — never a palette literal", () => {
    // The discipline gate: no text-emerald-*, bg-amber-*, text-rose-*, etc. may
    // appear in any returned class string. Allowed token roots only.
    const PALETTE =
      /\b(?:text|bg|border|ring|fill|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/;
    for (const s of ALL) {
      const p = livenessPill(s);
      const blob = `${p.dotClass} ${p.pillClass}`;
      expect(blob).not.toMatch(PALETTE);
    }
  });

  it("paints 'receiving' with the success token and 'idle' with the warning token", () => {
    expect(livenessPill("receiving").dotClass).toContain("success");
    expect(livenessPill("idle").dotClass).toContain("warning");
  });

  it("paints 'offline' with the destructive token", () => {
    const p = livenessPill("offline");
    expect(`${p.dotClass} ${p.pillClass}`).toContain("destructive");
  });

  it("paints 'unbound' and 'awaiting' with muted tokens (never a green light)", () => {
    for (const s of ["unbound", "awaiting"] as BindingStatus[]) {
      const blob = `${livenessPill(s).dotClass} ${livenessPill(s).pillClass}`;
      expect(blob).not.toContain("success");
      expect(blob).not.toContain("destructive");
    }
  });
});

// ── groupChannelsByPlatform ─────────────────────────────────────────────────────

function item(
  over: Partial<MergedChannelItem> & Pick<MergedChannelItem, "platform" | "externalId" | "subId">,
): MergedChannelItem {
  return {
    scope: over.subId === "" ? "group" : "topic",
    title: undefined,
    label: undefined,
    status: "discovered",
    liveness: "unbound",
    messageCount: 0,
    lastReceivedAt: null,
    ...over,
  };
}

describe("groupChannelsByPlatform", () => {
  it("returns both platform buckets even when empty", () => {
    const out = groupChannelsByPlatform([]);
    expect(out.telegram).toEqual([]);
    expect(out.discord).toEqual([]);
  });

  it("nests sub-channels under their parent group, preserving order", () => {
    const items: MergedChannelItem[] = [
      item({ platform: "telegram", externalId: "G1", subId: "", title: "Hostel Ops" }),
      item({ platform: "telegram", externalId: "G1", subId: "T1", title: "maintenance", scope: "topic" }),
      item({ platform: "telegram", externalId: "G1", subId: "T2", title: "front-desk", scope: "topic" }),
    ];
    const out = groupChannelsByPlatform(items);
    expect(out.telegram).toHaveLength(1);
    const g = out.telegram[0] as ChannelGroupView;
    expect(g.title).toBe("Hostel Ops");
    expect(g.subChannels.map((s) => s.title)).toEqual(["maintenance", "front-desk"]);
  });

  it("routes telegram and discord items into separate buckets", () => {
    const items: MergedChannelItem[] = [
      item({ platform: "telegram", externalId: "TG", subId: "" }),
      item({ platform: "discord", externalId: "DC", subId: "" }),
      item({ platform: "discord", externalId: "DC", subId: "C1", scope: "channel" }),
    ];
    const out = groupChannelsByPlatform(items);
    expect(out.telegram).toHaveLength(1);
    expect(out.discord).toHaveLength(1);
    expect(out.discord[0].subChannels).toHaveLength(1);
  });

  it("synthesizes a group for an orphan sub-channel (never drops a row)", () => {
    // A sub_id whose group row is absent — defensive: keep it, don't lose it.
    const items: MergedChannelItem[] = [
      item({ platform: "discord", externalId: "ORPH", subId: "C9", title: "lonely", scope: "channel" }),
    ];
    const out = groupChannelsByPlatform(items);
    expect(out.discord).toHaveLength(1);
    expect(out.discord[0].externalId).toBe("ORPH");
    expect(out.discord[0].subChannels).toHaveLength(1);
    expect(out.discord[0].subChannels[0].title).toBe("lonely");
  });

  it("counts bound sub-channels per group for the header summary", () => {
    const items: MergedChannelItem[] = [
      item({ platform: "discord", externalId: "S", subId: "", status: "bound", liveness: "receiving" }),
      item({ platform: "discord", externalId: "S", subId: "c1", status: "bound", scope: "channel" }),
      item({ platform: "discord", externalId: "S", subId: "c2", status: "discovered", scope: "channel" }),
      item({ platform: "discord", externalId: "S", subId: "c3", status: "ignored", scope: "channel" }),
    ];
    const g = groupChannelsByPlatform(items).discord[0];
    expect(g.boundCount).toBe(1); // only c1 (the group row itself is the group, not a sub)
    expect(g.discoveredCount).toBe(1); // c2
  });
});
