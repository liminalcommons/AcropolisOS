// workers/discord-gateway/index.test.ts
//
// handleMessage is the worker's DATA-ONLY intake filter: it skips the bot's own
// messages and DMs (no guild), and ingests guild messages into raw_inbox via
// ingestChannelRows. We mock ingestChannelRows so this is a pure unit test (no
// DB, no network, no discord.js client) and assert ONLY the data-only contract:
// what gets ingested, what gets dropped, and that the normalized "discord" row
// is what reaches the ingest path.

import { describe, expect, it, vi, beforeEach } from "vitest";

// vi.mock is hoisted above imports — the mock fn must be created via vi.hoisted
// so it exists when the factory runs (a plain top-level const is not yet bound).
const { ingestChannelRows } = vi.hoisted(() => ({
  ingestChannelRows: vi.fn().mockResolvedValue({ ids: ["row-1"], count: 1 }),
}));
vi.mock("@/lib/channels/ingest", () => ({ ingestChannelRows }));

import { handleMessage } from "@/workers/discord-gateway/index";
import type { Database } from "@/lib/db/client";
import type { Message } from "discord.js";

const db = {} as Database; // never used — ingest is mocked

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
    await handleMessage(db, fakeMessage());
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
    await handleMessage(db, fakeMessage({ author: { id: "bot-1", username: "acropolis-bot", bot: true } }));
    expect(ingestChannelRows).not.toHaveBeenCalled();
  });

  it("skips DMs (no guildId)", async () => {
    await handleMessage(db, fakeMessage({ guildId: null, guild: null }));
    expect(ingestChannelRows).not.toHaveBeenCalled();
  });
});
