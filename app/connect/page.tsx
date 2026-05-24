// F2-step1: /connect — "Connect a data pipe" storyboard frame 2.
//
// Auth-gated server component. Any authenticated member may access this page.
//
// Sections:
//   1. Violet "ask the agent" card — chat input linking to /dashboard/ask
//      with the user's message pre-filled as a query string.
//   2. OAuth chips row — 6 disabled stubs (n8n integration deferred to F2-step2).
//   3. Functional file-drop strip — CSV/JSON → raw_inbox via /api/connect/upload.

import Link from "next/link";
import { redirect } from "next/navigation";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { FileDropStrip } from "@/components/connect/FileDropStrip";
import { ConnectAskCard } from "@/components/connect/ConnectAskCard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── OAuth chip definitions ─────────────────────────────────────────────────

const OAUTH_CHIPS = [
  { glyph: "📊", label: "Google Sheets" },
  { glyph: "📝", label: "Notion" },
  { glyph: "📋", label: "Airtable" },
  { glyph: "📅", label: "Calendly" },
  { glyph: "💳", label: "Stripe" },
  { glyph: "✉", label: "Gmail" },
] as const;

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ConnectPage(): Promise<React.ReactElement> {
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) {
    redirect("/signin");
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <div className="mx-auto max-w-3xl px-6 py-10 space-y-10">

        {/* ── Header ── */}
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link
              href="/"
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              ← dashboard
            </Link>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
            Connect a data pipe
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            Tell the agent what to pull, or drop a file directly into the inbox.
          </p>
        </div>

        {/* ── Section 1: Violet ask-the-agent card ── */}
        <section>
          <ConnectAskCard />
        </section>

        {/* ── Section 2: OAuth chips ── */}
        <section className="space-y-3">
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">
            Or skip the chat — one-click for common sources
            <span className="normal-case tracking-normal text-zinc-600">
              {" "}(coming with n8n integration)
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {OAUTH_CHIPS.map(({ glyph, label }) => (
              <button
                key={label}
                disabled
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900/50 px-3 py-1 text-xs text-zinc-400 opacity-60 cursor-not-allowed"
                title={`${label} — coming with n8n integration`}
              >
                <span aria-hidden="true">{glyph}</span>
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* ── Section 3: File drop strip ── */}
        <section className="space-y-3">
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">
            Drop a file
          </p>
          <FileDropStrip />
          <p className="text-[11px] text-zinc-600">
            CSV or JSON. Each row lands in raw_inbox. View + organize at{" "}
            <Link href="/organize" className="text-zinc-500 hover:text-zinc-300 underline underline-offset-2">
              /organize
            </Link>.
          </p>
        </section>

      </div>
    </main>
  );
}
