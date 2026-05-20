// M3.8 #35: Server-side confirm endpoint.
//
// The chat panel's Confirm button POSTs here directly instead of injecting a
// bypass_confirmation cue into the LLM message stream. This is the ONLY code
// path where bypassConfirmation=true is set — the LLM tool schema does not
// expose the field at all, so prompt injection cannot induce a bypass.
//
// Request shape: { action: string; params: unknown }
// Response shape: ApplyActionResult (JSON)

import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { createInProcessDispatcher } from "@/lib/actions/dispatcher";
import { runApplyActionTool } from "@/lib/agent/tool-gating";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ConfirmRequestBody {
  action: string;
  params: unknown;
}

function isConfirmRequestBody(value: unknown): value is ConfirmRequestBody {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.action === "string";
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!isConfirmRequestBody(body)) {
    return Response.json({ error: "missing_action" }, { status: 400 });
  }

  const rt = await buildChatRuntime();

  if (isAnonymous(rt.actor)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const dispatcher = createInProcessDispatcher({
    ctx: rt.ctx,
    ontology: rt.ontology,
    functionsDir: rt.functionsDir,
    sideEffectAdapters: rt.sideEffectAdapters,
  });

  // M3.8 #35: bypassConfirmation=true is set HERE (server side), not in
  // tool-call args that the LLM could forge via prompt injection.
  const result = await runApplyActionTool({
    actor: rt.actor,
    dispatcher,
    action: body.action,
    params: body.params,
    policy: { ontology: rt.ontology, ctx: rt.ctx },
    bypassConfirmation: true,
  });

  return Response.json(result);
}
