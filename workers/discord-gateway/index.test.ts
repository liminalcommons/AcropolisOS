// workers/discord-gateway/index.test.ts
//
// handleMessage is the worker's DATA-ONLY intake filter: it skips the bot's own
// messages and DMs (no guild), and ingests guild messages into raw_inbox via
// ingestChannelRows. We mock ingestChannelRows so this is a pure unit test (no
// DB, no network, no discord.js client) and assert ONLY the data-only contract:
// what gets ingested, what gets dropped, and that the normalized "discord" row
// is what reaches the ingest path.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// vi.mock is hoisted above imports — the mock fn must be created via vi.hoisted
// so it exists when the factory runs (a plain top-level const is not yet bound).
const { ingestChannelRows } = vi.hoisted(() => ({
  ingestChannelRows: vi.fn().mockResolvedValue({ ids: ["row-1"], count: 1 }),
}));
vi.mock("@/lib/channels/ingest", () => ({ ingestChannelRows }));

import {
  handleMessage,
  scheduleBoundViewRefresh,
  BOUND_VIEW_REFRESH_MS,
} from "@/workers/discord-gateway/index";
import type { Database } from "@/lib/db/client";
import type { Message } from "discord.js";
import type { ChannelBindingRow } from "@/lib/db/schema";

const db = {} as Database; // never used — ingest is mocked

// A bound+enabled whole-guild row covering the fakeMessage's guild: with this in
// the boundView, the guild message is allowed through the anti-flood filter.
function boundGuild(externalId: string): ChannelBindingRow {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    platform: "discord",
    scope: "group",
    external_id: externalId,
    sub_id: "",
    title: null,
    label: null,
    status: "bound",
    enabled: true,
    created_at: new Date(),
    updated_at: new Date(),
  } as ChannelBindingRow;
}

// Build a discord.js-shaped Message just far enough for handleMessage +
// discordMessageToRow. Cast to Message for the signature; the normalizer only
// reads the structural subset.
function fakeMessage(over: Record<string, unknown> = {}): Message {
  return {
    id: "1200000000000000001",
    content: "blankets needed in dorm 3",
    author: { id: "1234567890", username: "lin_h", bot: false },
    guildId: "1098000000000000001",
    guild: { name: "Hostel Ops" },
    channelId: "1097000000000000001",
    channel: { name: "general", isThread: () => false },
    ...over,
  } as unknown as Message;
}

describe("discord gateway handleMessage (data-only intake)", () => {
  beforeEach(() => ingestChannelRows.mockClear());

  it("ingests a guild message as a normalized discord payload (source re-stamped by ingest)", async () => {
    await handleMessage(db, fakeMessage(), [boundGuild("1098000000000000001")]);
    expect(ingestChannelRows).toHaveBeenCalledTimes(1);
    const [, source, rows] = ingestChannelRows.mock.calls[0];
    // The worker passes source="discord" and the PAYLOAD (not the {source,payload}
    // wrapper) — ingestChannelRows wraps each payload into a raw_inbox row itself,
    // exactly like the telegram/discord webhook routes.
    expect(source).toBe("discord");
    expect(rows).toEqual([
      {
        text: "blankets needed in dorm 3",
        user_id: "1234567890",
        username: "lin_h",
        guild_id: "1098000000000000001",
        guild_name: "Hostel Ops",
        channel_id: "1097000000000000001",
        channel_name: "general",
        message_id: "1200000000000000001",
      },
    ]);
  });

  it("skips the bot's own messages (never re-ingests)", async () => {
    await handleMessage(db, fakeMessage({ author: { id: "bot-1", username: "acropolis-bot", bot: true } }), [
      boundGuild("1098000000000000001"),
    ]);
    expect(ingestChannelRows).not.toHaveBeenCalled();
  });

  it("skips DMs (no guildId)", async () => {
    await handleMessage(db, fakeMessage({ guildId: null, guild: null }), [boundGuild("1098000000000000001")]);
    expect(ingestChannelRows).not.toHaveBeenCalled();
  });

  it("DROPS a message from an UN-bound (guild,channel) — anti-flood (E2)", async () => {
    // Empty boundView ⇒ nothing is bound ⇒ the guild message must NOT be ingested.
    await handleMessage(db, fakeMessage(), []);
    expect(ingestChannelRows).not.toHaveBeenCalled();
  });

  it("DROPS a message from a different channel when only ONE channel is bound (E2)", async () => {
    const onlyChan7: ChannelBindingRow = {
      ...boundGuild("1098000000000000001"),
      scope: "channel",
      sub_id: "chan-7", // the fakeMessage's channel is 1097000000000000001, not chan-7
    };
    await handleMessage(db, fakeMessage(), [onlyChan7]);
    expect(ingestChannelRows).not.toHaveBeenCalled();
  });
});

describe("discord gateway boundView staleness bound (E3 review low #3)", () => {
  // The anti-flood boundView snapshot was previously refreshed ONLY on
  // ready/guildCreate, so a steward bind/unbind between guild events stayed
  // invisible until the next guild join. scheduleBoundViewRefresh installs a
  // periodic refresh so worst-case staleness is bounded by BOUND_VIEW_REFRESH_MS,
  // not "until the next guild join". Tested with fake timers — no real wait.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers()); // restore so other suites use real time

  it("exposes a positive, finite refresh interval", () => {
    expect(BOUND_VIEW_REFRESH_MS).toBeGreaterThan(0);
    expect(Number.isFinite(BOUND_VIEW_REFRESH_MS)).toBe(true);
  });

  it("invokes the refresh callback once per interval (bounds staleness)", () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const stop = scheduleBoundViewRefresh(refresh);
    expect(refresh).not.toHaveBeenCalled(); // timer-driven only, no immediate call
    vi.advanceTimersByTime(BOUND_VIEW_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(BOUND_VIEW_REFRESH_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(BOUND_VIEW_REFRESH_MS * 5);
    expect(refresh).toHaveBeenCalledTimes(3); // stop() clears the interval
  });

  it("swallows a refresh rejection so a transient DB blip never crashes the worker", () => {
    const refresh = vi.fn().mockRejectedValue(new Error("db blip"));
    const stop = scheduleBoundViewRefresh(refresh);
    // advancing must not throw even though the callback rejects
    expect(() => vi.advanceTimersByTime(BOUND_VIEW_REFRESH_MS)).not.toThrow();
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });
});
