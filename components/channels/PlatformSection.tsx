// components/channels/PlatformSection.tsx
//
// One platform's section on the steward /channels surface. Telegram and Discord are
// SYMMETRIC — both render through this single component, so the two sections are
// identical in layout, status vocabulary, and card design (only the icon, name, and
// noun differ). Matches the approved mockup
// (.chora/artifacts/2026-06-02-acropolisos-channels-ui-mockup.html):
//   • a header: platform icon + name + a "configured / awaiting token" badge +
//     a "blurb · N bound · N discovered" summary,
//   • an awaiting-token banner when the platform is not yet wired up,
//   • the discovered groups as ChannelGroupCards (or an empty-state line).
//
// PURE presentation over the ChannelGroupView[] the page builds: no db, no env, no
// ontology ctx, no auth. The `configured` flag is computed by the page from the SAME
// env the webhook routes gate on. GOVERNED THEME TOKENS ONLY (no palette literal).

import type { ChannelGroupView } from "@/lib/channels/view";
import { ChannelGroupCard } from "@/components/channels/ChannelGroupCard";

type Platform = "telegram" | "discord";

const PLATFORM_META: Record<
  Platform,
  { label: string; blurb: string; noun: string; secret: string; icon: React.ReactElement }
> = {
  telegram: {
    label: "Telegram",
    blurb: "groups & supergroup topics",
    noun: "group",
    secret: "webhook secret",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" className="fill-primary" aria-hidden>
        <path d="M21.9 4.3 18.6 20c-.25 1.1-.9 1.37-1.83.85l-5.05-3.72-2.44 2.35c-.27.27-.5.5-1 .5l.36-5.14L17 6.36c.4-.36-.09-.56-.62-.2L6.2 12.7l-4.97-1.56c-1.08-.34-1.1-1.08.23-1.6L20.5 2.6c.9-.33 1.69.2 1.4 1.7z" />
      </svg>
    ),
  },
  discord: {
    label: "Discord",
    blurb: "servers, channels & threads",
    noun: "server",
    secret: "bot token",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" className="fill-primary" aria-hidden>
        <path d="M19.3 5.3A17 17 0 0 0 15 4l-.2.4a15.7 15.7 0 0 1 3.7 1.2 13 13 0 0 0-11 0A15.7 15.7 0 0 1 11.2 4.4L11 4a17 17 0 0 0-4.3 1.3C4 9.3 3.3 13.1 3.6 16.9A17 17 0 0 0 8.8 19.5l.4-.6c-.7-.26-1.4-.58-2-.96l.5-.36a12 12 0 0 0 10.6 0l.5.36c-.65.38-1.32.7-2 .96l.4.6a17 17 0 0 0 5.2-2.6c.4-4.4-.66-8.18-2.6-11.6zM9.5 14.7c-1 0-1.85-.94-1.85-2.1S8.48 10.5 9.5 10.5s1.87.95 1.85 2.1c0 1.16-.83 2.1-1.85 2.1zm5 0c-1 0-1.85-.94-1.85-2.1s.83-2.1 1.85-2.1 1.87.95 1.85 2.1c0 1.16-.83 2.1-1.85 2.1z" />
      </svg>
    ),
  },
};

function ConfiguredBadge({ configured }: { configured: boolean }): React.ReactElement {
  return configured ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
      <span className="h-1.5 w-1.5 rounded-full bg-success" /> configured
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">
      <span className="h-1.5 w-1.5 rounded-full bg-warning" /> awaiting token
    </span>
  );
}

export function PlatformSection({
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
        <ConfiguredBadge configured={configured} />
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
                The {meta.secret} for {meta.label} is not set. Add it to{" "}
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
          {meta.noun} and a message arrives, it appears here for you to bind.
        </p>
      ) : (
        groups.map((g) => <ChannelGroupCard key={g.externalId} group={g} now={now} />)
      )}
    </section>
  );
}
