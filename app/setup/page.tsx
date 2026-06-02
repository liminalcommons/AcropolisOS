// F1 — First-run setup wizard.
//
// Server component. The MIDDLEWARE is the auth gate: on a first install
// (anonymous + setup incomplete) it routes the user HERE, and once a steward
// exists + setup completes it routes /setup -> /signin. SetupPage must NOT add
// its own anonymous -> /signin redirect — that would loop against the
// middleware and make the wizard unreachable on first run (redirect deadlock).
//
// Five step cards rendered in a vertical stack:
//   Step 1 — "Install confirmed"   : reads DATABASE_URL env var + runs SELECT 1.
//   Step 2 — "Create the steward"  : POST /api/setup/steward (first steward).
//   Step 3 — "Bring your LLM key"  : BYOK, validated + persisted to .env.
//   Step 4 — "What kind of org?"   : functional write to uploads/org-profile.json.
//   Step 5 — "Choose a scenario"   : installs the ontology + finalizes setup.
//
// Bottom: "You're in →" link to / — always visible, no progression gate.

import Link from "next/link";
import { readOrgProfile } from "@/lib/org-profile/store";
import { getDb } from "@/lib/db/client";
import { isSetupComplete } from "@/lib/setup/state";
import { getSetupFile } from "@/lib/setup/config";
import { listScenarioChoices } from "@/lib/setup/scenario-choices";
import { FileUserStore } from "@/lib/auth/users";
import { getUsersFile } from "@/lib/auth/config";
import { SetupStep } from "@/components/setup/SetupStep";
import { StewardForm } from "@/components/setup/SetupForms";
import { LLMKeyForm } from "@/components/setup/SetupForms";
import { OrgProfileForm } from "@/components/setup/SetupForms";
import { ScenarioPicker } from "@/components/setup/ScenarioPicker";

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

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function SetupPage(): Promise<React.ReactElement> {
  const [dbStatus, profile, scenarios, setupComplete, stewardCount] = await Promise.all([
    checkDatabase(),
    readOrgProfile(),
    listScenarioChoices(),
    isSetupComplete(getSetupFile()),
    new FileUserStore(getUsersFile()).countStewards().catch(() => 0),
  ]);
  const initialName = profile?.name ?? "";
  const initialDescription = profile?.description ?? "";
  const stewardExists = stewardCount > 0;

  return (
    <main className="min-h-screen bg-background text-foreground font-sans">
      <div className="mx-auto max-w-2xl px-6 py-12">

        {/* Eyebrow */}
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground text-center mb-8">
          Setup · 5 steps to a usable system
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
                <p className="mt-2 text-xs text-muted-foreground font-mono">
                  {dbStatus.detail}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  Set <code className="text-foreground">DATABASE_URL</code> in
                  your environment and restart the container.
                </p>
              </div>
            )}
          </SetupStep>

          {/* Step 2 — Create the first steward */}
          <SetupStep
            step={2}
            title="Create the first steward"
            status={stewardExists ? "ok" : "pending"}
            defaultExpanded={!stewardExists}
          >
            <StewardForm alreadyExists={stewardExists} />
          </SetupStep>

          {/* Step 3 — BYOK LLM key (validated + persisted) */}
          <SetupStep
            step={3}
            title="Bring your own LLM key"
            status="pending"
            defaultExpanded={true}
          >
            <LLMKeyForm />
          </SetupStep>

          {/* Step 4 — Org description (functional) */}
          <SetupStep
            step={4}
            title="What kind of org is this?"
            status="pending"
            defaultExpanded={true}
          >
            <OrgProfileForm
              initialName={initialName}
              initialDescription={initialDescription}
            />
          </SetupStep>

          {/* Step 5 — Choose a starting scenario (discovery-driven) */}
          <SetupStep
            step={5}
            title="Choose a starting scenario"
            status={setupComplete ? "ok" : "pending"}
            defaultExpanded={!setupComplete}
          >
            <ScenarioPicker choices={scenarios} alreadyComplete={setupComplete} />
          </SetupStep>

        </div>

        {/* "You're in" CTA — always visible, no gate */}
        <div className="mt-10 flex justify-end">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-md bg-emerald-700 hover:bg-emerald-600 text-foreground font-semibold text-sm px-6 py-2.5 transition-colors"
          >
            You&apos;re in
            <span aria-hidden>→</span>
          </Link>
        </div>

        {/* Footnote */}
        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          You can revisit this page any time at{" "}
          <span className="font-mono text-muted-foreground">/setup</span>.
        </p>

      </div>
    </main>
  );
}
