// lib/channels/discord/types.ts
//
// Minimal Discord Interaction shape — only the fields the inbound adapter reads.
// We deliberately do NOT model the full Interactions API: an Interaction has
// many members (message components, modals, autocomplete, resolved entities),
// but the inbound data-only capture needs the interaction `type`, identity
// (id/application_id/token/guild_id/channel_id), the invoking user (in `member`
// for guild interactions, top-level `user` for DM interactions), and the
// command `data` (name + options) for APPLICATION_COMMAND.
//
// Interaction `type` values we handle:
//   1 = PING               (handshake; the route answers {type:1} PONG)
//   2 = APPLICATION_COMMAND (a slash command; the data we capture as a row)
// Other types (message component, autocomplete, modal submit) are not modeled
// in this inbound slice and yield no captured row.

export interface DiscordUser {
  id: string;
  username?: string;
}

// Guild interactions carry the invoking user under `member.user`; DM
// interactions carry it under the top-level `user`.
export interface DiscordGuildMember {
  user: DiscordUser;
}

export interface DiscordCommandOption {
  name: string;
  // The option value is a string | number | boolean depending on the option
  // type; for data-only capture we keep the raw union.
  value?: string | number | boolean;
}

export interface DiscordCommandData {
  id: string;
  name: string;
  options?: DiscordCommandOption[];
}

export interface DiscordInteraction {
  type: number;
  id: string;
  application_id: string;
  token: string;
  guild_id?: string;
  channel_id?: string;
  member?: DiscordGuildMember; // present for guild interactions
  user?: DiscordUser; // present for DM interactions
  data?: DiscordCommandData; // present for APPLICATION_COMMAND (type 2)
}

// A realistic slash-command interaction (type 2), shared by the adapter tests,
// the route test, and the route integration test so the fixture lives in one
// place (mirrors telegram/types.ts SAMPLE_UPDATE).
export const SAMPLE_INTERACTION: DiscordInteraction = {
  type: 2,
  id: "1099876543210000001",
  application_id: "1099000000000000001",
  token: "aW50ZXJhY3Rpb24tdG9rZW4-not-a-real-secret",
  guild_id: "1098000000000000001",
  channel_id: "1097000000000000001",
  member: { user: { id: "1234567890", username: "lin_h" } },
  data: {
    id: "1096000000000000001",
    name: "report",
    options: [{ name: "detail", value: "Can someone bring extra blankets to dorm 3 tonight?" }],
  },
};

// The PING handshake Discord sends on endpoint registration and periodically.
// It carries NO data — the route answers {type:1} and captures no row.
export const SAMPLE_PING: DiscordInteraction = {
  type: 1,
  id: "1099876543210000099",
  application_id: "1099000000000000001",
  token: "cGluZy10b2tlbg-not-a-real-secret",
};
