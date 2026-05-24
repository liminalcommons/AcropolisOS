// F4: /organize — raw inbox listing (storyboard frame 3 → frame 4 entry point).
//
// Server component. Auth-gated. Lists all raw_inbox rows as JSON cards with
// source badges. A "Have the agent organize these" button leads to /organize/run.

import Link from "next/link";
import { redirect } from "next/navigation";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import { raw_inbox } from "@/lib/db/schema";
import type { RawInboxRow } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SOURCE_COLORS: Record<string, string> = {
  manual: "bg-zinc-800 text-zinc-300",
  "sheets-import": "bg-blue-900/50 text-blue-300",
  "webhook-booking": "bg-violet-900/50 text-violet-300",
};

function sourceBadgeClass(source: string): string {
  return SOURCE_COLORS[source] ?? "bg-zinc-800 text-zinc-400";
}

export default async function OrganizePage(): Promise<React.ReactElement> {
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) {
    redirect("/signin");
  }

  const db = getDb();
  const rows: RawInboxRow[] = await db
    .select()
    .from(raw_inbox)
    .orderBy(raw_inbox.received_at);

  const unclassified = rows.filter((r) => r.classified_as === null);

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
            Raw inbox{" "}
            <span className="text-zinc-500 font-normal">·</span>{" "}
            <span className="text-zinc-400 font-normal text-base">
              {unclassified.length} unclassified row{unclassified.length !== 1 ? "s" : ""}
            </span>
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            Inbound data waiting to be organized into typed objects.
          </p>
        </div>

        {/* Raw row cards */}
        {rows.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/20 p-8 text-center">
            <p className="text-sm text-zinc-500">No rows in raw_inbox yet.</p>
            <p className="text-xs text-zinc-600 mt-2">
              Data ingested via manual entry, spreadsheet import, or webhooks will appear here.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li
                key={row.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900 p-4"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded ${sourceBadgeClass(row.source)}`}
                  >
                    {row.source}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-600 shrink-0">
                    {new Date(row.received_at).toISOString().replace("T", " ").slice(0, 16)}
                  </span>
                </div>
                <pre className="text-xs font-mono text-zinc-300 bg-zinc-950 rounded p-3 overflow-x-auto leading-relaxed">
                  {JSON.stringify(row.payload, null, 2)}
                </pre>
                {row.classified_as && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[10px] text-emerald-500 font-mono">
                      classified as: {row.classified_as}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Organize CTA */}
        {rows.length > 0 && (
          <div className="pt-2">
            <Link
              href="/organize/run"
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-800 border border-zinc-700 px-5 py-3 text-sm font-medium text-zinc-200 hover:bg-zinc-700 hover:border-zinc-600 transition-colors"
            >
              <span className="text-zinc-500">⌗</span>
              Have the agent organize these
            </Link>
            <p className="mt-2 text-xs text-zinc-600">
              The agent will read the rows and narrate what it sees — types, field mappings, duplicates.
            </p>
          </div>
        )}

      </div>
    </main>
  );
}
