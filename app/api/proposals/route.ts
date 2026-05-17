import { getProposalStore } from "@/lib/proposals/singleton";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const store = getProposalStore();
  const all = await store.listProposals();
  const pending = all
    .filter((p) => p.status === "pending")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return Response.json({ proposals: pending });
}
