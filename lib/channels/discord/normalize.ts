// lib/channels/discord/normalize.ts
//
// discordMessageToRow — the PURE Gateway normalizer.
//
// The Discord Gateway worker (workers/discord-gateway/index.ts) receives a live
// discord.js Message on each 'messageCreate'. This module maps that message to
// EXACTLY ONE raw_inbox row, with the SAME field names the existing read layer
// already understands (lib/channels/discovery.ts groups discord by guild_id and
// channel_id, and reads guild_name / channel_name / thread_id) — so discovery +
// liveness come "for free" once messages land.
//
// It is PURE and has NO discord.js import: it depends only on the structural
// GatewayMessage interface below (the subset of fields the worker reads), so it
// is unit-testable with a plain fixture and never touches the network.
//
// DATA-ONLY FENCE: this module maps message -> row and nothing else. It does NOT
// read auth, the ontology ctx, or invoke any agent action; it produces no
// outbound reply. The worker's only side effect is ingestChannelRows(raw_inbox).

/** The author subset the normalizer reads off a discord.js Message.author. */
export interface GatewayAuthor {
  id: string;
  username: string;
  bot: boolean;
}

/**
 * The channel subset the normalizer reads. discord.js represents a thread as a
 * channel whose `isThread()` is true, with `parentId`/`parent` pointing at the
 * containing text channel. A non-thread channel has neither.
 */
export interface GatewayChannel {
  name?: string;
  isThread: () => boolean;
  parentId?: string | null;
  parent?: { name?: string } | null;
}

/** The guild subset the normalizer reads (null for DMs — filtered upstream). */
export interface GatewayGuild {
  name?: string;
}

/**
 * The structural subset of a discord.js Message the normalizer consumes. The
 * worker passes a real Message (which satisfies this shape); tests pass a plain
 * object. `content` requires the MESSAGE_CONTENT intent (user-enabled).
 */
export interface GatewayMessage {
  id: string;
  content: string;
  author: GatewayAuthor;
  guildId: string | null;
  guild: GatewayGuild | null;
  channelId: string;
  channel: GatewayChannel;
}

/** A normalized raw_inbox row for the discord source. */
export interface DiscordInboxRow {
  source: "discord";
  payload: {
    text: string;
    user_id: string;
    username: string;
    guild_id: string | null;
    guild_name?: string;
    channel_id: string;
    channel_name?: string;
    thread_id?: string;
    message_id: string;
  };
}

function nonEmpty(v: string | undefined | null): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Map a Gateway message to one raw_inbox row.
 *
 * For a thread message, `channel_id` resolves to the PARENT channel and
 * `thread_id` carries the thread's own id — so discovery groups the thread under
 * its parent channel. For a non-thread message, `channel_id` is the channel and
 * `thread_id` is omitted entirely (the payload is jsonb; absent ⇒ no key).
 */
export function discordMessageToRow(msg: GatewayMessage): DiscordInboxRow {
  const isThread = msg.channel.isThread();

  // Thread: the message's channelId is the thread id; channel_id should point at
  // the parent text channel so discovery buckets it correctly.
  const channelId = isThread ? msg.channel.parentId ?? msg.channelId : msg.channelId;
  const channelName = isThread ? msg.channel.parent?.name : msg.channel.name;

  const payload: DiscordInboxRow["payload"] = {
    text: msg.content,
    user_id: msg.author.id,
    username: msg.author.username,
    guild_id: msg.guildId,
    guild_name: nonEmpty(msg.guild?.name),
    channel_id: channelId,
    channel_name: nonEmpty(channelName),
    message_id: msg.id,
  };

  if (isThread) {
    payload.thread_id = msg.channelId;
  }

  return { source: "discord", payload };
}
