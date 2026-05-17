import { ProposalNotFoundError } from "@/lib/proposals/store";
import { getProposalStore } from "@/lib/proposals/singleton";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(
  _req: Request,
  ctx: RouteCtx,
): Promise<Response> {
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
