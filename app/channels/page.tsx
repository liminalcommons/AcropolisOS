// app/channels/page.tsx — Phase C: the steward's /channels management surface.
//
// READ-ONLY composition over the already-built channel building blocks:
//   discoverChannels(db)            — what raw_inbox has actually seen (read-only),
//   listBindings(db)                — the steward's curation ledger,
//   mergeDiscoveryWithBindings(...) — fold them + an HONEST liveness together,
//   groupChannelsByPlatform(...)    — nest into per-platform group→sub trees,
//   livenessPill(...)               — governed-token status chips.
//
// Telegram and Discord are SYMMETRIC: two equal sections, same card design, same
// status vocabulary. Liveness is honest — a count + last-seen, never a fake green
// light. The only writes happen client-side through the existing steward-gated
// /api/channels/bindings route (Bind / Ignore / Relabel); this page touches NO
// intake/security path, NO ontology ctx, NO auth beyond the steward gate.
//
// FENCE: steward-gated exactly like the API route — anon → /signin, non-steward →
// an inert "stewards only" panel. Governed theme tokens ONLY.

import Link from "next/link";
import { redirect } from "next/navigation";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import { discoverChannels } from "@/lib/channels/discovery";
import { listBindings, mergeDiscoveryWithBindings } from "@/lib/channels/bindings";
import {
  groupChannelsByPlatform,
  livenessPill,
  type ChannelGroupView,
  type ChannelSubView,
} from "@/lib/channels/view";
import { BindControls, BoundMenu } from "@/components/channels/ChannelActions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Platform = "telegram" | "discord";

// The SAME env flags the webhook routes 503 on (read here, not in the env-free libs).
function configuredFlags(): { telegram: boolean; discord: boolean } {
  return {
    telegram: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
    discord: Boolean(process.env.DISCORD_PUBLIC_KEY),
  };
}

function relTime(d: Date | null, now: number): string {
  if (!d) return "—";
  const ms = now - d.getTime();
  if (ms < 0) return "now";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  return `${days}d`;
}

// ── small presentational atoms (governed tokens only) ───────────────────────────

function Pill({ status }: { status: ChannelSubView["liveness"] }): React.ReactElement {
  const p = livenessPill(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.pillClass}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${p.dotClass}`} />
      {p.label}
    </span>
  );
}

function Dot({ status }: { status: ChannelSubView["liveness"] }): React.ReactElement {
  const p = livenessPill(status);
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${p.dotClass}`} />;
}

function TypeTag({ scope }: { scope: string }): React.ReactElement {
  return (
    <span className="rounded-full bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
      {scope}
    </span>
  );
}

// ── group card (one Telegram chat / Discord guild + its sub-channels) ─────────────

function GroupCard({
  group,
  now,
}: {
  group: ChannelGroupView;
  now: number;
}): React.ReactElement {
  const groupKey = {
    platform: group.platform,
    externalId: group.externalId,
    subId: "",
    scope: "group",
    title: group.title,
  };
  const unbound = group.status !== "bound" && group.status !== "ignored";

  return (
    <div
      className={
        unbound
          ? "rounded-xl border border-dashed border-border bg-card/40 p-4"
          : "rounded-xl border border-border bg-card p-4"
      }
    >
      <div className="flex items-start gap-3">
        <Dot status={group.liveness} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-foreground">
              {group.label ?? group.title ?? group.externalId}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {group.subChannels.length > 0
                ? `${group.boundCount} bound · ${group.discoveredCount} discovered`
                : group.externalId}
            </span>
            <span className="ml-auto">
              <Pill status={group.liveness} />
            </span>
          </div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            {group.messageCount.toLocaleString()} messages pipelined ·{" "}
            {relTime(group.lastReceivedAt, now)}
          </div>
        </div>
        <div className="shrink-0">
          {unbound ? <BindControls target={groupKey} /> : <BoundMenu target={groupKey} />}
        </div>
      </div>

      {group.subChannels.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-border pt-2.5">
          {group.subChannels.map((s) => {
            const subKey = {
              platform: group.platform,
              externalId: group.externalId,
              subId: s.subId,
              scope: s.scope,
              title: s.title,
            };
            const subUnbound = s.status !== "bound" && s.status !== "ignored";
            return (
              <div
                key={s.subId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]"
              >
                <span className="text-muted-foreground">◦</span>
                <span className={subUnbound ? "text-muted-foreground" : "font-medium text-foreground"}>
                  {s.label ?? s.title ?? s.subId}
                </span>
                <TypeTag scope={s.scope} />
                <span className="ml-auto text-muted-foreground">
                  {s.messageCount > 0 ? `${s.messageCount.toLocaleString()} msgs · ` : ""}
                  {relTime(s.lastReceivedAt, now)}
                </span>
                {subUnbound ? <BindControls target={subKey} /> : <Pill status={s.liveness} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── platform section (Telegram + Discord are SYMMETRIC) ──────────────────────────

const PLATFORM_META: Record<
  Platform,
  { label: string; blurb: string; icon: React.ReactElement }
> = {
  telegram: {
    label: "Telegram",
    blurb: "groups & supergroup topics",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" className="fill-primary" aria-hidden>
        <path d="M21.9 4.3 18.6 20c-.25 1.1-.9 1.37-1.83.85l-5.05-3.72-2.44 2.35c-.27.27-.5.5-1 .5l.36-5.14L17 6.36c.4-.36-.09-.56-.62-.2L6.2 12.7l-4.97-1.56c-1.08-.34-1.1-1.08.23-1.6L20.5 2.6c.9-.33 1.69.2 1.4 1.7z" />
      </svg>
    ),
  },
  discord: {
    label: "Discord",
    blurb: "servers, channels & threads",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" className="fill-primary" aria-hidden>
        <path d="M19.3 5.3A17 17 0 0 0 15 4l-.2.4a15.7 15.7 0 0 1 3.7 1.2 13 13 0 0 0-11 0A15.7 15.7 0 0 1 11.2 4.4L11 4a17 17 0 0 0-4.3 1.3C4 9.3 3.3 13.1 3.6 16.9A17 17 0 0 0 8.8 19.5l.4-.6c-.7-.26-1.4-.58-2-.96l.5-.36a12 12 0 0 0 10.6 0l.5.36c-.65.38-1.32.7-2 .96l.4.6a17 17 0 0 0 5.2-2.6c.4-4.4-.66-8.18-2.6-11.6zM9.5 14.7c-1 0-1.85-.94-1.85-2.1S8.48 10.5 9.5 10.5s1.87.95 1.85 2.1c0 1.16-.83 2.1-1.85 2.1zm5 0c-1 0-1.85-.94-1.85-2.1s.83-2.1 1.85-2.1 1.87.95 1.85 2.1c0 1.16-.83 2.1-1.85 2.1z" />
      </svg>
    ),
  },
};

function PlatformSection({
  platform,
  groups,
  configured,
  now,
}: {
  platform: Platform;
  groups: ChannelGroupView[];
  configured: boolean;
  now: number;
}): React.ReactElement {
  const meta = PLATFORM_META[platform];
  const boundGroups = groups.filter((g) => g.status === "bound").length;
  const discoveredGroups = groups.filter((g) => g.status === "discovered").length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {meta.icon}
        <h2 className="text-lg font-semibold text-foreground">{meta.label}</h2>
        {configured ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" /> configured
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" /> awaiting token
          </span>
        )}
        <span className="ml-1 text-xs text-muted-foreground">
          {meta.blurb} · {boundGroups} bound · {discoveredGroups} discovered
        </span>
      </div>

      {!configured && (
        <div className="rounded-xl border border-border bg-warning/[0.06] p-4">
          <div className="flex items-start gap-3">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-warning" />
            <div className="text-sm">
              <div className="font-semibold text-warning">
                {meta.label} — awaiting configuration
              </div>
              <p className="mt-1 text-[13px] text-muted-foreground">
                The {platform === "telegram" ? "webhook secret" : "bot token"} for{" "}
                {meta.label} is not set. Add it to{" "}
                <span className="font-mono">.env</span> (gitignored) to begin
                pipelining messages. Discovered targets below stay inert until then.
              </p>
            </div>
          </div>
        </div>
      )}

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/30 p-4 text-sm text-muted-foreground">
          Nothing discovered yet. Once the {meta.label} bot is added to a{" "}
          {platform === "telegram" ? "group" : "server"} and a message arrives, it
          appears here for you to bind.
        </p>
      ) : (
        groups.map((g) => <GroupCard key={g.externalId} group={g} now={now} />)
      )}
    </section>
  );
}

// ── status legend (the honest vocabulary, governed tokens) ───────────────────────

function Legend(): React.ReactElement {
  const order: ChannelSubView["liveness"][] = [
    "receiving",
    "idle",
    "awaiting",
    "unbound",
    "offline",
  ];
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          status
        </span>
        {order.map((s) => (
          <Pill key={s} status={s} />
        ))}
      </div>
    </section>
  );
}

// ── page ────────────────────────────────────────────────────────────────────────

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
