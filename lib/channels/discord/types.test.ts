// lib/channels/discord/types.test.ts
//
// The Discord Interaction type is the minimal shape the adapter parses. It is a
// TYPE (erased at runtime), so RED/GREEN for the contract is enforced by tsc:
// a fixture typed as DiscordInteraction must compile, and the two shared
// fixtures must expose the fields the adapter relies on. The fixtures live in
// one place so the adapter test, route test, and integration test reuse them
// (mirrors lib/channels/telegram/types.ts SAMPLE_UPDATE).
//
// Discord interaction `type` values used here:
//   1 = PING  (handshake — Discord must receive {type:1} PONG; carries NO data)
//   2 = APPLICATION_COMMAND  (a slash command — the data we capture)

import { describe, expect, it } from "vitest";
import { SAMPLE_INTERACTION, SAMPLE_PING } from "@/lib/channels/discord/types";
import type { DiscordInteraction } from "@/lib/channels/discord/types";

describe("DiscordInteraction type + shared fixtures", () => {
  it("a type=2 APPLICATION_COMMAND with data + options compiles and carries parsed fields", () => {
    const interaction: DiscordInteraction = {
      type: 2,
      id: "interaction-1",
      application_id: "app-1",
      token: "tkn",
      guild_id: "guild-1",
      channel_id: "chan-1",
      member: { user: { id: "user-1", username: "lin" } },
      data: {
        id: "cmd-1",
        name: "report",
        options: [{ name: "detail", value: "blankets needed in dorm 3" }],
      },
    };
    expect(interaction.type).toBe(2);
    expect(interaction.data?.name).toBe("report");
    expect(interaction.data?.options?.[0].value).toBe("blankets needed in dorm 3");
    expect(interaction.member?.user.id).toBe("user-1");
  });

  it("a type=1 PING compiles with only the required identity fields", () => {
    const ping: DiscordInteraction = {
      type: 1,
      id: "ping-1",
      application_id: "app-1",
      token: "tkn",
    };
    expect(ping.type).toBe(1);
  });

  it("SAMPLE_INTERACTION fixture is a realistic type=2 APPLICATION_COMMAND", () => {
    expect(SAMPLE_INTERACTION.type).toBe(2);
    expect(SAMPLE_INTERACTION.data?.name).toBeTypeOf("string");
    expect(SAMPLE_INTERACTION.data?.options).toBeInstanceOf(Array);
    expect(SAMPLE_INTERACTION.id).toBeTypeOf("string");
  });

  it("SAMPLE_PING fixture is a type=1 PING (no data)", () => {
    expect(SAMPLE_PING.type).toBe(1);
    expect(SAMPLE_PING.data).toBeUndefined();
  });
});
