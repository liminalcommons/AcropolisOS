// app/api/channels/discord/route.ts
//
// Inbound Discord Interactions Endpoint — deposits Discord slash-command
// interactions into raw_inbox as DATA (source='discord') for later
// classification. Reachable WITHOUT a session (Discord has no acropolisOS
// account), so it is authenticated by Discord's Ed25519 signature verified
// against DISCORD_PUBLIC_KEY:
//   - 503 when DISCORD_PUBLIC_KEY is unset (endpoint inert — no open hole),
//   - 401 on a missing/invalid signature (never leaks the key),
//   - 400 on invalid JSON or a malformed interaction,
//   - 200 {type:1} on a validly-signed PING (the PONG handshake),
//   - 2xx {type:4,data:{content}} on a validly-signed APPLICATION_COMMAND,
//     having inserted via the shared ingestChannelRows.
//
// WIRE CONTRACT (critique C1/C2): the JSON body Discord reads is EXACTLY the
// interaction-response object — {type:1} for PING, {type:4,data:{content}} for a
// command — and NOTHING else. The internal {ok,count,ids} accounting is exposed
// ONLY via the X-Ingest-Result header so it can be asserted/observed without
// corrupting the body Discord parses. We read the RAW body ONCE via req.text()
// before any JSON.parse, because a Next.js Request body is single-consumption
// and re-serializing parsed JSON would change the bytes and break the signature.
// With runtime='nodejs' + dynamic='force-dynamic' there is NO body-parser
// middleware stripping the raw bytes — do NOT add one.
//
// ORDER (C3): verify signature -> JSON.parse(rawBody) -> if type===1 return the
// {type:1} PONG (BEFORE parsePayload, so a PING never falls through to an
// empty-rows branch) -> else parsePayload -> ingestChannelRows(source='discord').
//
// INBOUND-ONLY: no authenticated reads, no ontology fence, no agent actions, no
// mapping of a Discord user to an acropolisOS actor (a later slice does that).
//
// LATENCY/IDEMPOTENCY NOTES: the 3s ACK budget includes the synchronous
// ingestChannelRows insert; under serverless cold-start + DB connect the
// user-visible ack could exceed 3s (the row still lands). interaction_id is
// captured per row; Discord-retry double-insert is a downstream/classify
// concern, not handled here (raw_inbox is a messy-data landing zone).

import { getDb } from "@/lib/db/client";
import { ingestChannelRows } from "@/lib/channels/ingest";
import { discordAdapter } from "@/lib/channels/discord/adapter";
import { verifyDiscordSignature } from "@/lib/channels/discord/verify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIG_HEADER = "x-signature-ed25519";
const TS_HEADER = "x-signature-timestamp";

const INTERACTION_TYPE_PING = 1;
// Discord interaction-response types:
const RESPONSE_TYPE_PONG = 1; // ACK a PING
const RESPONSE_TYPE_CHANNEL_MESSAGE_WITH_SOURCE = 4; // inline ack for a command

export async function POST(req: Request): Promise<Response> {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    return Response.json(
      { error: "discord interactions disabled — set DISCORD_PUBLIC_KEY to enable" },
      { status: 503 },
    );
  }

  // Read the RAW body ONCE — required before JSON.parse for signature integrity.
  const rawBody = await req.text();
  const signature = req.headers.get(SIG_HEADER);
  const timestamp = req.headers.get(TS_HEADER);

  // Ed25519 over (timestamp + rawBody) against DISCORD_PUBLIC_KEY. The pure
  // helper is the authority; the adapter's verifyRequest only gates the
  // verifiable subset (it cannot see the raw body synchronously).
  if (
    !signature ||
    !timestamp ||
    !verifyDiscordSignature(rawBody, signature, timestamp, publicKey)
  ) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  // C3: PING short-circuits to the PONG BEFORE parsePayload — a PING must never
  // fall through to the empty-rows branch. The body is EXACTLY {type:1}.
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as { type?: unknown }).type === INTERACTION_TYPE_PING
  ) {
    return Response.json({ type: RESPONSE_TYPE_PONG }, { status: 200 });
  }

  let rows: Record<string, unknown>[];
  try {
    rows = await discordAdapter.parsePayload(parsed);
  } catch (err) {
    // parsePayload throws a SAFE message (no secret) on a malformed interaction.
    return Response.json(
      { error: err instanceof Error ? err.message : "invalid discord interaction" },
      { status: 400 },
    );
  }

  // No capturable command (PING already handled; unmodeled interaction types):
  // acknowledge to Discord but ingest nothing. The wire body is the {type:4} ack.
  if (rows.length === 0) {
    return Response.json(
      { type: RESPONSE_TYPE_CHANNEL_MESSAGE_WITH_SOURCE, data: { content: "received" } },
      { status: 200, headers: { "X-Ingest-Result": JSON.stringify({ ok: true, count: 0, ids: [] }) } },
    );
  }

  const { ids, count } = await ingestChannelRows(getDb(), discordAdapter.source, rows);

  // C1: the body Discord reads is ONLY the {type:4,data:{content}} ack. The
  // {ok,count,ids} accounting rides in a header, never co-mingled into the body.
  return Response.json(
    { type: RESPONSE_TYPE_CHANNEL_MESSAGE_WITH_SOURCE, data: { content: "received" } },
    {
      status: 201,
      headers: { "X-Ingest-Result": JSON.stringify({ ok: true, count, ids }) },
    },
  );
}
