// workers/discord-gateway/index.ts
//
// Discord Gateway worker — an ALWAYS-ON, INBOUND-ONLY service that gives Discord
// full Telegram parity. It holds DISCORD_BOT_TOKEN at runtime and opens a
// persistent Gateway websocket (Guilds + GuildMessages + MessageContent intents).
// On each guild message it normalizes (lib/channels/discord/normalize.ts) and
// deposits ONE row into raw_inbox via ingestChannelRows — the SAME data-only
// path the Telegram webhook uses. Discovery + liveness then come for free from
// the Phase A read layer.
//
// SECURITY / DATA-ONLY FENCE (user-authorized scoped exception 2026-06-02):
//   - The token is read from process.env.DISCORD_BOT_TOKEN ONLY, NEVER from a
//     tracked file, and is NEVER logged / echoed / transmitted.
//   - INERT when unset: logs "Discord Gateway idle (no token)" and idles — it
//     does NOT crash, mirroring the webhook inert-503 ethos.
//   - The worker writes ONLY raw_inbox (this scaffold) [+ channel_bindings
//     inventory in E2]. It reads NO auth, NO ontology ctx; invokes NO agent
//     action; emits NO outbound message / bot reply. The connection is inbound.
//   - Bot's own messages and DMs (no guild) are skipped at intake.

import {
  Client,
  Events,
  GatewayIntentBits,
  type Message,
} from "discord.js";
import { getDb, type Database } from "@/lib/db/client";
import { ingestChannelRows } from "@/lib/channels/ingest";
import { discordMessageToRow, type GatewayMessage } from "@/lib/channels/discord/normalize";

const IDLE_LOG = "Discord Gateway idle (no token)";

/**
 * Handle one inbound Gateway message: skip the bot's own messages and DMs
 * (no guild), then normalize + ingest into raw_inbox. Data-only — no auth, no
 * ontology, no outbound reply. Exported for unit testing with a fake message.
 */
export async function handleMessage(db: Database, msg: Message): Promise<void> {
  if (msg.author.bot) return; // never re-ingest the bot's own messages
  if (!msg.guildId) return; // DMs carry no guild — out of scope, dropped
  // discordMessageToRow returns the self-describing { source, payload } row; the
  // shared ingestChannelRows path re-stamps source and wraps each payload as a
  // raw_inbox row, so we hand it the payload (no double-wrap, source unduplicated).
  const { payload } = discordMessageToRow(msg as unknown as GatewayMessage);
  await ingestChannelRows(db, "discord", [payload]);
}

/**
 * Worker entry. INERT when DISCORD_BOT_TOKEN is unset (logs idle, does not
 * crash or connect). When set, connects with the inbound intents and pipelines
 * messages into raw_inbox. The token value is never logged.
 */
export async function main(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.log(IDLE_LOG);
    return;
  }

  const db = getDb();
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (c) => {
    // Identify by the bot's tag only — NEVER the token.
    console.log(`Discord Gateway connected as ${c.user.tag}`);
  });

  client.on(Events.MessageCreate, (msg) => {
    void handleMessage(db, msg).catch((err) => {
      console.error("Discord Gateway ingest error:", err);
    });
  });

  await client.login(token);
}

// Run when invoked directly as the worker process. The compose service runs
// `tsx workers/discord-gateway/index.ts`, which sets WORKER_ENTRY (see E3). A
// plain import (under vitest/tsc) leaves the flag unset, so main() never fires
// and the module stays side-effect-free for unit tests of handleMessage.
if (process.env.WORKER_ENTRY === "discord-gateway") {
  void main();
}
