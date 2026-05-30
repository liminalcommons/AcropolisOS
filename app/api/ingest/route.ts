// Open webhook intake — storyboard Scene 3, "Webhook / API: keep it flowing live,
// POST /ingest -> raw_inbox". UNLIKE the member-gated /api/connect/* routes this
// is reachable WITHOUT a session, so it is guarded by a SHARED SECRET:
//   - disabled (503) unless INGEST_TOKEN is configured (no token => no open hole);
//   - rejected (401) on a missing/mismatched token (constant-time compare).
// Accepts a single JSON object or an array of objects; each becomes a raw_inbox
// row (source='webhook') that surfaces in /organize for classify + grow.
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { raw_inbox } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ROWS = 1000;

function tokenOk(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request): Promise<Response> {
  const expected = process.env.INGEST_TOKEN;
  if (!expected) {
    return Response.json(
      { error: "ingest webhook disabled — set INGEST_TOKEN to enable" },
      { status: 503 },
    );
  }
  const provided =
    req.headers.get("x-ingest-token") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    null;
  if (!tokenOk(provided, expected)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const rows = Array.isArray(body) ? body : [body];
  if (rows.length === 0) {
    return Response.json({ error: "empty payload" }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return Response.json({ error: `too many rows (max ${MAX_ROWS})` }, { status: 413 });
  }
  if (!rows.every((r) => r !== null && typeof r === "object" && !Array.isArray(r))) {
    return Response.json({ error: "each row must be a JSON object" }, { status: 400 });
  }

  const db = getDb();
  const inserted = await db
    .insert(raw_inbox)
    .values(rows.map((payload) => ({ source: "webhook", payload: payload as Record<string, unknown> })))
    .returning({ id: raw_inbox.id });

  return Response.json({ ok: true, count: inserted.length, ids: inserted.map((r) => r.id) }, { status: 201 });
}
