import { ProposalNotFoundError } from "@/lib/proposals/store";
import { getProposalStore } from "@/lib/proposals/singleton";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

// US-019: marks the proposal approved so the review queue clears it.
// Wiring this into the full applyProposal pipeline (US-020) — yaml writer,
// codegen, migrations, git — happens in US-018 where actor context is at
// hand. Keeping the queue-side endpoint thin lets the UI ship in isolation.
export async function POST(
  _req: Request,
  ctx: RouteCtx,
): Promise<Response> {
  const { id } = await ctx.params;
  try {
    const updated = await getProposalStore().setStatus(id, "approved");
    return Response.json({ proposal: updated });
  } catch (err) {
    if (err instanceof ProposalNotFoundError) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    throw err;
  }
}
