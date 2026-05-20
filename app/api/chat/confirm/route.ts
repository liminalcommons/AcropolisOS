// M3.8 #35: Server-side confirm endpoint.
//
// The chat panel's Confirm button POSTs here directly instead of injecting a
// bypass_confirmation cue into the LLM message stream. This is the ONLY code
// path where bypassConfirmation=true is set — the LLM tool schema does not
// expose the field at all, so prompt injection cannot induce a bypass.
//
// M3.8 #47 (interim): caller must be role=steward. This narrows the attack
// surface to stewards only while a full nonce-based pending-confirmation
// tracker is deferred to a follow-up. Logged as interim in commit message.
//
// M3.8 #48: Origin header is validated against the app's canonical host so
// cross-site POST requests (CSRF) are rejected with 403 before any work runs.
//
// Request shape: { action: string; params: unknown }
// Response shape: ApplyActionResult (JSON)

import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { createInProcessDispatcher } from "@/lib/actions/dispatcher";
import { runApplyActionTool } from "@/lib/agent/tool-gating";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// M3.8 #48: derive allowed origin from env so tests / staging work too.
function getAllowedOrigin(): string | null {
  const url =
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    null;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function originAllowed(req: Request): boolean {
  const allowed = getAllowedOrigin();
  // If we cannot determine the canonical origin (e.g. local dev without env),
  // fall through — but only if no Origin header is present (same-origin
  // browser requests may omit it; cross-site ones never do).
  if (!allowed) {
    return !req.headers.get("origin");
  }
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin, browser omitted header
  return origin === allowed;
}

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
  // M3.8 #48: CSRF guard — reject mismatched Origin before auth work.
  if (!originAllowed(req)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

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

  // M3.8 #47 (interim): only stewards may confirm actions via this route.
  // Full nonce-based pending-confirmation tracker is a follow-up task.
  if (rt.actor?.role !== "steward") {
    return Response.json({ error: "forbidden" }, { status: 403 });
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
