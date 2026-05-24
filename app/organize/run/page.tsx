// F4: /organize/run — streaming agent narration page (storyboard frame 4).
//
// Server component shell. Fetches raw_inbox rows, renders them as a summary,
// then mounts ClientNarrator which streams classification narrative from
// /api/organize/classify.

import Link from "next/link";
import { redirect } from "next/navigation";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import { raw_inbox } from "@/lib/db/schema";
import { ClientNarrator } from "./narrator-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function OrganizeRunPage(): Promise<React.ReactElement> {
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) {
    redirect("/signin");
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(raw_inbox)
    .orderBy(raw_inbox.received_at);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">

        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/organize" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
              ← raw inbox
            </Link>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
            Organizing{" "}
            <span className="text-zinc-500 font-normal">·</span>{" "}
            <span className="text-zinc-400 font-normal text-base">
              {rows.length} row{rows.length !== 1 ? "s" : ""}
            </span>
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            The agent is reading the raw inbox and building a classification proposal.
          </p>
        </div>

        {/* Row summary chips */}
        <div className="flex flex-wrap gap-2">
          {rows.map((row) => (
            <span
              key={row.id}
              className="text-[10px] font-mono bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 text-zinc-400"
            >
              {row.source}:{" "}
              {typeof row.payload === "object" && row.payload !== null
                ? Object.keys(row.payload as object)
                    .slice(0, 3)
                    .join(", ")
                : "…"}
            </span>
          ))}
        </div>

        {/* Streaming narration */}
        <ClientNarrator initialRows={rows} />

      </div>
    </main>
  );
}
