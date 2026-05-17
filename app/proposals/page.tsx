import Link from "next/link";
import { getProposalStore } from "@/lib/proposals/singleton";
import type { Proposal } from "@/lib/proposals/store";

export const dynamic = "force-dynamic";

function summarize(diff: Proposal["diff"]): string {
  const counts: string[] = [];
  const n = (o: Record<string, unknown>): number => Object.keys(o).length;
  if (n(diff.new_object_types) > 0)
    counts.push(`${n(diff.new_object_types)} object type(s)`);
  if (n(diff.new_link_types) > 0)
    counts.push(`${n(diff.new_link_types)} link type(s)`);
  if (n(diff.new_action_types) > 0)
    counts.push(`${n(diff.new_action_types)} action(s)`);
  if (n(diff.new_shared_properties) > 0)
    counts.push(`${n(diff.new_shared_properties)} property(ies)`);
  if (n(diff.new_views) > 0) counts.push(`${n(diff.new_views)} view(s)`);
  if (n(diff.new_seeds) > 0) counts.push(`${n(diff.new_seeds)} seed(s)`);
  if (n(diff.new_ingests) > 0) counts.push(`${n(diff.new_ingests)} ingest(s)`);
  return counts.length > 0 ? counts.join(" · ") : "empty diff";
}

export default async function ProposalsPage(): Promise<React.ReactElement> {
  const all = await getProposalStore().listProposals();
  const pending = all
    .filter((p) => p.status === "pending")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-4xl px-8 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">Proposals</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Pending steward review queue. Newest first.
        </p>

        {pending.length === 0 ? (
          <p className="mt-12 text-sm text-zinc-500">
            No proposals are awaiting review.
          </p>
        ) : (
          <ul className="mt-8 divide-y divide-zinc-800 rounded-md border border-zinc-800">
            {pending.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/proposals/${p.id}`}
                  data-testid={`proposal-row-${p.id}`}
                  className="flex items-center justify-between gap-6 px-4 py-3 hover:bg-zinc-900"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs text-zinc-300">
                      {p.id.slice(0, 8)}
                      <span className="text-zinc-600"> · session </span>
                      <span className="text-zinc-400">{p.session_id}</span>
                    </div>
                    <div className="mt-1 text-sm text-zinc-200">
                      {summarize(p.diff)}
                    </div>
                    {p.diff.impacted_tables.length > 0 ? (
                      <div className="mt-1 text-xs text-zinc-500">
                        impacts: {p.diff.impacted_tables.join(", ")}
                      </div>
                    ) : null}
                  </div>
                  <time
                    dateTime={p.created_at}
                    className="shrink-0 text-xs text-zinc-500"
                  >
                    {p.created_at}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
