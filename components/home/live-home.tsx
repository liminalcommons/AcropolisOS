import Link from "next/link";
import type { Ontology } from "@/lib/ontology/schema";
import type { Proposal } from "@/lib/proposals/store";

function summarizeDiff(diff: Proposal["diff"]): string {
  const counts: string[] = [];
  const n = (o: Record<string, unknown>) => Object.keys(o).length;
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

function prettify(key: string): string {
  return key
    .split("_")
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const SUGGESTIONS = [
  "Add a pronouns property to Member",
  "Create a 'fund' object type with balance and currency",
  "Propose a 'role' link between Member and Event",
];

interface LiveHomeProps {
  ontology: Ontology;
  typeKeys: string[];
  counts: Record<string, number | null>;
  pending: Proposal[];
  actionCount: number;
  linkCount: number;
}

export function LiveHome({
  ontology: _ontology,
  typeKeys,
  counts,
  pending,
  actionCount,
  linkCount,
}: LiveHomeProps): React.ReactElement {
  void _ontology;
  return (
    <main
      className="min-h-screen bg-zinc-950 text-zinc-100"
      data-state="live"
    >
      <header className="sticky top-0 z-30 border-b border-zinc-900 bg-zinc-950/85 backdrop-blur">
        <div className="flex h-12 items-center gap-4 px-5">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-sm bg-violet-400" />
            <span className="font-semibold tracking-tight">acropolisOS</span>
          </div>
          <div className="hidden h-7 flex-1 items-center gap-2 rounded border border-zinc-800 bg-zinc-900/60 px-3 text-xs text-zinc-500 md:flex">
            <span>⌕</span>
            <span>Search the ontology — objects, actions, proposals…</span>
            <span className="ml-auto rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
              ⌘K
            </span>
          </div>
          <Link
            href="/proposals"
            className="text-xs text-zinc-400 hover:text-zinc-100"
          >
            Proposals
          </Link>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1400px] grid-cols-12 gap-0">
        {/* LEFT RAIL — Types */}
        <aside className="col-span-12 border-r border-zinc-900 px-4 py-6 md:col-span-3 md:min-h-[calc(100vh-3rem)]">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Types · {typeKeys.length}
            </p>
            <span className="text-[10px] text-zinc-600">
              {actionCount} actions · {linkCount} links
            </span>
          </div>
          <ul className="space-y-px">
            {typeKeys.map((k) => {
              const c = counts[k];
              return (
                <li key={k}>
                  <div
                    data-testid={`type-card-${k}`}
                    data-type={k}
                    className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-zinc-900/60"
                  >
                    <span className="text-zinc-200">{prettify(k)}</span>
                    <span className="font-mono text-[11px] text-zinc-500">
                      {c === null ? "—" : c}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="mt-6 mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Workspace
          </p>
          <div className="space-y-1 text-sm">
            <Link
              href="/proposals"
              className="block rounded px-2 py-1.5 text-zinc-300 hover:bg-zinc-900/60"
            >
              All proposals
              {pending.length > 0 ? (
                <span className="ml-2 rounded-full bg-violet-500/15 px-1.5 py-0.5 font-mono text-[10px] text-violet-300">
                  {pending.length}
                </span>
              ) : null}
            </Link>
            <Link
              href="/chat"
              className="block rounded px-2 py-1.5 text-zinc-300 hover:bg-zinc-900/60"
            >
              Full chat
            </Link>
          </div>
        </aside>

        {/* CENTER — Action queue */}
        <section className="col-span-12 px-6 py-8 md:col-span-9">
          <div className="mb-6">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-400">
              Actions for you
              {pending.length > 0 ? ` · ${pending.length}` : ""}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {pending.length > 0
                ? "Pending review"
                : "Your queue is clear"}
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              {pending.length > 0
                ? "Each item below is a typed mutation awaiting your decision."
                : "When the agent proposes ontology or data changes, they land here."}
            </p>
          </div>

          {pending.length > 0 ? (
            <ul className="space-y-2">
              {pending.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/proposals/${p.id}`}
                    data-testid={`action-${p.id}`}
                    className="group block rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-3 transition hover:border-violet-500/50 hover:bg-violet-500/[0.04]"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="rounded-sm bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-violet-300">
                            review
                          </span>
                          <span className="font-mono text-xs text-zinc-500">
                            {p.id.slice(0, 8)}
                          </span>
                        </div>
                        <div className="mt-1.5 text-sm text-zinc-100">
                          {summarizeDiff(p.diff)}
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
                        {p.created_at.slice(0, 10)}
                      </time>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-900/20 px-6 py-10">
              <p className="text-sm text-zinc-400">
                Try one of these to seed your first action:
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <span
                    key={s}
                    className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-300"
                  >
                    {s}
                  </span>
                ))}
              </div>
              <p className="mt-5 text-xs text-zinc-500">
                Paste one into the chat at the bottom. The agent will propose a
                typed change; it lands here for you to review.
              </p>
            </div>
          )}

          <div className="mt-10 border-t border-zinc-900 pt-6">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Your world at a glance
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Object types" value={typeKeys.length} />
              <Stat label="Link types" value={linkCount} />
              <Stat label="Action types" value={actionCount} />
              <Stat
                label="Total entities"
                value={Object.values(counts).reduce<number>(
                  (acc, n) => acc + (n ?? 0),
                  0,
                )}
              />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: number;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/30 px-3 py-3">
      <div className="text-xl font-semibold tracking-tight">{value}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-widest text-zinc-500">
        {label}
      </div>
    </div>
  );
}
