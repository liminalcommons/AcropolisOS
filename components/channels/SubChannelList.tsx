"use client";

// components/channels/SubChannelList.tsx
//
// The expandable sub-channel list inside a ChannelGroupCard — the topics / channels
// / threads under a Telegram chat or Discord guild. Matches the approved mockup:
// each row is "◦ name · type-tag · count + last-seen · pill|Bind/Ignore", and the
// list collapses past the first 2 rows behind a "+ N more" toggle.
//
// Client-only because of the expand toggle; it receives ALREADY-SERIALIZED rows
// (lastSeen is a pre-formatted string — no Date crosses the boundary) so the props
// are plain JSON. Writes go ONLY through BindingActions → the existing steward-gated
// /api/channels/bindings route. GOVERNED THEME TOKENS ONLY.

import { useState } from "react";
import type { BindingState } from "@/lib/channels/bindings";
import type { BindingStatus } from "@/lib/channels/status";
import { BindingStatusPill } from "@/components/channels/BindingStatusPill";
import { BindingActions, type TargetKey } from "@/components/channels/BindingActions";

type Platform = "telegram" | "discord";

/** A sub-channel row, fully serialized for the client boundary. */
export interface SubRow {
  subId: string;
  scope: string;
  title?: string;
  label?: string;
  status: BindingState;
  liveness: BindingStatus;
  messageCount: number;
  /** Pre-formatted relative time ("14m" / "1h" / "—"). */
  lastSeen: string;
}

const COLLAPSE_AT = 2;

function TypeTag({ scope }: { scope: string }): React.ReactElement {
  return (
    <span className="rounded-full bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
      {scope}
    </span>
  );
}

export function SubChannelList({
  platform,
  externalId,
  subs,
}: {
  platform: Platform;
  externalId: string;
  subs: SubRow[];
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const overflow = subs.length - COLLAPSE_AT;
  const shown = expanded ? subs : subs.slice(0, COLLAPSE_AT);

  return (
    <div className="space-y-1.5 border-t border-border px-4 py-2.5">
      {shown.map((s) => {
        const subKey: TargetKey = {
          platform,
          externalId,
          subId: s.subId,
          scope: s.scope,
          title: s.title,
        };
        const unbound = s.status !== "bound" && s.status !== "ignored";
        return (
          <div
            key={s.subId}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]"
          >
            <span className="text-muted-foreground">{s.scope === "thread" ? "⌗" : "◦"}</span>
            <span
              className={
                unbound ? "text-muted-foreground" : "font-medium text-foreground"
              }
            >
              {s.label ?? s.title ?? s.subId}
            </span>
            <TypeTag scope={s.scope} />
            <span className="ml-auto text-muted-foreground">
              {s.messageCount > 0 ? `${s.messageCount.toLocaleString()} msgs · ` : ""}
              {s.lastSeen}
            </span>
            {unbound ? (
              <BindingActions target={subKey} state={s.status} />
            ) : (
              <BindingStatusPill status={s.liveness} />
            )}
          </div>
        );
      })}

      {overflow > 0 && (
        <button
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "− show fewer" : `+ ${overflow} more`}
        </button>
      )}
    </div>
  );
}
