// Manager dashboard — home route.
//
// The ontology editor (EmptyHome / SeededHome / LiveHome) has moved to
// /ontology-editor. This route is the designated landing surface for F5
// (Hostal Solana manager storyboard).
//
// Auth guard: same pattern as /me (M4.3). Anonymous callers redirect to
// /signin with a callbackUrl so they land back here after sign-in.

import Link from "next/link";
import { redirect } from "next/navigation";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Home(): Promise<React.ReactElement> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) {
    redirect("/signin?callbackUrl=/");
  }

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
