// lib/channels/discord/adapter.ts
//
// discordAdapter — the inbound Discord channel adapter (data-only).
//
// parsePayload: maps an APPLICATION_COMMAND (type 2) Interaction into ONE
//   raw_inbox row (command name, options, invoking user, guild/channel,
//   interaction_id). A PING (type 1) and any unmodeled interaction type carry
//   no capturable command -> []. We do NOT map the Discord user to an
//   acropolisOS actor, read the ontology fence, or invoke any agent action —
//   pure data capture. Downstream classification (a later slice) interprets
//   payload.command / payload.options.
//
// verifyRequest: THE CONTRACT TENSION. The ChannelAdapter contract's
//   verifyRequest(req, envSecret) is SYNCHRONOUS and is handed only the request
//   — it cannot read the raw body synchronously (a Next.js body is an async,
//   single-consumption stream). Discord's Ed25519 signature, however, is over
//   (X-Signature-Timestamp + RAW body). So this method verifies only the
//   VERIFIABLE SUBSET it can see synchronously — the env public key is set AND
//   both signature headers are present — and returns false otherwise. The
//   SUBSTANTIVE Ed25519 check is performed by the ROUTE via verifyDiscordSignature
//   (lib/channels/discord/verify.ts), which has the raw body read once via
//   req.text(). This is NOT a stand-in for the real check: it is a cheap
//   precondition gate that keeps discordAdapter a uniform ChannelAdapter for
//   generic dispatch while the route remains the authority on authenticity.

import type { ChannelAdapter } from "@/lib/channels/adapter";
import type { DiscordInteraction } from "@/lib/channels/discord/types";

const SIG_HEADER = "x-signature-ed25519";
const TS_HEADER = "x-signature-timestamp";

const INTERACTION_TYPE_APPLICATION_COMMAND = 2;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export const discordAdapter: ChannelAdapter = {
  source: "discord",

  verifyRequest(req: Request, envSecret: string | undefined): boolean {
    // Verifiable subset only — see the file header. The route's
    // verifyDiscordSignature(rawBody, ...) is the authority on authenticity.
    if (!envSecret) return false; // inert when DISCORD_PUBLIC_KEY unset
    if (!req.headers.get(SIG_HEADER)) return false;
    if (!req.headers.get(TS_HEADER)) return false;
    return true;
  },

  async parsePayload(body: unknown): Promise<Record<string, unknown>[]> {
    if (!isPlainObject(body) || typeof body.type !== "number") {
      throw new Error("invalid discord interaction");
    }
    const interaction = body as unknown as DiscordInteraction;

    // Only APPLICATION_COMMAND carries data we capture. PING (1) and unmodeled
    // types (message component, autocomplete, modal submit) yield no row.
    if (interaction.type !== INTERACTION_TYPE_APPLICATION_COMMAND) {
      return [];
    }

    const user = interaction.member?.user ?? interaction.user;

    const row: Record<string, unknown> = {
      command: interaction.data?.name ?? null,
      options: interaction.data?.options ?? [],
      interaction_id: interaction.id ?? null,
      guild_id: interaction.guild_id ?? null,
      channel_id: interaction.channel_id ?? null,
      user_id: user?.id ?? null,
      username: user?.username ?? null,
      type: interaction.type,
    };
    return [row];
  },
};
