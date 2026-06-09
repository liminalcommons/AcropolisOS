// workers/discord-gateway/volume.test.ts
//
// E2 — Gateway volume control + discovery inventory.
//
// Two units, both pure/store-level (no network, no real discord.js client):
//
//   1. shouldIngest(boundView, guild_id, channel_id) — the ANTI-FLOOD predicate.
//      The worker ingests a message ONLY when its (guild,channel) is bound+enabled.
//      It delegates to the SAME eligibility semantics batch-classify uses (isBound):
//      a whole-guild bind (sub_id "") covers every channel; a channel bind
//      (sub_id = channel_id) covers just that channel; discovered/ignored/disabled
//      rows do NOT ingest.
//
//   2. discoverGuild(db, guild) — on 'ready'/'guildCreate' the worker records each
//      visible guild + text channel into channel_bindings as status:"discovered",
//      enabled:false via upsertDiscovered (which is onConflictDoNothing — an already
//      bound/ignored/discovered row is left untouched; the steward's curation wins).
//      Data-only inventory: it calls ONLY upsertDiscovered, never auth/ontology.

import { describe, expect, it, vi, beforeEach } from "vitest";

// upsertDiscovered is the only store touch discoverGuild may make. Mock it so the
// test is store-level (no DB). vi.hoisted so the mock exists when vi.mock runs.
const { upsertDiscovered } = vi.hoisted(() => ({
  upsertDiscovered: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/channels/bindings", () => ({ upsertDiscovered }));

import { shouldIngest, discoverGuild, type DiscoverableGuild } from "@/workers/discord-gateway/index";
import type { Database } from "@/lib/db/client";
import type { ChannelBindingRow } from "@/lib/db/schema";

const db = {} as Database; // never used — upsertDiscovered is mocked

function binding(over: Partial<ChannelBindingRow>): ChannelBindingRow {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    platform: "discord",
    scope: "channel",
    external_id: "guild-1",
    sub_id: "",
    title: null,
    label: null,
    status: "bound",
    enabled: true,
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  } as ChannelBindingRow;
}

describe("shouldIngest (anti-flood bound-filter)", () => {
  it("ingests when the whole guild is bound+enabled (sub_id '')", () => {
    const view = [binding({ external_id: "guild-1", sub_id: "" })];
    expect(shouldIngest(view, "guild-1", "chan-99")).toBe(true);
  });

  it("ingests when the exact channel is bound+enabled (sub_id = channel_id)", () => {
    const view = [binding({ external_id: "guild-1", sub_id: "chan-7", scope: "channel" })];
    expect(shouldIngest(view, "guild-1", "chan-7")).toBe(true);
    // a DIFFERENT channel in the same guild is NOT covered by a channel-level bind
    expect(shouldIngest(view, "guild-1", "chan-8")).toBe(false);
  });

  it("does NOT ingest a discovered (un-bound) target", () => {
    const view = [binding({ external_id: "guild-1", sub_id: "chan-7", status: "discovered", enabled: false })];
    expect(shouldIngest(view, "guild-1", "chan-7")).toBe(false);
  });

  it("does NOT ingest an ignored target", () => {
    const view = [binding({ external_id: "guild-1", sub_id: "", status: "ignored", enabled: false })];
    expect(shouldIngest(view, "guild-1", "chan-7")).toBe(false);
  });

  it("does NOT ingest a bound-but-disabled target (steward paused)", () => {
    const view = [binding({ external_id: "guild-1", sub_id: "", status: "bound", enabled: false })];
    expect(shouldIngest(view, "guild-1", "chan-7")).toBe(false);
  });

  it("does NOT ingest when nothing is bound (empty / unrelated ledger)", () => {
    expect(shouldIngest([], "guild-1", "chan-7")).toBe(false);
    const view = [binding({ external_id: "other-guild", sub_id: "" })];
    expect(shouldIngest(view, "guild-1", "chan-7")).toBe(false);
  });
});

describe("discoverGuild (data-only inventory upsert)", () => {
  beforeEach(() => upsertDiscovered.mockClear());

  function guild(): DiscoverableGuild {
    return {
      id: "guild-1",
      name: "Hostel Ops",
      channels: {
        cache: new Map<string, { id: string; name?: string; type: number }>([
          ["chan-1", { id: "chan-1", name: "general", type: 0 }],
          ["chan-2", { id: "chan-2", name: "ops", type: 0 }],
          ["voice-1", { id: "voice-1", name: "Lounge", type: 2 }], // voice — skipped
        ]),
      },
    };
  }

  it("upserts the guild itself (sub_id '') as discovered", async () => {
    await discoverGuild(db, guild());
    const calls = upsertDiscovered.mock.calls.map((c) => c[1]);
    expect(calls).toContainEqual({
      platform: "discord",
      scope: "group",
      external_id: "guild-1",
      sub_id: "",
      title: "Hostel Ops",
    });
  });

  it("upserts each TEXT channel (skips voice/non-text) as discovered", async () => {
    await discoverGuild(db, guild());
    const calls = upsertDiscovered.mock.calls.map((c) => c[1]);
    expect(calls).toContainEqual({
      platform: "discord",
      scope: "channel",
      external_id: "guild-1",
      sub_id: "chan-1",
      title: "general",
    });
    expect(calls).toContainEqual({
      platform: "discord",
      scope: "channel",
      external_id: "guild-1",
      sub_id: "chan-2",
      title: "ops",
    });
    // voice channel must NOT be inventoried (only text channels pipeline messages)
    const subIds = calls.map((t) => t.sub_id);
    expect(subIds).not.toContain("voice-1");
    // guild + 2 text channels = 3 upserts total
    expect(upsertDiscovered).toHaveBeenCalledTimes(3);
  });

  it("passes db through to the store (data-only — no other store call)", async () => {
    await discoverGuild(db, guild());
    for (const call of upsertDiscovered.mock.calls) {
      expect(call[0]).toBe(db);
    }
  });
});
