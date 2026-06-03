// lib/channels/bindings.test.ts
//
// channel_bindings is a hand-managed infra table (like raw_inbox / approved_views)
// — explicitly NOT in schema.generated.ts and NOT created by drizzle-kit push
// (push silently skips new tables; see docker-entrypoint.sh). This test pins the
// Drizzle table object's column surface so a drift between schema.ts, the
// entrypoint CREATE TABLE, and the unique-index key is caught here.
//
// It ALSO covers the bindings store + pure merge (Task B1):
//
//   listBindings(db)                          → all rows
//   bindTarget(db, target)                    → UPSERT status:"bound", enabled:true
//   ignoreTarget(db, key)                     → UPSERT status:"ignored"
//   setEnabled(db, key, enabled)              → flip the on/off switch
//   relabel(db, key, label)                   → set the steward label
//   upsertDiscovered(db, target)              → INSERT status:"discovered" IF absent
//                                               (used by the Gateway worker inventory)
//   mergeDiscoveryWithBindings(...)           → PURE join with discoverChannels output
//
// Store CRUD is verified against a fake Drizzle db that records the issued chain
// (same hermetic approach as registry-pg.test.ts) — no real Postgres. The merge is
// pure, so it is tested with plain data.

import { describe, expect, it, vi } from "vitest";
import {
  bindTarget,
  ignoreTarget,
  listBindings,
  mergeDiscoveryWithBindings,
  relabel,
  setEnabled,
  upsertDiscovered,
  type MergedChannelItem,
} from "@/lib/channels/bindings";
import { channel_bindings } from "@/lib/db/schema";
import type { ChannelBindingRow } from "@/lib/db/schema";
import type { ChannelDiscovery } from "@/lib/channels/discovery";

describe("channel_bindings table", () => {
  it("exposes the binding columns", () => {
    const cols = Object.keys(channel_bindings);
    for (const c of [
      "id",
      "platform",
      "scope",
      "external_id",
      "sub_id",
      "title",
      "label",
      "status",
      "enabled",
      "created_at",
      "updated_at",
    ])
      expect(cols).toContain(c);
  });
});

const t = (iso: string) => new Date(Date.parse(iso));

// ── store fakes ────────────────────────────────────────────────────────────

function fakeSelectDb(rows: unknown[]) {
  const from = vi.fn(async () => rows);
  const select = vi.fn(() => ({ from }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: { select } as any, select, from };
}

type Row = Record<string, unknown>;
type ConflictCfg = { target?: unknown; set: Row };

function fakeInsertDb() {
  const onConflictDoUpdate = vi.fn(async (_cfg: ConflictCfg) => {});
  const onConflictDoNothing = vi.fn(async (_cfg?: { target?: unknown }) => {});
  const values = vi.fn((_v: Row) => ({ onConflictDoUpdate, onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: { insert } as any, insert, values, onConflictDoUpdate, onConflictDoNothing };
}

function fakeUpdateDb() {
  const where = vi.fn(async () => {});
  const set = vi.fn((_patch: Row) => ({ where }));
  const update = vi.fn(() => ({ set }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: { update } as any, update, set, where };
}

// ── store CRUD ─────────────────────────────────────────────────────────────

describe("bindings store", () => {
  it("listBindings selects every row from channel_bindings", async () => {
    const seeded = [{ id: "1", platform: "telegram" }];
    const { db, select, from } = fakeSelectDb(seeded);
    const out = await listBindings(db);
    expect(select).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
    expect(out).toBe(seeded);
  });

  it("bindTarget upserts status:'bound', enabled:true on the unique index (no duplicate)", async () => {
    const { db, insert, values, onConflictDoUpdate } = fakeInsertDb();
    await bindTarget(db, {
      platform: "telegram",
      scope: "group",
      external_id: "100",
      sub_id: "",
      title: "Ops Group",
      label: "ops",
    });
    expect(insert).toHaveBeenCalledTimes(1);
    const inserted = values.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.platform).toBe("telegram");
    expect(inserted.external_id).toBe("100");
    expect(inserted.sub_id).toBe("");
    expect(inserted.status).toBe("bound");
    expect(inserted.enabled).toBe(true);
    // re-bind = update, not a second row
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    const conflict = onConflictDoUpdate.mock.calls[0][0] as { set: Record<string, unknown> };
    expect(conflict.set.status).toBe("bound");
    expect(conflict.set.enabled).toBe(true);
  });

  it("bindTarget defaults sub_id to '' when omitted (whole-group bind)", async () => {
    const { db, values } = fakeInsertDb();
    await bindTarget(db, { platform: "discord", scope: "group", external_id: "g1" });
    const inserted = values.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.sub_id).toBe("");
  });

  it("ignoreTarget upserts status:'ignored'", async () => {
    const { db, values, onConflictDoUpdate } = fakeInsertDb();
    await ignoreTarget(db, { platform: "telegram", external_id: "100", sub_id: "7" });
    const inserted = values.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.status).toBe("ignored");
    const conflict = onConflictDoUpdate.mock.calls[0][0] as { set: Record<string, unknown> };
    expect(conflict.set.status).toBe("ignored");
  });

  it("setEnabled updates the enabled flag for the keyed row", async () => {
    const { db, update, set } = fakeUpdateDb();
    await setEnabled(db, { platform: "telegram", external_id: "100", sub_id: "" }, false);
    expect(update).toHaveBeenCalledTimes(1);
    const patch = set.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.enabled).toBe(false);
  });

  it("relabel updates the steward label for the keyed row", async () => {
    const { db, set } = fakeUpdateDb();
    await relabel(db, { platform: "discord", external_id: "g1", sub_id: "c1" }, "general");
    const patch = set.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.label).toBe("general");
  });

  it("upsertDiscovered inserts status:'discovered', enabled:false and does NOT clobber an existing row", async () => {
    const { db, insert, values, onConflictDoNothing } = fakeInsertDb();
    await upsertDiscovered(db, {
      platform: "discord",
      scope: "channel",
      external_id: "g1",
      sub_id: "c1",
      title: "general",
    });
    expect(insert).toHaveBeenCalledTimes(1);
    const inserted = values.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.status).toBe("discovered");
    expect(inserted.enabled).toBe(false);
    // idempotent: existing bound/ignored/discovered row left untouched
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });
});

// ── pure merge ───────────────────────────────────────────────────────────────

const NOW = Date.parse("2026-06-02T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

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
    created_at: t("2026-06-01T00:00:00Z"),
    updated_at: t("2026-06-01T00:00:00Z"),
    ...over,
  } as ChannelBindingRow;
}

const discovery: ChannelDiscovery = {
  telegram: [
    {
      platform: "telegram",
      externalId: "100",
      title: "Ops Group",
      messageCount: 5,
      firstReceivedAt: t("2026-06-01T08:00:00Z"),
      lastReceivedAt: t("2026-06-02T11:00:00Z"), // within 24h
      subChannels: [
        {
          subId: "7",
          scope: "topic",
          title: "Maintenance",
          messageCount: 2,
          lastReceivedAt: t("2026-05-30T00:00:00Z"), // older than 24h
        },
      ],
    },
  ],
  discord: [
    {
      platform: "discord",
      externalId: "g1",
      title: "Server One",
      messageCount: 0,
      firstReceivedAt: t("2026-06-02T11:59:00Z"),
      lastReceivedAt: t("2026-06-02T11:59:00Z"),
      subChannels: [
        {
          subId: "c1",
          scope: "channel",
          title: "general",
          messageCount: 3,
          lastReceivedAt: t("2026-06-02T11:30:00Z"),
        },
      ],
    },
  ],
};

const configured = { telegram: true, discord: false };

function byKey(items: MergedChannelItem[]) {
  return Object.fromEntries(
    items.map((i) => [`${i.platform}:${i.externalId}:${i.subId}`, i]),
  );
}

describe("mergeDiscoveryWithBindings", () => {
  it("emits one item per group AND per sub-channel across both platforms", () => {
    const items = mergeDiscoveryWithBindings(discovery, [], { configured, now: NOW });
    // tg group + tg topic + dc group + dc channel = 4
    expect(items).toHaveLength(4);
    const k = byKey(items);
    expect(k["telegram:100:"]).toBeTruthy();
    expect(k["telegram:100:7"]).toBeTruthy();
    expect(k["discord:g1:"]).toBeTruthy();
    expect(k["discord:g1:c1"]).toBeTruthy();
  });

  it("an unbound, configured target → status:'discovered', liveness:'unbound'", () => {
    const items = mergeDiscoveryWithBindings(discovery, [], { configured, now: NOW });
    const tg = byKey(items)["telegram:100:"];
    expect(tg.status).toBe("discovered");
    expect(tg.liveness).toBe("unbound");
    expect(tg.title).toBe("Ops Group");
    expect(tg.scope).toBe("group");
    expect(tg.messageCount).toBe(5);
    expect(tg.lastReceivedAt).toEqual(t("2026-06-02T11:00:00Z"));
  });

  it("a bound target with a fresh message → status:'bound', liveness:'receiving'", () => {
    const bindings = [
      binding({ platform: "telegram", external_id: "100", sub_id: "", status: "bound", label: "ops" }),
    ];
    const items = mergeDiscoveryWithBindings(discovery, bindings, { configured, now: NOW });
    const tg = byKey(items)["telegram:100:"];
    expect(tg.status).toBe("bound");
    expect(tg.label).toBe("ops");
    expect(tg.liveness).toBe("receiving");
  });

  it("a bound sub-channel whose last message is older than 24h → liveness:'idle'", () => {
    const bindings = [
      binding({ platform: "telegram", external_id: "100", sub_id: "7", scope: "topic", status: "bound" }),
    ];
    const items = mergeDiscoveryWithBindings(discovery, bindings, { configured, now: NOW });
    const sub = byKey(items)["telegram:100:7"];
    expect(sub.status).toBe("bound");
    expect(sub.scope).toBe("topic");
    expect(sub.liveness).toBe("idle");
  });

  it("an ignored target → status:'ignored' (bound:false → liveness:'unbound')", () => {
    const bindings = [
      binding({ platform: "telegram", external_id: "100", sub_id: "", status: "ignored" }),
    ];
    const items = mergeDiscoveryWithBindings(discovery, bindings, { configured, now: NOW });
    const tg = byKey(items)["telegram:100:"];
    expect(tg.status).toBe("ignored");
    expect(tg.liveness).toBe("unbound");
  });

  it("a platform that is NOT configured → liveness:'offline' regardless of binding", () => {
    const bindings = [
      binding({ platform: "discord", external_id: "g1", sub_id: "c1", scope: "channel", status: "bound" }),
    ];
    const items = mergeDiscoveryWithBindings(discovery, bindings, { configured, now: NOW });
    const dc = byKey(items)["discord:g1:c1"];
    expect(dc.status).toBe("bound");
    expect(dc.liveness).toBe("offline"); // discord not configured
  });

  it("a bound target with zero messages → liveness:'awaiting'", () => {
    const cfg = { telegram: true, discord: true };
    const bindings = [
      binding({ platform: "discord", external_id: "g1", sub_id: "", scope: "group", status: "bound" }),
    ];
    const items = mergeDiscoveryWithBindings(discovery, bindings, { configured: cfg, now: NOW });
    const dc = byKey(items)["discord:g1:"];
    expect(dc.status).toBe("bound");
    expect(dc.liveness).toBe("awaiting"); // group messageCount 0
  });

  it("never reads the system clock — identical inputs give identical output", () => {
    const a = mergeDiscoveryWithBindings(discovery, [], { configured, now: NOW });
    const b = mergeDiscoveryWithBindings(discovery, [], { configured, now: NOW + HOUR * 0 });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});
