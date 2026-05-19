// M2.2 step-5: chat route now wires apply_action alongside propose_*.
//
// Per-request setup:
//   1. buildChatRuntime() resolves the actor (auth().session or sentinel),
//      loads the ontology, builds the OntologyCtx + PG audit store, and
//      identifies functionsDir.
//   2. createInProcessDispatcher routes apply_action calls through the same
//      audit-pre + permission-check + handler + audit-post pipeline as the
//      durable Inngest path.
//   3. buildApplyActionAiSdkTool emits the ai-sdk tool shape (discriminated
//      union narrowed to actor-permitted action types, plus an opt-in
//      bypass_confirmation flag the UI sets after Confirm).
//   4. Tools record merges proposal tools (vibe-coding) + apply_action
//      (committed mutations). The agent picks the right surface per request.

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
import { buildChatRuntime } from "@/lib/agent/chat-runtime";
import { createInProcessDispatcher } from "@/lib/actions/dispatcher";
import { buildApplyActionAiSdkTool } from "@/lib/agent/apply-action-ai-sdk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ChatRequestBody {
  messages: UIMessage[];
  session_id?: string;
}

function isChatRequestBody(value: unknown): value is ChatRequestBody {
  if (!value || typeof value !== "object") return false;
  const msgs = (value as { messages?: unknown }).messages;
  return Array.isArray(msgs);
}

// Extended instructions: tell the agent when apply_action vs propose_* is
// appropriate. Keeps the agent from misusing apply_action for schema work.
const APPLY_ACTION_INSTRUCTIONS = [
  "",
  "You have two distinct mutation surfaces:",
  "  - propose_* + finalize_proposal: stage ONTOLOGY changes (new object/link/property/action types, new ingest mappings). These DO NOT mutate live state until a steward reviews and applies the proposal.",
  "  - apply_action: invoke a typed action to mutate LIVE state immediately (e.g., change_tier on an existing Member, record_attendance). These commit when called.",
  "Use apply_action only when the user asks to do something on the live data and the action_type already exists. If they ask for new behavior, propose first.",
  "Some actions have a confirmation policy. If apply_action returns confirmation_required, do NOT silently re-call it with bypass_confirmation — present the requested change in your text reply and let the user click Confirm.",
].join(" ");

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

  const session_id =
    typeof body.session_id === "string" && body.session_id
      ? body.session_id
      : `anon-${Math.random().toString(36).slice(2, 10)}`;

  const runtime = await buildChatRuntime();

  const dispatcher = createInProcessDispatcher({
    ctx: runtime.ctx,
    ontology: runtime.ontology,
    functionsDir: runtime.functionsDir,
    // M2.4: forward env-resolved adapters so notify_member fires after
    // every successful apply_action and the dispatch results land as
    // child action_audit rows linked to the parent.
    sideEffectAdapters: runtime.sideEffectAdapters,
  });

  const applyActionTool = buildApplyActionAiSdkTool({
    actor: runtime.actor,
    ontology: runtime.ontology,
    ctx: runtime.ctx,
    dispatcher,
  });

  const proposalTools = buildAiSdkProposalTools(
    getProposalStore(),
    session_id,
    getInboxStore(),
  );

  const tools = {
    ...proposalTools,
    apply_action: applyActionTool,
  };

  const result = streamText({
    model: buildLanguageModel(),
    system: `${AGENT_INSTRUCTIONS}${APPLY_ACTION_INSTRUCTIONS}`,
    messages: await convertToModelMessages(body.messages),
    tools,
    stopWhen: stepCountIs(8),
  });
  // M2.3 step-3: emit the UI message stream so tool outputs (apply_action
  // confirmation_required envelopes, audit_id, propose_* results) reach the
  // client's useChat({messages}) state as structured parts. toTextStreamResponse
  // would concatenate only text deltas and silently drop tool result frames,
  // leaving the chat panel's confirmation card permanently inert.
  return result.toUIMessageStreamResponse();
}
