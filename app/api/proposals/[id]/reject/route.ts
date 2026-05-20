import { ProposalNotFoundError } from "@/lib/proposals/store";
import { getProposalStore } from "@/lib/proposals/singleton";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(
  _req: Request,
  ctx: RouteCtx,
): Promise<Response> {
  const runtime_ctx = await buildChatRuntime();
  if (isAnonymous(runtime_ctx.actor)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const updated = await getProposalStore().setStatus(id, "rejected");
    return Response.json({ proposal: updated });
  } catch (err) {
    if (err instanceof ProposalNotFoundError) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    throw err;
  }
}
