// Manager dashboard — home route.
//
// The ontology editor (EmptyHome / SeededHome / LiveHome) has moved to
// /ontology-editor. This route is the designated landing surface for F5
// (Hostal Solana manager storyboard).
//
// Auth guard: middleware (lib/middleware/route-decision.ts) intercepts
// unauthenticated callers before the page renders — redirect here is
// unreachable. The buildChatRuntime() call below is the F5 template:
// child fetchers must accept runtime.ctx, NOT re-call buildChatRuntime() (perf).

import Link from "next/link";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Home(): Promise<React.ReactElement> {
  // Middleware enforces auth; buildChatRuntime() provides ctx for F5 child fetchers.
  // F5 child fetchers must accept runtime.ctx, NOT re-call buildChatRuntime() (perf).
  const chatRuntime = await buildChatRuntime();
  void isAnonymous(chatRuntime.actor); // type-guard kept for F5 — middleware already blocked anon

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex items-center justify-center">
      <div className="text-center space-y-4 px-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Manager dashboard — coming in F5
        </h1>
        <p className="text-sm text-zinc-400">
          Ontology editor moved to{" "}
          <Link
            href="/ontology-editor"
            className="text-violet-400 underline underline-offset-2 hover:text-violet-300"
          >
            /ontology-editor
          </Link>
        </p>
      </div>
    </main>
  );
}
