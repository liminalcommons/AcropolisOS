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
import { isNull } from "drizzle-orm";
import type { RawInboxRow } from "@/lib/db/schema";
import { ProposalReviewList } from "./proposal-review-list";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function OrganizePage(): Promise<React.ReactElement> {
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) {
    redirect("/signin");
  }

  const isSteward = chatRuntime.actor.role === "steward";

  const db = getDb();
  const unclassified: RawInboxRow[] = await db
    .select()
    .from(raw_inbox)
    .where(isNull(raw_inbox.classified_as))
    .orderBy(raw_inbox.received_at);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">

        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
              ← dashboard
            </Link>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
            Proposal review{" "}
            <span className="text-zinc-500 font-normal">·</span>{" "}
            <span className="text-zinc-400 font-normal text-base">
              {unclassified.length} unclassified row{unclassified.length !== 1 ? "s" : ""}
            </span>
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            Classify each raw inbox row to generate a typed proposal, then confirm or reject.
          </p>
          {!isSteward && (
            <p className="mt-2 text-xs text-amber-500/80">
              View-only — steward role required to classify.
            </p>
          )}
        </div>

        {unclassified.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-8 text-center">
            <p className="text-sm text-zinc-500">No unclassified rows in raw_inbox.</p>
            <p className="text-xs text-zinc-600 mt-2">
              Drop a CSV or JSON file at{" "}
              <Link href="/connect" className="underline underline-offset-2 hover:text-zinc-400">
                /connect
              </Link>{" "}
              to ingest data.
            </p>
          </div>
        ) : (
          <ProposalReviewList rows={unclassified} isSteward={isSteward} />
        )}

      </div>
    </main>
  );
}
