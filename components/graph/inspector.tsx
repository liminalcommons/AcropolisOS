"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { GraphNode, GraphAction } from "@/lib/graph/derive";
import type { NodeStatus } from "@/lib/graph/overlay";
import { POLICY_VAR, POLICY_LABEL, PROPOSED_COLOR } from "./legend";

export function Inspector({
  node,
  actions,
  onClose,
  status = "committed",
  isSteward = false,
  proposalIds = [],
  onReject,
}: {
  node: GraphNode;
  actions: GraphAction[];
  onClose: () => void;
  // GROWTH OVERLAY status of this node: proposed (brand-new dashed node) or
  // growing (committed type gaining proposed fields). Drives the steward
  // "Reject" affordance, shown only when the node maps to pending proposal(s).
  status?: NodeStatus;
  isSteward?: boolean;
  // The pending proposal id(s) that introduce this node. A single object type
  // may be carried by more than one pending proposal; rejecting discards them all.
  proposalIds?: string[];
  // Withdraws (DELETEs) the given pending proposal ids, then resolves once the
  // overlay should refresh. Provided by the graph; absent for committed nodes.
  onReject?: (ids: string[]) => Promise<void>;
}): React.ReactElement {
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canReject =
    isSteward &&
    status !== "committed" &&
    proposalIds.length > 0 &&
    typeof onReject === "function";

  async function handleReject() {
    if (!onReject) return;
    setRejecting(true);
    setError(null);
    try {
      await onReject(proposalIds);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed");
      setRejecting(false);
    }
  }

  return (
    <div className="w-64 rounded-lg border border-border bg-card p-3 text-sm shadow-lg">
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground">{node.label}</span>
        <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
        <div className="flex justify-between"><dt>Properties</dt><dd className="text-foreground">{node.propertyCount}</dd></div>
        <div className="flex justify-between"><dt>Read</dt><dd className="text-foreground">{node.readRoles.join(", ") || "—"}</dd></div>
        <div className="flex justify-between"><dt>Write</dt><dd className="text-foreground">{node.writeRoles.join(", ") || "—"}</dd></div>
      </dl>
      {canReject && (
        <div className="mt-3 border-t border-border pt-2">
          <p className="mb-1.5 text-[10px] uppercase tracking-wide" style={{ color: PROPOSED_COLOR }}>
            {status === "proposed" ? "proposed · awaiting review" : "growing · proposed fields"}
          </p>
          <button
            type="button"
            onClick={() => void handleReject()}
            disabled={rejecting}
            className="w-full rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          >
            {rejecting ? "Rejecting…" : "Reject (discard proposal)"}
          </button>
          {error && <p className="mt-1 text-[10px] text-destructive">{error}</p>}
        </div>
      )}
      {actions.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Actions on this object</p>
          <ul className="space-y-1.5">
            {actions.map((a) => (
              <li key={a.id} className="text-xs">
                <span className="inline-flex items-center gap-1.5 text-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: POLICY_VAR[a.policy] }} />
                  {a.label}
                </span>
                <span className="block pl-3.5 text-[10px] text-muted-foreground">
                  {POLICY_LABEL[a.policy]} · {a.permissions.join(", ") || "no roles"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
