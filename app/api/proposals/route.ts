import { getProposalStore } from "@/lib/proposals/singleton";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const runtime_ctx = await buildChatRuntime();
  if (isAnonymous(runtime_ctx.actor)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const sessionFilter = url.searchParams.get("session_id");
  const store = getProposalStore();
  const all = await store.listProposals();
  const pending = all
    .filter((p) => p.status === "pending")
    .filter((p) => (sessionFilter ? p.session_id === sessionFilter : true))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return Response.json({ proposals: pending });
}
