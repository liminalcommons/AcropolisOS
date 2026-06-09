"use client";

// components/channels/BindingActions.tsx
//
// The thin client affordances on the steward's /channels surface:
//   • Bind / Ignore  — for a DISCOVERED · unbound target (Bind = the primary action).
//   • ⋯ menu         — Relabel / Toggle (on↔off) / Ignore for an already-BOUND target.
//
// Every button POSTs to the ALREADY-BUILT, steward-gated /api/channels/bindings
// route and then router.refresh()es the RSC page so the new liveness re-renders
// from the db. This component introduces NO new write path: it only calls the
// existing, tested API (which writes channel_bindings ONLY — never the ontology
// ctx, never auth, never the intake/security routes). It reads NOTHING; the server
// page hands it the keys.
//
// GOVERNED THEME TOKENS ONLY: the primary action uses the primary token; the rest
// are ghost/border buttons. No palette literal.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Platform = "telegram" | "discord";

/** The server-supplied identity of a single bind target. */
export interface TargetKey {
  platform: Platform;
  externalId: string;
  subId: string;
  scope: string;
  title?: string;
}

type Action = "bind" | "ignore" | "relabel" | "toggle";

async function post(
  action: Action,
  key: TargetKey,
  extra?: { label?: string; enabled?: boolean },
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
      enabled: extra?.enabled,
    }),
  });
  return res.ok;
}

const BTN =
  "rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-card disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_PRIMARY =
  "rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed";
const MENU_ITEM =
  "block w-full px-3 py-2 text-left text-xs text-foreground hover:bg-background disabled:opacity-50";

/** Bind / Ignore controls for a DISCOVERED · unbound target (Bind = primary). */
export function BindControls({ target }: { target: TargetKey }): React.ReactElement {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState(false);

  const run = (action: Action) =>
    start(async () => {
      setErr(false);
      const ok = await post(action, target);
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

/** Relabel / Toggle (on↔off) / Ignore menu for an already-BOUND target. */
export function BoundMenu({
  target,
  enabled = true,
}: {
  target: TargetKey;
  enabled?: boolean;
}): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(target.title ?? "");
  const [pending, start] = useTransition();

  const after = (ok: boolean) => {
    if (ok) {
      setEditing(false);
      setOpen(false);
      router.refresh();
    }
  };

  const relabel = () => start(async () => after(await post("relabel", target, { label })));
  const ignore = () => start(async () => after(await post("ignore", target)));
  const toggle = () =>
    start(async () => after(await post("toggle", target, { enabled: !enabled })));

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
        disabled={pending}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-36 overflow-hidden rounded-md border border-border bg-card shadow-lg">
          <button className={MENU_ITEM} onClick={() => setEditing(true)}>
            Relabel
          </button>
          <button className={MENU_ITEM} disabled={pending} onClick={toggle}>
            {enabled ? "Pause intake" : "Resume intake"}
          </button>
          <button
            className={`${MENU_ITEM} text-muted-foreground`}
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

/**
 * The single entry point the card uses: render the right affordance for a target
 * by its curation state. `unbound` → Bind/Ignore; otherwise the bound ⋯ menu.
 */
export function BindingActions({
  target,
  state,
  enabled = true,
}: {
  target: TargetKey;
  state: "discovered" | "bound" | "ignored";
  enabled?: boolean;
}): React.ReactElement {
  return state === "bound" ? (
    <BoundMenu target={target} enabled={enabled} />
  ) : (
    <BindControls target={target} />
  );
}
