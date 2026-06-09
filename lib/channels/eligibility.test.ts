// lib/channels/eligibility.test.ts
//
// The pipeline allow-list (Task B3). A PURE predicate over the bindings ledger:
// a channel source is "eligible" to be auto-pipelined (sampled by batch-classify)
// ONLY when the steward has bound AND enabled its (platform, external_id[, sub_id]).
//
//   isBound(bindings, key)         → true iff a matching row is status:"bound" && enabled
//   boundSourceFilter(bindings)    → (key) => boolean, closing over the ledger
//
// Group-level bind (sub_id "") covers the whole group; a sub-channel bind covers
// just that sub. Non-channel sources (csv-upload etc.) are NOT this module's
// concern — the caller only consults it for telegram/discord rows.
//
// PURE: no db, no env, no clock. Bindings are passed in pre-fetched.

import { describe, expect, it } from "vitest";
import {
  boundSourceFilter,
  isBound,
  isChannelSource,
  sourceKeyFromRow,
} from "@/lib/channels/eligibility";
import type { ChannelBindingRow } from "@/lib/db/schema";

function binding(over: Partial<ChannelBindingRow>): ChannelBindingRow {
  return {
    id: "b-" + Math.random().toString(36).slice(2),
    platform: "telegram",
    scope: "group",
    external_id: "100",
    sub_id: "",
    title: null,
    label: null,
    status: "bound",
    enabled: true,
    created_at: new Date(0),
    updated_at: new Date(0),
    ...over,
  } as ChannelBindingRow;
}

describe("isBound", () => {
  it("a bound+enabled group includes the group itself", () => {
    const rows = [binding({ platform: "telegram", external_id: "100", sub_id: "" })];
    expect(isBound(rows, { platform: "telegram", externalId: "100" })).toBe(true);
  });

  it("a bound+enabled group includes its sub-channels", () => {
    const rows = [binding({ platform: "telegram", external_id: "100", sub_id: "" })];
    expect(isBound(rows, { platform: "telegram", externalId: "100", subId: "7" })).toBe(true);
  });

  it("a bound sub-channel includes that sub even when the group is not bound", () => {
    const rows = [
      binding({ platform: "telegram", external_id: "100", sub_id: "7", scope: "topic" }),
    ];
    expect(isBound(rows, { platform: "telegram", externalId: "100", subId: "7" })).toBe(true);
    // the group itself is NOT bound
    expect(isBound(rows, { platform: "telegram", externalId: "100" })).toBe(false);
  });

  it("an ignored target is excluded", () => {
    const rows = [
      binding({ platform: "telegram", external_id: "100", sub_id: "", status: "ignored", enabled: false }),
    ];
    expect(isBound(rows, { platform: "telegram", externalId: "100" })).toBe(false);
  });

  it("a discovered-but-unbound target is excluded", () => {
    const rows = [
      binding({ platform: "discord", external_id: "g1", sub_id: "", status: "discovered", enabled: false }),
    ];
    expect(isBound(rows, { platform: "discord", externalId: "g1" })).toBe(false);
  });

  it("a bound-but-DISABLED target is excluded (the on/off switch is honored)", () => {
    const rows = [
      binding({ platform: "telegram", external_id: "100", sub_id: "", status: "bound", enabled: false }),
    ];
    expect(isBound(rows, { platform: "telegram", externalId: "100" })).toBe(false);
  });

  it("an unknown target (no row at all) is excluded", () => {
    const rows = [binding({ platform: "telegram", external_id: "100", sub_id: "" })];
    expect(isBound(rows, { platform: "discord", externalId: "999" })).toBe(false);
  });

  it("platform must match — a telegram bind does not allow-list a discord guild of the same id", () => {
    const rows = [binding({ platform: "telegram", external_id: "555", sub_id: "" })];
    expect(isBound(rows, { platform: "discord", externalId: "555" })).toBe(false);
  });
});

describe("boundSourceFilter", () => {
  it("closes over the ledger and returns a reusable predicate", () => {
    const rows = [
      binding({ platform: "telegram", external_id: "100", sub_id: "", status: "bound", enabled: true }),
      binding({ platform: "discord", external_id: "g1", sub_id: "", status: "ignored", enabled: false }),
    ];
    const eligible = boundSourceFilter(rows);
    expect(eligible({ platform: "telegram", externalId: "100" })).toBe(true);
    expect(eligible({ platform: "telegram", externalId: "100", subId: "7" })).toBe(true);
    expect(eligible({ platform: "discord", externalId: "g1" })).toBe(false); // ignored
    expect(eligible({ platform: "discord", externalId: "nope" })).toBe(false); // unknown
  });

  it("an empty ledger allow-lists nothing", () => {
    const eligible = boundSourceFilter([]);
    expect(eligible({ platform: "telegram", externalId: "100" })).toBe(false);
  });
});

describe("isChannelSource", () => {
  it("recognizes telegram and discord", () => {
    expect(isChannelSource("telegram")).toBe(true);
    expect(isChannelSource("discord")).toBe(true);
  });
  it("rejects non-channel sources (csv-upload etc.)", () => {
    expect(isChannelSource("csv-upload")).toBe(false);
    expect(isChannelSource("")).toBe(false);
  });
});

describe("sourceKeyFromRow", () => {
  it("returns null for a non-channel source (left untouched by the filter)", () => {
    expect(sourceKeyFromRow("csv-upload", { anything: 1 })).toBeNull();
  });

  it("extracts a telegram group + topic from chat_id / message_thread_id", () => {
    const k = sourceKeyFromRow("telegram", { chat_id: 100, message_thread_id: 7, text: "hi" });
    expect(k).toEqual({ platform: "telegram", externalId: "100", subId: "7" });
  });

  it("extracts a discord guild + channel from guild_id / channel_id", () => {
    const k = sourceKeyFromRow("discord", { guild_id: "g1", channel_id: "c1" });
    expect(k).toEqual({ platform: "discord", externalId: "g1", subId: "c1" });
  });

  it("a telegram message outside any topic yields subId '' (group-level)", () => {
    const k = sourceKeyFromRow("telegram", { chat_id: "100" });
    expect(k).toEqual({ platform: "telegram", externalId: "100", subId: "" });
  });

  it("returns null when the group id is absent", () => {
    expect(sourceKeyFromRow("telegram", { text: "no chat id" })).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    expect(sourceKeyFromRow("discord", null)).toBeNull();
    expect(sourceKeyFromRow("telegram", "scalar")).toBeNull();
  });
});

// The eligibility filter as batch-classify applies it: only channel-source rows
// are filtered; non-channel rows always pass; channel rows pass iff bound+enabled.
describe("batch-classify allow-list (integration of the pieces)", () => {
  const ledger = [
    binding({ platform: "telegram", external_id: "100", sub_id: "", status: "bound", enabled: true }),
    binding({ platform: "discord", external_id: "g1", sub_id: "", status: "ignored", enabled: false }),
  ];
  const eligible = boundSourceFilter(ledger);

  // A sampled row passes the gate iff it is a non-channel source OR its derived
  // channel key is bound+enabled.
  function passes(source: string, payload: unknown): boolean {
    const key = sourceKeyFromRow(source, payload);
    return key === null ? true : eligible(key);
  }

  it("a non-channel (csv) row always passes (additive — behavior unchanged)", () => {
    expect(passes("csv-upload", { name: "Ada" })).toBe(true);
  });

  it("a bound telegram group's row is included", () => {
    expect(passes("telegram", { chat_id: 100, text: "hello" })).toBe(true);
    expect(passes("telegram", { chat_id: 100, message_thread_id: 7 })).toBe(true);
  });

  it("an ignored discord guild's row is excluded", () => {
    expect(passes("discord", { guild_id: "g1", channel_id: "c1" })).toBe(false);
  });

  it("an unbound/unknown telegram group's row is excluded", () => {
    expect(passes("telegram", { chat_id: 999, text: "stranger" })).toBe(false);
  });
});
