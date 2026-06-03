"use client";

// components/channels/ChannelActions.tsx
//
// The thin client affordances on the steward's /channels management surface:
// Bind / Ignore (for a discovered-but-unbound target) and a "⋯" menu carrying
// Relabel + Ignore for an already-bound target. Each button POSTs to the
// ALREADY-BUILT, steward-gated /api/channels/bindings route and then
// router.refresh()es the RSC page so the new liveness re-renders from the db.
//
// This component introduces NO new write path: it only calls the existing,
// tested API (which writes channel_bindings ONLY — never the ontology ctx,
// never auth, never the intake/security routes). It reads NOTHING; the server
// page hands it the keys.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Platform = "telegram" | "discord";

interface TargetKey {
  platform: Platform;
  externalId: string;
  subId: string;
  scope: string;
  title?: string;
}

type Action = "bind" | "ignore" | "relabel";

async function post(
  action: Action,
  key: TargetKey,
  extra?: { label?: string },
): Promise<boolean> {
  const res = await fetch("/api/channels/bindings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action,
      platform: key.platform,
      external_id: key.externalId,
      sub_id: key.subId,
      scope: key.scope,
      title: key.title,
      label: extra?.label,
    }),
  });
  return res.ok;
}

const BTN =
  "rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-card disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_PRIMARY =
  "rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed";

/** Bind / Ignore controls for a DISCOVERED · unbound target. */
export function BindControls(props: { target: TargetKey }): React.ReactElement {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState(false);

  const run = (action: Action) =>
    start(async () => {
      setErr(false);
      const ok = await post(action, props.target);
      if (ok) router.refresh();
      else setErr(true);
    });

  return (
    <div className="flex items-center gap-2">
      {err && <span className="text-xs text-destructive">failed</span>}
      <button className={BTN_PRIMARY} disabled={pending} onClick={() => run("bind")}>
        Bind
      </button>
      <button className={BTN} disabled={pending} onClick={() => run("ignore")}>
        Ignore
      </button>
    </div>
  );
}

/** Relabel + Ignore menu for an already-BOUND target. */
export function BoundMenu(props: { target: TargetKey }): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(props.target.title ?? "");
  const [pending, start] = useTransition();

  const relabel = () =>
    start(async () => {
      const ok = await post("relabel", props.target, { label });
      if (ok) {
        setEditing(false);
        setOpen(false);
        router.refresh();
      }
    });

  const ignore = () =>
    start(async () => {
      const ok = await post("ignore", props.target);
      if (ok) {
        setOpen(false);
        router.refresh();
      }
    });

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="label"
          className="w-32 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button className={BTN_PRIMARY} disabled={pending} onClick={relabel}>
          Save
        </button>
        <button className={BTN} disabled={pending} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        className={BTN}
        aria-label="More actions"
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-36 overflow-hidden rounded-md border border-border bg-card shadow-lg">
          <button
            className="block w-full px-3 py-2 text-left text-xs text-foreground hover:bg-background"
            onClick={() => setEditing(true)}
          >
            Relabel
          </button>
          <button
            className="block w-full px-3 py-2 text-left text-xs text-muted-foreground hover:bg-background"
            disabled={pending}
            onClick={ignore}
          >
            Ignore
          </button>
        </div>
      )}
    </div>
  );
}
