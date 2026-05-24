// F1 — First-run setup wizard.
//
// Server component. Auth-gated (any authenticated user — steward-to-be runs
// this on first install). Anonymous callers are redirected to /signin.
//
// Three step cards rendered in a vertical stack:
//   Step 1 — "System ready"     : reads DATABASE_URL env var + runs SELECT 1.
//   Step 2 — "Bring your LLM key" : BYOK textarea. Save is STUBBED this cycle.
//   Step 3 — "What kind of org?" : functional write to uploads/org-profile.json.
//
// Bottom: "You're in →" link to / — always visible, no progression gate.

import Link from "next/link";
import { redirect } from "next/navigation";
import path from "node:path";
import fs from "node:fs/promises";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import { SetupStep } from "@/components/setup/SetupStep";
import { LLMKeyForm } from "@/components/setup/SetupForms";
import { OrgProfileForm } from "@/components/setup/SetupForms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function checkDatabase(): Promise<{ ok: boolean; detail: string }> {
  if (!process.env.DATABASE_URL) {
    return { ok: false, detail: "DATABASE_URL is not set" };
  }
  try {
    const db = getDb();
    // Lightweight connectivity probe — SELECT 1 returns immediately.
    await db.execute("SELECT 1" as unknown as Parameters<typeof db.execute>[0]);
    return { ok: true, detail: "Connected" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: `DB error: ${msg}` };
  }
}

async function readOrgProfile(): Promise<string> {
  const filePath = path.join(process.cwd(), "uploads", "org-profile.json");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { description?: string };
    return parsed.description ?? "";
  } catch {
    return "";
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function SetupPage(): Promise<React.ReactElement> {
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) {
    redirect("/signin");
  }

  const [dbStatus, initialDescription] = await Promise.all([
    checkDatabase(),
    readOrgProfile(),
  ]);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <div className="mx-auto max-w-2xl px-6 py-12">

        {/* Eyebrow */}
        <p className="text-[10px] uppercase tracking-widest text-zinc-600 text-center mb-8">
          Setup · 3 steps to a usable system
        </p>

        {/* Step cards */}
        <div className="space-y-3">

          {/* Step 1 — System ready */}
          <SetupStep
            step={1}
            title="Install confirmed"
            status={dbStatus.ok ? "ok" : "fail"}
            defaultExpanded={!dbStatus.ok}
          >
            {dbStatus.ok ? (
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 text-sm">✓</span>
                <p className="text-sm text-emerald-400 font-medium">
                  {dbStatus.detail}
                </p>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-rose-400 text-sm">✗</span>
                  <p className="text-sm text-rose-400 font-medium">
                    Database unreachable
                  </p>
                </div>
                <p className="mt-2 text-xs text-zinc-500 font-mono">
                  {dbStatus.detail}
                </p>
                <p className="mt-3 text-xs text-zinc-600">
                  Set <code className="text-zinc-400">DATABASE_URL</code> in
                  your environment and restart the container.
                </p>
              </div>
            )}
          </SetupStep>

          {/* Step 2 — BYOK LLM key (stubbed) */}
          <SetupStep
            step={2}
            title="Bring your own LLM key"
            status="pending"
            defaultExpanded={true}
          >
            <LLMKeyForm />
          </SetupStep>

          {/* Step 3 — Org description (functional) */}
          <SetupStep
            step={3}
            title="What kind of org is this?"
            status="pending"
            defaultExpanded={true}
          >
            <OrgProfileForm initialDescription={initialDescription} />
          </SetupStep>

        </div>

        {/* "You're in" CTA — always visible, no gate */}
        <div className="mt-10 flex justify-end">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-md bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-sm px-6 py-2.5 transition-colors"
          >
            You&apos;re in
            <span aria-hidden>→</span>
          </Link>
        </div>

        {/* Footnote */}
        <p className="mt-6 text-center text-[11px] text-zinc-700">
          You can revisit this page any time at{" "}
          <span className="font-mono text-zinc-600">/setup</span>.
        </p>

      </div>
    </main>
  );
}
