// app/api/channels/telegram/route.ts
//
// Inbound Telegram webhook — deposits Telegram messages into raw_inbox as DATA
// (source='telegram') for later classification. Reachable WITHOUT a session
// (Telegram has no acropolisOS account), so it is guarded by a shared secret the
// same way /api/ingest is:
//   - 503 when TELEGRAM_WEBHOOK_SECRET is unset (endpoint inert — no open hole),
//   - 401 on a missing/mismatched X-Telegram-Bot-Api-Secret-Token (constant-time),
//   - 400 on invalid JSON or a malformed Update,
//   - 200 { ok, count: 0, ids: [] } when the Update carries no message content,
//   - 201 { ok, count, ids } after inserting via the shared ingestChannelRows.
//
// INBOUND-ONLY: this route maps Telegram payloads to raw_inbox rows and nothing
// else — no authenticated reads, no ontology fence, no agent actions, no mapping
// of a Telegram user to an acropolisOS actor (a later slice does that).

import { getDb } from "@/lib/db/client";
import { ingestChannelRows } from "@/lib/channels/ingest";
import { telegramAdapter } from "@/lib/channels/telegram/adapter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json(
      { error: "telegram webhook disabled — set TELEGRAM_WEBHOOK_SECRET to enable" },
      { status: 503 },
    );
  }

  // Constant-time secret verification (adapter never logs/echoes the secret).
  if (!telegramAdapter.verifyRequest(req, secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  let rows: Record<string, unknown>[];
  try {
    rows = await telegramAdapter.parsePayload(body);
  } catch (err) {
    // parsePayload throws a SAFE message (no secret/token) on a malformed Update.
    return Response.json(
      { error: err instanceof Error ? err.message : "invalid telegram update" },
      { status: 400 },
    );
  }

  if (rows.length === 0) {
    // A well-formed Update with no capturable content (service message, etc.).
    return Response.json({ ok: true, count: 0, ids: [] }, { status: 200 });
  }

  const { ids, count } = await ingestChannelRows(getDb(), telegramAdapter.source, rows);
  return Response.json({ ok: true, count, ids }, { status: 201 });
}
