import { getProposalStore } from "@/lib/proposals/singleton";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
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
