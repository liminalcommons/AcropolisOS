"use client";

import { X } from "lucide-react";
import type { GraphNode, GraphAction } from "@/lib/graph/derive";
import { POLICY_VAR, POLICY_LABEL } from "./legend";

export function Inspector({
  node,
  actions,
  onClose,
}: {
  node: GraphNode;
  actions: GraphAction[];
  onClose: () => void;
}): React.ReactElement {
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
