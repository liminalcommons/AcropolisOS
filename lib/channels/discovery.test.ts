// lib/channels/discovery.test.ts
//
// discoverChannels(db) is a READ-ONLY aggregation over raw_inbox. It answers
// "what groups / channels / threads have we actually received messages from?"
// by reducing the staged rows — per platform — into:
//
//   { platform, externalId, title, messageCount, firstReceivedAt, lastReceivedAt,
//     subChannels: [{ subId, scope, title?, messageCount, lastReceivedAt }] }
//
// Telegram groups by payload->>'chat_id' (sub-channels = message_thread_id topics).
// Discord  groups by payload->>'guild_id' (sub-channels = channel_id channels).
// Rows missing the id bucket under "(unknown)" — never dropped. NO writes.
//
// The db is a FAKE whose select().from() resolves to the seeded raw_inbox rows
// (same hermetic approach as ingest.test.ts) — no real Postgres needed.

import { describe, expect, it } from "vitest";
import { discoverChannels } from "@/lib/channels/discovery";
import type { Database } from "@/lib/db/client";

type SeedRow = {
  id: string;
  source: string;
  received_at: Date;
  payload: Record<string, unknown>;
};

// A fake db: db.select().from(<anything>) resolves to the seeded rows.
function makeFakeDb(rows: SeedRow[]) {
  const db = {
    select: () => ({
      from: (_table: unknown) => Promise.resolve(rows),
    }),
  } as unknown as Database;
  return db;
}

const t = (iso: string) => new Date(Date.parse(iso));

describe("discoverChannels", () => {
  it("groups telegram rows by chat_id with thread sub-channels, counts + min/max timestamps", async () => {
    const rows: SeedRow[] = [
      {
        id: "1",
        source: "telegram",
        received_at: t("2026-06-01T08:00:00Z"),
        payload: { chat_id: 100, chat_title: "Ops Group", text: "a" },
      },
      {
        id: "2",
        source: "telegram",
        received_at: t("2026-06-01T10:00:00Z"),
        payload: { chat_id: 100, chat_title: "Ops Group", message_thread_id: 7, text: "b" },
      },
      {
        id: "3",
        source: "telegram",
        received_at: t("2026-06-01T09:00:00Z"),
        payload: { chat_id: 100, chat_title: "Ops Group", message_thread_id: 7, text: "c" },
      },
    ];

    const result = await discoverChannels(makeFakeDb(rows));

    expect(result.telegram).toHaveLength(1);
    const g = result.telegram[0];
    expect(g.platform).toBe("telegram");
    expect(g.externalId).toBe("100");
    expect(g.title).toBe("Ops Group");
    expect(g.messageCount).toBe(3);
    expect(g.firstReceivedAt).toEqual(t("2026-06-01T08:00:00Z"));
    expect(g.lastReceivedAt).toEqual(t("2026-06-01T10:00:00Z"));

    // one topic sub-channel (thread 7) with 2 messages; the chat-level message
    // (no thread) is NOT a sub-channel — it sits at the group root only.
    expect(g.subChannels).toHaveLength(1);
    const sub = g.subChannels[0];
    expect(sub.subId).toBe("7");
    expect(sub.scope).toBe("topic");
    expect(sub.messageCount).toBe(2);
    expect(sub.lastReceivedAt).toEqual(t("2026-06-01T10:00:00Z"));
  });

  it("groups discord rows by guild_id with channel sub-channels", async () => {
    const rows: SeedRow[] = [
      {
        id: "4",
        source: "discord",
        received_at: t("2026-06-01T11:00:00Z"),
        payload: { guild_id: "g1", guild_name: "Server One", channel_id: "c1", command: "x" },
      },
      {
        id: "5",
        source: "discord",
        received_at: t("2026-06-01T12:00:00Z"),
        payload: { guild_id: "g1", guild_name: "Server One", channel_id: "c2", command: "y" },
      },
      {
        id: "6",
        source: "discord",
        received_at: t("2026-06-01T12:30:00Z"),
        payload: { guild_id: "g1", guild_name: "Server One", channel_id: "c2", command: "z" },
      },
    ];

    const result = await discoverChannels(makeFakeDb(rows));

    expect(result.discord).toHaveLength(1);
    const g = result.discord[0];
    expect(g.externalId).toBe("g1");
    expect(g.title).toBe("Server One");
    expect(g.messageCount).toBe(3);
    expect(g.subChannels).toHaveLength(2);

    const byId = Object.fromEntries(g.subChannels.map((s) => [s.subId, s]));
    expect(byId["c1"].scope).toBe("channel");
    expect(byId["c1"].messageCount).toBe(1);
    expect(byId["c2"].messageCount).toBe(2);
    expect(byId["c2"].lastReceivedAt).toEqual(t("2026-06-01T12:30:00Z"));
  });

  it("buckets rows missing the id under '(unknown)' instead of dropping them", async () => {
    const rows: SeedRow[] = [
      {
        id: "7",
        source: "telegram",
        received_at: t("2026-06-01T01:00:00Z"),
        payload: { text: "orphan, no chat_id" },
      },
      {
        id: "8",
        source: "discord",
        received_at: t("2026-06-01T02:00:00Z"),
        payload: { command: "orphan, no guild_id" },
      },
    ];

    const result = await discoverChannels(makeFakeDb(rows));

    expect(result.telegram).toHaveLength(1);
    expect(result.telegram[0].externalId).toBe("(unknown)");
    expect(result.telegram[0].messageCount).toBe(1);

    expect(result.discord).toHaveLength(1);
    expect(result.discord[0].externalId).toBe("(unknown)");
    expect(result.discord[0].messageCount).toBe(1);
  });

  it("returns empty platform lists when raw_inbox is empty", async () => {
    const result = await discoverChannels(makeFakeDb([]));
    expect(result.telegram).toEqual([]);
    expect(result.discord).toEqual([]);
  });

  it("ignores rows from unrelated sources (e.g. csv webhook)", async () => {
    const rows: SeedRow[] = [
      {
        id: "9",
        source: "webhook",
        received_at: t("2026-06-01T03:00:00Z"),
        payload: { whatever: true },
      },
    ];
    const result = await discoverChannels(makeFakeDb(rows));
    expect(result.telegram).toEqual([]);
    expect(result.discord).toEqual([]);
  });
});
