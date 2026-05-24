// F4: /api/organize/classify — streams agent classification narrative.
//
// Receives raw_inbox rows, runs streamText with a classification system prompt,
// streams back text deltas in AI SDK v6 data stream format.
// No tools needed for this slice — pure text narration.

import { streamText } from "ai";
import { buildLanguageModel } from "@/lib/agent/mastra";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CLASSIFY_SYSTEM_PROMPT = [
  "You are an organizer reading inbound rows from a community hostel's raw inbox.",
  "Each row comes from a different source (manual entry, spreadsheet import, webhook) with inconsistent field names.",
  "Your job is to read the rows and narrate what you see, as if thinking out loud to the manager watching you work.",
  "For each row, identify:",
  "  (a) the most likely ontology object type (Guest, Member, Booking, Event, or Unknown)",
  "  (b) which fields map to known object fields (e.g. 'name' → full_name, 'arrival' → arrived_at, 'checkin' → from_date)",
  "  (c) any duplicates or likely merges across rows (same person with different spellings, same booking from two sources)",
  "Narrate naturally — start with 'I see N rows', walk through each one briefly, call out the duplicate when you find it,",
  "then end with a one-paragraph summary the manager can act on.",
  "Keep it concise but specific. Mention exact field names. If you're uncertain about a type, say so.",
].join(" ");

interface ClassifyRequestBody {
  rows: unknown[];
}

function isClassifyBody(value: unknown): value is ClassifyRequestBody {
  if (!value || typeof value !== "object") return false;
  return Array.isArray((value as { rows?: unknown }).rows);
}

export async function POST(req: Request): Promise<Response> {
  // Auth gate — same pattern as /api/chat
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isClassifyBody(body)) {
    return Response.json({ error: "missing_rows" }, { status: 400 });
  }

  const rowCount = body.rows.length;
  const userPrompt = [
    `Here are ${rowCount} row${rowCount !== 1 ? "s" : ""} from the raw inbox. Please organize them:`,
    "",
    JSON.stringify(body.rows, null, 2),
  ].join("\n");

  let model;
  try {
    model = buildLanguageModel();
  } catch (err) {
    // LLM not configured — return a graceful fallback stream
    const fallback = [
      `LLM not configured: ${err instanceof Error ? err.message : String(err)}`,
      "",
      `I would have classified ${rowCount} row${rowCount !== 1 ? "s" : ""} from the raw inbox,`,
      "but no language model is configured. Set LLM_PROVIDER and LLM_API_KEY to enable narration.",
    ].join("\n");

    return new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(fallback));
          controller.close();
        },
      }),
      {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      },
    );
  }

  const result = streamText({
    model,
    system: CLASSIFY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  return result.toTextStreamResponse();
}
