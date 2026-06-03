// components/channels/ChannelGroupCard.tsx
//
// One group card on the steward /channels surface — a Telegram chat or a Discord
// guild — with its expandable sub-channels (topics / channels / threads). Matches
// the approved mockup card layout
// (.chora/artifacts/2026-06-02-acropolisos-channels-ui-mockup.html):
//   • left rail liveness dot + name + @handle/summary + a status pill,
//   • a "N messages pipelined · last-seen" line,
//   • Bind/Ignore (unbound) or the ⋯ menu (bound) on the right,
//   • a sub-channel list, each row: ◦ name · type tag · count + last-seen · its own
//     pill (bound) or Bind/Ignore (unbound), with a "+ N more" collapse past 2 rows.
//
// PURE presentation over the ChannelGroupView the page builds (lib/channels/view.ts):
// no db, no env, no ontology ctx, no auth. Liveness is honest — a count + last-seen,
// never a fake green light. GOVERNED THEME TOKENS ONLY (no palette literal). The
// only client state is the sub-channel expand toggle (SubChannelList).

import type { ChannelGroupView, ChannelSubView } from "@/lib/channels/view";
import { BindingStatusPill, LivenessDot } from "@/components/channels/BindingStatusPill";
import { BindingActions, type TargetKey } from "@/components/channels/BindingActions";
import { SubChannelList } from "@/components/channels/SubChannelList";

/** Honest, dependency-free relative time ("now" / "14m" / "3h" / "2d" / "—"). */
export function relTime(d: Date | null, now: number): string {
  if (!d) return "—";
  const ms = now - d.getTime();
  if (ms < 60000) return "now";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const isUnbound = (status: ChannelSubView["status"]) =>
  status !== "bound" && status !== "ignored";

export function ChannelGroupCard({
  group,
  now,
}: {
  group: ChannelGroupView;
  now: number;
}): React.ReactElement {
  const groupKey: TargetKey = {
    platform: group.platform,
    externalId: group.externalId,
    subId: "",
    scope: "group",
    title: group.title,
  };
  const unbound = isUnbound(group.status);

  return (
    <div
      className={
        unbound
          ? "rounded-xl border border-dashed border-border bg-card/40"
          : "rounded-xl border border-border bg-card"
      }
    >
      <div className="flex items-start gap-3 p-4">
        <LivenessDot status={group.liveness} />
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
              <BindingStatusPill status={group.liveness} />
            </span>
          </div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            {group.messageCount.toLocaleString()} messages pipelined ·{" "}
            {relTime(group.lastReceivedAt, now)}
          </div>
        </div>
        <div className="shrink-0">
          <BindingActions
            target={groupKey}
            state={group.status}
          />
        </div>
      </div>

      {group.subChannels.length > 0 && (
        <SubChannelList
          platform={group.platform}
          externalId={group.externalId}
          subs={group.subChannels.map((s) => ({
            subId: s.subId,
            scope: s.scope,
            title: s.title,
            label: s.label,
            status: s.status,
            liveness: s.liveness,
            messageCount: s.messageCount,
            lastSeen: relTime(s.lastReceivedAt, now),
          }))}
        />
      )}
    </div>
  );
}
