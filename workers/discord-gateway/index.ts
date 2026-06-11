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
import { isBound } from "@/lib/channels/eligibility";
import { listBindings, upsertDiscovered } from "@/lib/channels/bindings";
import type { ChannelBindingRow } from "@/lib/db/schema";

const IDLE_LOG = "Discord Gateway idle (no token)";

// Anti-flood boundView staleness bound (E3 review low #3). The in-memory
// channel_bindings snapshot is also refreshed on ready/guildCreate, but a steward
// bind/unbind BETWEEN guild events would otherwise stay invisible until the next
// guild join. A periodic refresh bounds worst-case staleness to this interval.
// 30s is a deliberate balance: small enough that a steward's curation takes
// effect promptly, large enough that the per-interval listBindings() read is
// negligible load. The stale bias is fail-safe (drops messages from a
// just-bound channel for <=30s; never ingests from a just-unbound one early,
// since unbind only REMOVES allow-list entries the next refresh reflects).
export const BOUND_VIEW_REFRESH_MS = 30_000;

/**
 * Install a periodic boundView refresh. PURE scheduling primitive (no discord.js,
 * no DB) so it is unit-testable with fake timers: it calls `refresh` every
 * BOUND_VIEW_REFRESH_MS and returns a stop() that clears the interval. A rejected
 * refresh is swallowed (logged) so a transient DB blip never crashes the worker.
 */
export function scheduleBoundViewRefresh(
  refresh: () => Promise<void>,
): () => void {
  const handle = setInterval(() => {
    void refresh().catch((err) =>
      console.error("Discord Gateway boundView refresh error:", err),
    );
  }, BOUND_VIEW_REFRESH_MS);
  // Don't keep the event loop alive solely for this timer (the Gateway socket
  // is what keeps the worker running); unref is a no-op where unsupported.
  if (typeof handle === "object" && handle && "unref" in handle) {
    (handle as { unref: () => void }).unref();
  }
  return () => clearInterval(handle);
}

// Discord channel type discriminants we INVENTORY for the dashboard. Only
// text-bearing channels pipeline messages, so voice/category/etc are skipped.
// Values per the Discord API (discord.js `ChannelType`): 0 GuildText,
// 5 GuildAnnouncement, 15 GuildForum, 11/12 public/private threads.
const TEXT_CHANNEL_TYPES = new Set<number>([0, 5, 15, 11, 12]);

/**
 * E2 anti-flood predicate. The worker ingests a guild message ONLY when its
 * (guild,channel) is BOUND + ENABLED in channel_bindings. PURE — it delegates to
 * the SAME eligibility semantics batch-classify uses (isBound): a whole-guild
 * bind (sub_id "") covers every channel; a channel bind (sub_id = channel_id)
 * covers just that one; discovered/ignored/disabled rows do not pass.
 */
export function shouldIngest(
  boundView: ChannelBindingRow[],
  guildId: string,
  channelId: string,
): boolean {
  return isBound(boundView, { platform: "discord", externalId: guildId, subId: channelId });
}

/**
 * Handle one inbound Gateway message: skip the bot's own messages and DMs
 * (no guild), then apply the E2 anti-flood bound-filter (`boundView`), then
 * normalize + ingest into raw_inbox. Data-only — no auth, no ontology, no
 * outbound reply. `boundView` is the latest channel_bindings snapshot the worker
 * holds (refreshed on ready/guildCreate). Exported for unit testing.
 */
export async function handleMessage(
  db: Database,
  msg: Message,
  boundView: ChannelBindingRow[],
): Promise<void> {
  if (msg.author.bot) return; // never re-ingest the bot's own messages
  if (!msg.guildId) return; // DMs carry no guild — out of scope, dropped
  // ANTI-FLOOD: drop messages from (guild,channel) the steward hasn't bound. The
  // channel id discovery groups discord by is the message's channelId.
  if (!shouldIngest(boundView, msg.guildId, msg.channelId)) return;
  // discordMessageToRow returns the self-describing { source, payload } row; the
  // shared ingestChannelRows path re-stamps source and wraps each payload as a
  // raw_inbox row, so we hand it the payload (no double-wrap, source unduplicated).
  const { payload } = discordMessageToRow(msg as unknown as GatewayMessage);
  await ingestChannelRows(db, "discord", [payload]);
}

/** The channel subset discoverGuild reads (a discord.js GuildChannel structural slice). */
export interface DiscoverableChannel {
  id: string;
  name?: string;
  type: number;
}

/** The guild subset discoverGuild reads (a discord.js Guild structural slice). */
export interface DiscoverableGuild {
  id: string;
  name?: string;
  channels: { cache: Map<string, DiscoverableChannel> | Iterable<[string, DiscoverableChannel]> };
}

/**
 * E2 discovery inventory. On 'ready'/'guildCreate' record each visible guild and
 * its TEXT channels into channel_bindings as status:"discovered", enabled:false
 * via upsertDiscovered — which is onConflictDoNothing, so an already
 * bound/ignored/discovered row is LEFT UNTOUCHED (the steward's curation wins).
 * Data-only inventory: the only store touch is upsertDiscovered.
 */
export async function discoverGuild(db: Database, guild: DiscoverableGuild): Promise<void> {
  // the guild itself (sub_id "" = the whole server)
  await upsertDiscovered(db, {
    platform: "discord",
    scope: "group",
    external_id: guild.id,
    sub_id: "",
    title: guild.name,
  });
  for (const [, ch] of guild.channels.cache) {
    if (!TEXT_CHANNEL_TYPES.has(ch.type)) continue; // only text channels pipeline
    await upsertDiscovered(db, {
      platform: "discord",
      scope: "channel",
      external_id: guild.id,
      sub_id: ch.id,
      title: ch.name,
    });
  }
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
    // Idle FOREVER instead of returning: under compose `restart: unless-stopped`
    // a clean exit restart-loops the container every few seconds — a fresh
    // install (no token) would show a perpetually-"Restarting" service. A bare
    // pending promise does NOT keep Node alive (the event loop drains with no
    // active handles), so park on a max-delay interval — a real, ref'd handle.
    setInterval(() => {}, 2_147_483_647);
    await new Promise(() => {});
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

  // The worker holds the latest channel_bindings snapshot in memory for the
  // anti-flood filter (avoids a DB read per message). Refreshed on
  // ready/guildCreate AND on a BOUND_VIEW_REFRESH_MS timer (scheduleBoundViewRefresh
  // below), so a steward bind/unbind made between guild events is picked up within
  // the interval rather than only at the next guild join (E3 review low #3).
  let boundView: ChannelBindingRow[] = [];
  async function refreshBoundView(): Promise<void> {
    boundView = await listBindings(db);
  }

  client.once(Events.ClientReady, (c) => {
    // Identify by the bot's tag only — NEVER the token.
    console.log(`Discord Gateway connected as ${c.user.tag}`);
    void (async () => {
      // Inventory every guild already in cache, then load the binding snapshot.
      for (const [, guild] of c.guilds.cache) {
        await discoverGuild(db, guild as unknown as DiscoverableGuild);
      }
      await refreshBoundView();
    })().catch((err) => console.error("Discord Gateway ready/discovery error:", err));
  });

  client.on(Events.GuildCreate, (guild) => {
    void (async () => {
      await discoverGuild(db, guild as unknown as DiscoverableGuild);
      await refreshBoundView();
    })().catch((err) => console.error("Discord Gateway guildCreate/discovery error:", err));
  });

  client.on(Events.MessageCreate, (msg) => {
    void handleMessage(db, msg, boundView).catch((err) => {
      console.error("Discord Gateway ingest error:", err);
    });
  });

  // Bound the anti-flood snapshot's staleness with a periodic refresh (in
  // addition to the ready/guildCreate refreshes above).
  scheduleBoundViewRefresh(refreshBoundView);

  await client.login(token);
}

// Run when invoked directly as the worker process. The compose service runs
// `tsx workers/discord-gateway/index.ts`, which sets WORKER_ENTRY (see E3). A
// plain import (under vitest/tsc) leaves the flag unset, so main() never fires
// and the module stays side-effect-free for unit tests of handleMessage.
if (process.env.WORKER_ENTRY === "discord-gateway") {
  void main();
}
