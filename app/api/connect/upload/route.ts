// F2-step1: /api/connect/upload — accepts a single row from the file-drop strip
// and inserts it into raw_inbox with source='file-drop'.
//
// Body: { source: 'file-drop', payload: unknown }
// Response: { ok: true, id: string } | { error: string }

import { z } from "zod";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import { raw_inbox } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UploadBodySchema = z.object({
  source: z.enum(["file-drop"]),
  payload: z.unknown(),
});

export async function POST(req: Request): Promise<Response> {
  // Auth gate — any authenticated member may push data.
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = UploadBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const { source, payload } = parsed.data;

  const db = getDb();
  const [inserted] = await db
    .insert(raw_inbox)
    .values({ source, payload: payload as Record<string, unknown> })
    .returning({ id: raw_inbox.id });

  if (!inserted) {
    return Response.json({ error: "insert failed" }, { status: 500 });
  }

  return Response.json({ ok: true, id: inserted.id }, { status: 201 });
}
