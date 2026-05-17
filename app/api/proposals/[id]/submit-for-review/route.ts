import { ProposalNotFoundError } from "@/lib/proposals/store";
import { getProposalStore } from "@/lib/proposals/singleton";
import { notifyStewardsOfProposal } from "@/lib/proposals/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

// US-018: Non-steward "Submit for review" endpoint.
//
// The proposal is already pending (finalize_proposal queued it). This route
// confirms the proposal exists, then dispatches a steward notification so the
// queue is actually seen. Status stays "pending" — the steward decides.
export async function POST(
  req: Request,
  ctx: RouteCtx,
): Promise<Response> {
  const { id } = await ctx.params;
  const proposal = await getProposalStore().getProposal(id);
  if (!proposal) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  let submittedBy: string | undefined;
  try {
    const body = (await req.clone().json()) as { submitted_by?: unknown };
    if (typeof body.submitted_by === "string") submittedBy = body.submitted_by;
  } catch {
    // No body / non-json is fine.
  }
  try {
    await notifyStewardsOfProposal({ proposalId: id, submittedBy });
  } catch (err) {
    if (err instanceof ProposalNotFoundError) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    throw err;
  }
  return Response.json({ ok: true, proposal });
}
