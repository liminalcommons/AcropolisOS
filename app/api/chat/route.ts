import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { AGENT_INSTRUCTIONS, buildLanguageModel } from "@/lib/agent/mastra";

interface ChatRequestBody {
  messages: UIMessage[];
}

function isChatRequestBody(value: unknown): value is ChatRequestBody {
  if (!value || typeof value !== "object") return false;
  const msgs = (value as { messages?: unknown }).messages;
  return Array.isArray(msgs);
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!isChatRequestBody(body)) {
    return Response.json({ error: "missing_messages" }, { status: 400 });
  }

  const result = streamText({
    model: buildLanguageModel(),
    system: AGENT_INSTRUCTIONS,
    messages: await convertToModelMessages(body.messages),
  });
  return result.toTextStreamResponse();
}
