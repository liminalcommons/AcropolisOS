import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { AGENT_INSTRUCTIONS, buildLanguageModel } from "@/lib/agent/mastra";

interface ChatRequestBody {
  messages: UIMessage[];
  session_id?: string;
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

  // US-018: the chat panel sends a stable session_id so finalize_proposal()
  // can associate proposals with this chat. The id is folded into the system
  // prompt so the agent uses it consistently when it calls propose_* /
  // finalize_proposal tools (wiring of the actual tools into streamText is the
  // follow-up that completes the round-trip).
  const sessionLine =
    typeof body.session_id === "string" && body.session_id
      ? `\nCurrent chat session_id: ${body.session_id}. Pass this to propose_* and finalize_proposal tools.`
      : "";

  const result = streamText({
    model: buildLanguageModel(),
    system: AGENT_INSTRUCTIONS + sessionLine,
    messages: await convertToModelMessages(body.messages),
  });
  return result.toTextStreamResponse();
}
