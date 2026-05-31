// A2: /organize — proposal review surface (human-in-the-loop gate).
//
// Server component shell. Auth-gated (anon → /signin; non-steward sees
// restricted notice but can still view the queue — classify triggers are
// steward-only in the client gate). Lists unclassified raw_inbox rows and
// delegates interactive classify + proposal rendering to ProposalReviewList.
//
// SCOPE: this page is READ-ONLY. Zero world-model writes. No modification of
// raw_inbox.classified_as/at/by. The Confirm action returns a placeholder
// { status: "not_implemented" } — commit is A3.

import Link from "next/link";
import { redirect } from "next/navigation";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import { raw_inbox } from "@/lib/db/schema";
import { asc, isNull, sql } from "drizzle-orm";
import type { RawInboxRow } from "@/lib/db/schema";
import { ProposalReviewList } from "./proposal-review-list";
import { GrowPanel } from "@/components/organize/GrowPanel";
import { BatchPanel, type SourceGroup } from "@/components/organize/BatchPanel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// SCALABILITY FIX: /organize must never render all unclassified rows. The header
// count is a count(*) aggregate (not rows.length) and the list is a bounded page
// (LIMIT PAGE_SIZE, OFFSET by ?page) — at most PAGE_SIZE rows are fetched/rendered.
const PAGE_SIZE = 50;

export default async function OrganizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.ReactElement> {
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) {
    redirect("/signin");
  }

  const isSteward = chatRuntime.actor.role === "steward";

  const sp = await searchParams;
  const page = Math.max(1, Number(sp?.page ?? "1") || 1);

  const db = getDb();

  // Header count — a single aggregate, never materializes the rows.
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(raw_inbox)
    .where(isNull(raw_inbox.classified_as));

  // Bounded page — at most PAGE_SIZE rows reach the client. id is a deterministic
  // tiebreaker so paging is stable across rows sharing a received_at.
  const unclassified: RawInboxRow[] = await db
    .select()
    .from(raw_inbox)
    .where(isNull(raw_inbox.classified_as))
    .orderBy(asc(raw_inbox.received_at), asc(raw_inbox.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  // Source groups for the batch panel — count(*) per source, never row bodies.
  const sourceGroups: SourceGroup[] = isSteward
    ? (
        await db
          .select({ source: raw_inbox.source, n: sql<number>`count(*)::int` })
          .from(raw_inbox)
          .where(isNull(raw_inbox.classified_as))
          .groupBy(raw_inbox.source)
          .orderBy(sql`count(*) desc`)
      ).map((r) => ({ source: r.source, n: r.n }))
    : [];

  const pageStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = (page - 1) * PAGE_SIZE + unclassified.length;
  const hasPrev = page > 1;
  const hasNext = page * PAGE_SIZE < total;

  return (
    <main className="min-h-full font-sans">
      <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">

        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              ← dashboard
            </Link>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Proposal review{" "}
            <span className="text-muted-foreground font-normal">·</span>{" "}
            <span className="text-muted-foreground font-normal text-base">
              {total} unclassified row{total !== 1 ? "s" : ""}
            </span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Classify each raw inbox row to generate a typed proposal, then confirm or reject.
          </p>
          {!isSteward && (
            <p className="mt-2 text-xs text-amber-500/80">
              View-only — steward role required to classify.
            </p>
          )}
        </div>

        {total === 0 ? (
          <div className="rounded-lg border border-border bg-card/20 p-8 text-center">
            <p className="text-sm text-muted-foreground">No unclassified rows in raw_inbox.</p>
            <p className="text-xs text-muted-foreground/60 mt-2">
              Drop a CSV or JSON file at{" "}
              <Link href="/connect" className="underline underline-offset-2 hover:text-foreground">
                /connect
              </Link>{" "}
              to ingest data.
            </p>
          </div>
        ) : (
          <>
            {isSteward && sourceGroups.length > 0 && <BatchPanel sources={sourceGroups} />}
            {isSteward && (
              <GrowPanel rows={unclassified.map((r) => ({ id: r.id, payload: r.payload }))} />
            )}
            <ProposalReviewList rows={unclassified} isSteward={isSteward} />

            {/* Pager — keeps the page a pure server component; no virtualization dep. */}
            {(hasPrev || hasNext) && (
              <div className="flex items-center justify-between pt-2 text-xs">
                {hasPrev ? (
                  <Link
                    href={`/organize?page=${page - 1}`}
                    className="rounded-md border border-border bg-card/40 px-3 py-1.5 text-muted-foreground hover:bg-card/60 transition-colors"
                  >
                    ← prev
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-muted-foreground/70">
                  page {page} · rows {pageStart}–{pageEnd} of {total}
                </span>
                {hasNext ? (
                  <Link
                    href={`/organize?page=${page + 1}`}
                    className="rounded-md border border-border bg-card/40 px-3 py-1.5 text-muted-foreground hover:bg-card/60 transition-colors"
                  >
                    next →
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            )}
          </>
        )}

      </div>
    </main>
  );
}
