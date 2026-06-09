// lib/channels/discord/normalize.test.ts
//
// discordMessageToRow is the PURE Gateway normalizer: a discord.js-shaped
// message object -> exactly one raw_inbox row. No network, no discord.js import —
// the fixture is a plain object structurally matching the fields the Gateway
// worker reads off a real Message. The emitted payload field names MUST match
// what lib/channels/discovery.ts reads for discord (guild_id, guild_name,
// channel_id, channel_name, thread_id) so discovery + liveness come for free.

import { describe, expect, it } from "vitest";
import { discordMessageToRow } from "@/lib/channels/discord/normalize";
import type { GatewayMessage } from "@/lib/channels/discord/normalize";

// A realistic guild text-channel message (NOT a thread): the shape the worker
// hands the normalizer. discord.js exposes guild/channel/author as nested
// objects; we model only the read fields.
const CHANNEL_MESSAGE: GatewayMessage = {
  id: "1200000000000000001",
  content: "Can someone bring extra blankets to dorm 3 tonight?",
  author: { id: "1234567890", username: "lin_h", bot: false },
  guildId: "1098000000000000001",
  guild: { name: "Hostel Ops" },
  channelId: "1097000000000000001",
  channel: { name: "general", isThread: () => false },
};

// A message posted inside a thread: discord.js gives the thread its own channel
// id (channelId === thread id) and a parent channel. We capture both: channel_id
// = the parent channel, thread_id = the thread's id.
const THREAD_MESSAGE: GatewayMessage = {
  id: "1200000000000000002",
  content: "follow-up in the thread",
  author: { id: "1234567890", username: "lin_h", bot: false },
  guildId: "1098000000000000001",
  guild: { name: "Hostel Ops" },
  channelId: "1097000000000099999", // thread id
  channel: {
    name: "blanket-run",
    isThread: () => true,
    parentId: "1097000000000000001",
    parent: { name: "general" },
  },
};

describe("discordMessageToRow (pure Gateway normalizer)", () => {
  it("maps a guild channel message to a raw_inbox row with discovery-compatible fields", () => {
    const row = discordMessageToRow(CHANNEL_MESSAGE);
    expect(row).toEqual({
      source: "discord",
      payload: {
        text: "Can someone bring extra blankets to dorm 3 tonight?",
        user_id: "1234567890",
        username: "lin_h",
        guild_id: "1098000000000000001",
        guild_name: "Hostel Ops",
        channel_id: "1097000000000000001",
        channel_name: "general",
        message_id: "1200000000000000001",
      },
    });
  });

  it("omits thread_id for a non-thread channel message", () => {
    const row = discordMessageToRow(CHANNEL_MESSAGE);
    expect(row.payload).not.toHaveProperty("thread_id");
  });

  it("captures thread_id and resolves channel_id to the parent channel for a thread message", () => {
    const row = discordMessageToRow(THREAD_MESSAGE);
    expect(row.payload.thread_id).toBe("1097000000000099999");
    // channel_id resolves to the PARENT channel so discovery groups the thread
    // under its parent channel, not as its own top-level channel.
    expect(row.payload.channel_id).toBe("1097000000000000001");
    expect(row.payload.channel_name).toBe("general");
  });

  it("source is always 'discord'", () => {
    expect(discordMessageToRow(CHANNEL_MESSAGE).source).toBe("discord");
    expect(discordMessageToRow(THREAD_MESSAGE).source).toBe("discord");
  });

  it("does not crash when optional guild/channel names are absent", () => {
    const bare: GatewayMessage = {
      id: "1200000000000000003",
      content: "hi",
      author: { id: "42", username: "anon", bot: false },
      guildId: "1098000000000000001",
      guild: null,
      channelId: "1097000000000000001",
      channel: { isThread: () => false },
    };
    const row = discordMessageToRow(bare);
    expect(row.payload.text).toBe("hi");
    expect(row.payload.guild_name).toBeUndefined();
    expect(row.payload.channel_name).toBeUndefined();
    expect(row.payload.channel_id).toBe("1097000000000000001");
  });
});
