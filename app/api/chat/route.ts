import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { AGENT_INSTRUCTIONS, buildLanguageModel } from "@/lib/agent/mastra";
import { buildAiSdkProposalTools } from "@/lib/proposals/ai-sdk-tools";
import { getProposalStore } from "@/lib/proposals/singleton";
import { getInboxStore } from "@/lib/inbox/singleton";

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

  // The chat panel sends a stable session_id so finalize_proposal() can
  // associate proposals with this chat. We bind it at tool-construction time
  // so the model only needs to pass content-bearing args; it never has to
  // remember or echo the session id.
  const session_id =
    typeof body.session_id === "string" && body.session_id
      ? body.session_id
      : `anon-${Math.random().toString(36).slice(2, 10)}`;

  const tools = buildAiSdkProposalTools(getProposalStore(), session_id, getInboxStore());

  const result = streamText({
    model: buildLanguageModel(),
    system: AGENT_INSTRUCTIONS,
    messages: await convertToModelMessages(body.messages),
    tools,
    // Allow the model to chain multiple tool calls + a final text reply
    // within a single user turn (propose → propose → finalize → summarize).
    stopWhen: stepCountIs(8),
  });
  return result.toTextStreamResponse();
}
