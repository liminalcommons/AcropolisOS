// app/channels/page.tsx — Phase C: the steward's /channels management surface.
//
// READ-ONLY composition over the already-built channel building blocks:
//   discoverChannels(db)            — what raw_inbox has actually seen (read-only),
//   listBindings(db)                — the steward's curation ledger,
//   mergeDiscoveryWithBindings(...) — fold them + an HONEST liveness together,
//   groupChannelsByPlatform(...)    — nest into per-platform group→sub trees,
//   <PlatformSection> / <ChannelGroupCard> / <BindingStatusPill> / <BindingActions>
//                                    — the governed-token view components (Task C3).
//
// Telegram and Discord are SYMMETRIC: two equal <PlatformSection>s, same card design,
// same status vocabulary. Liveness is honest — a count + last-seen, never a fake green
// light. The only writes happen client-side through the existing steward-gated
// /api/channels/bindings route (Bind / Ignore / Relabel / Toggle); this page touches
// NO intake/security path, NO ontology ctx, NO auth beyond the steward gate.
//
// FENCE: steward-gated exactly like the API route — anon → /signin, non-steward →
// an inert "stewards only" panel. Governed theme tokens ONLY.

import Link from "next/link";
import { redirect } from "next/navigation";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import { discoverChannels } from "@/lib/channels/discovery";
import { listBindings, mergeDiscoveryWithBindings } from "@/lib/channels/bindings";
import { groupChannelsByPlatform } from "@/lib/channels/view";
import type { BindingStatus } from "@/lib/channels/status";
import { BindingStatusPill } from "@/components/channels/BindingStatusPill";
import { PlatformSection } from "@/components/channels/PlatformSection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The SAME env flags the webhook routes 503 on (read here, not in the env-free libs).
function configuredFlags(): { telegram: boolean; discord: boolean } {
  return {
    telegram: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
    discord: Boolean(process.env.DISCORD_PUBLIC_KEY),
  };
}

// ── status legend (the honest vocabulary, governed tokens via the shared pill) ────

function Legend(): React.ReactElement {
  const order: BindingStatus[] = ["receiving", "idle", "awaiting", "unbound", "offline"];
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          status
        </span>
        {order.map((s) => (
          <BindingStatusPill key={s} status={s} />
        ))}
      </div>
    </section>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────────

export default async function ChannelsPage(): Promise<React.ReactElement> {
  const rt = await buildChatRuntime();
  if (isAnonymous(rt.actor)) {
    redirect("/signin");
  }
  const actor = rt.actor!;
  if (actor.role !== "steward") {
    return (
      <main className="min-h-full">
        <div className="mx-auto max-w-5xl px-6 py-16 text-center">
          <h1 className="text-xl font-semibold text-foreground">Channels</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Channel binding is a steward-only surface. Ask a steward to connect
            Telegram or Discord groups to this org.
          </p>
        </div>
      </main>
    );
  }

  const configured = configuredFlags();
  const now = Date.now();
  const db = getDb();
  const [discovery, bindings] = await Promise.all([
    discoverChannels(db),
    listBindings(db),
  ]);
  const items = mergeDiscoveryWithBindings(discovery, bindings, { configured, now });
  const grouped = groupChannelsByPlatform(items);

  return (
    <main className="min-h-full font-sans">
      <div className="mx-auto max-w-5xl space-y-8 px-6 py-10">
        <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
          ← board
        </Link>

        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Channels
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Telegram groups and Discord servers connected to this org. Bind the
              ones whose messages should flow in — leave the rest out. Liveness is
              honest: a count and last-seen, never a fake green light.
            </p>
          </div>
        </header>

        <Legend />

        <PlatformSection
          platform="telegram"
          groups={grouped.telegram}
          configured={configured.telegram}
          now={now}
        />
        <PlatformSection
          platform="discord"
          groups={grouped.discord}
          configured={configured.discord}
          now={now}
        />

        <p className="border-t border-border pt-4 text-xs text-muted-foreground">
          /channels curates which discovered targets are allow-listed into the org.
          Binding only adds a target to <span className="font-mono">channel_bindings</span>;
          it never alters the intake or security pipeline. Steward-only.
        </p>
      </div>
    </main>
  );
}
