import Link from "next/link";
import type { Ontology } from "@/lib/ontology/schema";
import type { Proposal } from "@/lib/proposals/store";
import type { ProposalDiff } from "@/lib/proposals/diff";
import { cn } from "@/lib/utils";
import { prettify } from "@/lib/prettify";
import { formatRelative } from "@/lib/relative-time";
import { PromptButton } from "./prompt-button";

// S5 · Pure adaptive-layout helper. Exported so a vitest can lock the
// queue-dominant ↔ types-dominant column-span swap without rendering JSX.
export interface AdaptiveLayout {
  queueDominant: boolean;
  typesSpan: string;
  centerSpan: string;
  centerOrder: string;
}

export function computeAdaptiveLayout(pendingCount: number): AdaptiveLayout {
  const queueDominant = pendingCount > 0;
  return {
    queueDominant,
    typesSpan: queueDominant ? "md:col-span-4 md:order-2" : "md:col-span-3",
    centerSpan: queueDominant ? "md:col-span-8" : "md:col-span-9",
    centerOrder: queueDominant ? "md:order-1" : "",
  };
}

// Semantic intent of a proposal — drives card colour + badge text.
// Maps onto the spec's violet (review) / emerald (approve) / amber (assign)
// vocabulary.
export type ProposalIntent = "review" | "approve" | "assign";

const n = (o: Record<string, unknown>): number => Object.keys(o).length;

function hasSchemaChanges(diff: ProposalDiff): boolean {
  return (
    n(diff.new_object_types) > 0 ||
    n(diff.new_link_types) > 0 ||
    n(diff.new_action_types) > 0 ||
    n(diff.new_shared_properties) > 0 ||
    n(diff.modified_properties) > 0
  );
}

function hasDataLanding(diff: ProposalDiff): boolean {
  return n(diff.new_seeds) > 0 || n(diff.new_ingests) > 0;
}

// Classify a proposal into one of three intents. Order matters:
//   schema-touching ⇒ review (violet)
//   data-only       ⇒ approve (emerald)
//   views/roles     ⇒ assign  (amber)
//   ambiguous       ⇒ review  (default)
export function classifyProposal(diff: ProposalDiff): ProposalIntent {
  if (hasSchemaChanges(diff)) return "review";
  if (hasDataLanding(diff)) return "approve";
  if (n(diff.new_views) > 0) return "assign";
  return "review";
}

// Pick the most-relevant entity type for the summary line. Ranking:
//   1. first new_object_type key
//   2. first impacted_tables entry
//   3. first new_seed/new_ingest/new_view target
//   4. first link / action / shared-property key (last resort)
//   5. null (no entity to mention)
function pickEntityKey(diff: ProposalDiff): string | null {
  const objKeys = Object.keys(diff.new_object_types);
  if (objKeys.length > 0) return objKeys[0]!;
  if (diff.impacted_tables.length > 0) return diff.impacted_tables[0]!;
  const seedKeys = Object.keys(diff.new_seeds);
  if (seedKeys.length > 0) {
    const seed = diff.new_seeds[seedKeys[0]!];
    return seed?.object_type ?? seedKeys[0]!;
  }
  const ingestKeys = Object.keys(diff.new_ingests);
  if (ingestKeys.length > 0) {
    const ingest = diff.new_ingests[ingestKeys[0]!];
    return ingest?.target_object_type ?? ingestKeys[0]!;
  }
  const viewKeys = Object.keys(diff.new_views);
  if (viewKeys.length > 0) {
    const view = diff.new_views[viewKeys[0]!];
    return view?.object_type ?? viewKeys[0]!;
  }
  const linkKeys = Object.keys(diff.new_link_types);
  if (linkKeys.length > 0) return linkKeys[0]!;
  const actionKeys = Object.keys(diff.new_action_types);
  if (actionKeys.length > 0) return actionKeys[0]!;
  const propKeys = Object.keys(diff.new_shared_properties);
  if (propKeys.length > 0) return propKeys[0]!;
  return null;
}

// Count distinct types touched so we can append "(+N more)" if multiple.
function distinctTypesTouched(diff: ProposalDiff): number {
  const set = new Set<string>();
  for (const k of Object.keys(diff.new_object_types)) set.add(k);
  for (const k of diff.impacted_tables) set.add(k);
  for (const seed of Object.values(diff.new_seeds)) set.add(seed.object_type);
  for (const ingest of Object.values(diff.new_ingests))
    set.add(ingest.target_object_type);
  for (const view of Object.values(diff.new_views)) set.add(view.object_type);
  return set.size;
}

// Describe the change in entity-aware terms.
//   schema add property:    "add pronouns property (string?)"
//   schema add object:      "add Fund object type"
//   schema add link:        "add role link"
//   schema add action:      "add invite_member action"
//   data seed:              "seed 3 rows"
//   data ingest:            "ingest 2 items"
//   view:                   "add summary view"
//   fallback:               "update"
function describeChange(diff: ProposalDiff): string {
  const sharedKeys = Object.keys(diff.new_shared_properties);
  if (sharedKeys.length > 0) {
    const propName = sharedKeys[0]!;
    const prop = diff.new_shared_properties[propName]!;
    const required = prop.required === true;
    const typeLabel = `${prop.type}${required ? "" : "?"}`;
    return `add ${propName} property (${typeLabel})`;
  }
  const modifiedKeys = Object.keys(diff.modified_properties);
  if (modifiedKeys.length > 0) {
    const propName = modifiedKeys[0]!;
    return `update ${propName} property`;
  }
  const objKeys = Object.keys(diff.new_object_types);
  if (objKeys.length > 0) {
    return `add ${prettify(objKeys[0]!)} object type`;
  }
  const linkKeys = Object.keys(diff.new_link_types);
  if (linkKeys.length > 0) {
    return `add ${linkKeys[0]!} link`;
  }
  const actionKeys = Object.keys(diff.new_action_types);
  if (actionKeys.length > 0) {
    return `add ${actionKeys[0]!} action`;
  }
  const seedKeys = Object.keys(diff.new_seeds);
  if (seedKeys.length > 0) {
    const seed = diff.new_seeds[seedKeys[0]!]!;
    const rowCount = seed.rows_jsonl
      .split("\n")
      .filter((line) => line.trim().length > 0).length;
    return `seed ${rowCount} row${rowCount === 1 ? "" : "s"}`;
  }
  const ingestKeys = Object.keys(diff.new_ingests);
  if (ingestKeys.length > 0) {
    const ingest = diff.new_ingests[ingestKeys[0]!]!;
    return `ingest ${ingest.inbox_ids.length} item${ingest.inbox_ids.length === 1 ? "" : "s"}`;
  }
  const viewKeys = Object.keys(diff.new_views);
  if (viewKeys.length > 0) {
    const view = diff.new_views[viewKeys[0]!]!;
    return `add ${view.view} view`;
  }
  return "update";
}

// Entity-aware proposal summary. Format: "Member · add pronouns property (string?)"
// with a "(+N more)" suffix when multiple types are touched.
export function summarizeDiff(diff: ProposalDiff): string {
  const entity = pickEntityKey(diff);
  const change = describeChange(diff);
  const distinct = distinctTypesTouched(diff);
  const suffix = distinct > 1 ? ` (+${distinct - 1} more)` : "";
  if (entity === null) {
    return `${change}${suffix}`;
  }
  return `${prettify(entity)} · ${change}${suffix}`;
}

// Static visual treatment per intent. Tailwind class strings — kept inline so
// the JIT picks them up.
const INTENT_STYLES: Record<
  ProposalIntent,
  { card: string; badge: string }
> = {
  review: {
    card:
      "border-primary/30 bg-primary/[0.04] hover:border-primary/60 hover:bg-primary/[0.08]",
    badge: "bg-primary/15 text-primary",
  },
  approve: {
    card:
      "border-emerald-500/30 bg-emerald-500/[0.04] hover:border-emerald-500/60 hover:bg-emerald-500/[0.08]",
    badge: "bg-emerald-500/15 text-emerald-300",
  },
  assign: {
    card:
      "border-amber-500/30 bg-amber-500/[0.04] hover:border-amber-500/60 hover:bg-amber-500/[0.08]",
    badge: "bg-amber-500/15 text-amber-300",
  },
};

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
  // S5 · When at least one proposal is pending, the queue dominates: 8-col
  // queue on the left + 4-col types sidebar on the right. With an empty
  // queue we stay on the 3/9 "types-left, suggestions-right" layout so the
  // suggestion chips stay prominent.
  const { queueDominant, typesSpan, centerSpan, centerOrder } =
    computeAdaptiveLayout(pending.length);
  return (
    <main
      className="min-h-full"
      data-state="live"
      data-queue-dominant={queueDominant ? "true" : "false"}
    >
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="flex h-12 items-center gap-4 px-5">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-sm bg-primary" />
            <span className="font-semibold tracking-tight">acropolisOS</span>
          </div>
          <div className="hidden h-7 flex-1 items-center gap-2 rounded border border-border bg-card/60 px-3 text-xs text-muted-foreground md:flex">
            <span>⌕</span>
            <span>Search the ontology — objects, actions, proposals…</span>
            <span className="ml-auto rounded border border-border px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              ⌘K
            </span>
          </div>
          <Link
            href="/proposals"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Proposals
          </Link>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1400px] grid-cols-12 gap-0">
        {/* Types rail — defaults to col-span-3 left; S5 swaps to col-span-4 right (order-2) when the queue takes over */}
        <aside
          data-testid="types-rail"
          className={cn(
            "col-span-12 border-r border-border px-4 py-6 md:min-h-[calc(100vh-3rem)]",
            typesSpan,
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Types · {typeKeys.length}
            </p>
            <span className="text-xs text-muted-foreground">
              {actionCount} actions · {linkCount} links
            </span>
          </div>
          <ul className="space-y-px">
            {typeKeys.map((k) => {
              const c = counts[k];
              return (
                <li key={k}>
                  <Link
                    href={`/${k}`}
                    data-testid={`type-card-${k}`}
                    data-type={k}
                    className="flex items-center justify-between rounded px-2 py-1.5 text-sm transition hover:bg-card/60"
                  >
                    <span className="text-foreground">{prettify(k)}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {c === null ? "—" : c}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <p className="mt-6 mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Workspace
          </p>
          <div className="space-y-1 text-sm">
            <Link
              href="/proposals"
              className="block rounded px-2 py-1.5 text-foreground hover:bg-card/60"
            >
              All proposals
              {pending.length > 0 ? (
                <span className="ml-2 rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-xs text-primary">
                  {pending.length}
                </span>
              ) : null}
            </Link>
            <Link
              href="/chat"
              className="block rounded px-2 py-1.5 text-foreground hover:bg-card/60"
            >
              Full chat
            </Link>
          </div>
        </aside>

        {/* CENTER — Action queue */}
        <section
          data-testid="queue-pane"
          className={cn("col-span-12 px-6 py-8", centerSpan, centerOrder)}
        >
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              Actions for you
              {pending.length > 0 ? ` · ${pending.length}` : ""}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {pending.length > 0
                ? "Pending review"
                : "Your queue is clear"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {pending.length > 0
                ? "Each item below is a typed mutation awaiting your decision."
                : "When the agent proposes ontology or data changes, they land here."}
            </p>
          </div>

          {pending.length > 0 ? (
            <ul className="space-y-2">
              {pending.map((p) => {
                const intent = classifyProposal(p.diff);
                const styles = INTENT_STYLES[intent];
                return (
                  <li key={p.id}>
                    <Link
                      href={`/proposals/${p.id}`}
                      data-testid={`action-${p.id}`}
                      data-intent={intent}
                      className={cn(
                        "group block rounded-md border px-4 py-3 transition",
                        styles.card,
                      )}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "rounded-sm px-1.5 py-0.5 text-xs font-semibold uppercase tracking-widest",
                                styles.badge,
                              )}
                            >
                              {intent}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {p.id.slice(0, 8)}
                            </span>
                          </div>
                          <div className="mt-1.5 text-sm text-foreground">
                            {summarizeDiff(p.diff)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            proposed by agent · {formatRelative(p.created_at)}
                          </div>
                          {p.diff.impacted_tables.length > 0 ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              impacts: {p.diff.impacted_tables.join(", ")}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-md border border-dashed border-border bg-card/20 px-6 py-10">
              <p className="text-sm text-muted-foreground">
                Try one of these to seed your first action:
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <PromptButton
                    key={s}
                    prompt={s}
                    className="rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-foreground transition hover:border-primary/50 hover:text-primary"
                  >
                    {s}
                  </PromptButton>
                ))}
              </div>
              <p className="mt-5 text-xs text-muted-foreground">
                Paste one into the chat at the bottom. The agent will propose a
                typed change; it lands here for you to review.
              </p>
            </div>
          )}

          <div className="mt-10 border-t border-border pt-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
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
    <div className="rounded-md border border-border bg-card px-3 py-3">
      <div className="text-xl font-semibold tracking-tight">{value}</div>
      <div className="mt-0.5 text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
