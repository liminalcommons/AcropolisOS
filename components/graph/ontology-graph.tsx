// Client React Flow renderer for the LIVING ontology graph. Object types are
// nodes (positioned by the pure dagre pass), link types are solid edges, and
// action types render as small policy-colored chips inside the object they
// primarily touch.
//
// GROWTH OVERLAY: the graph polls GET /api/proposals and overlays PENDING
// proposals on top of the committed ontology — brand-new types appear as
// dashed-amber "proposed · escalates" nodes, existing types gaining fields get
// an amber ring + a "+N proposed" badge, and new links draw as animated
// dashed-amber edges. When a proposal leaves the pending set (steward approved
// or rejected), the committed model is refreshed so the node "solidifies".
// Clicking a node opens the inspector. Read-only.
"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { GraphModel, GraphAction } from "@/lib/graph/derive";
import type { ProposalDiff } from "@/lib/proposals/diff";
import { buildOverlay, type NodeStatus } from "@/lib/graph/overlay";
import { layoutGraph } from "@/lib/graph/layout";
import { POLICY_VAR, PROPOSED_COLOR, PROPOSED_TINT, KIND_COLOR, Legend } from "./legend";
import { Inspector } from "./inspector";

interface ObjectNodeData extends Record<string, unknown> {
  label: string;
  propertyCount: number;
  actions: GraphAction[];
  status: NodeStatus;
  growingFields: string[];
  kind: string | null;
}

// v12 idiomatic pattern: name the full Node specialisation, then pass to NodeProps
type ObjectNodeType = Node<ObjectNodeData, "object">;

function ObjectNode({ data }: NodeProps<ObjectNodeType>): React.ReactElement {
  const proposed = data.status === "proposed";
  const growing = data.status === "growing";
  return (
    <div
      className={`w-52 rounded-md px-3 py-2 shadow-sm ${proposed ? "animate-pulse" : ""}`}
      style={{
        borderWidth: proposed ? 2 : 1,
        borderStyle: proposed ? "dashed" : "solid",
        borderColor: proposed ? PROPOSED_COLOR : "var(--border)",
        backgroundColor: proposed ? PROPOSED_TINT : "var(--card)",
        boxShadow: growing ? `0 0 0 2px ${PROPOSED_TINT.replace("0.12", "0.5")}` : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-sm font-medium text-foreground" title={data.label}>
          {data.label}
        </div>
        {data.kind && KIND_COLOR[data.kind] && (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-background"
            style={{ backgroundColor: KIND_COLOR[data.kind] }}
            title={`element kind: ${data.kind}`}
          >
            {data.kind}
          </span>
        )}
      </div>
      <div className="text-[10px] text-muted-foreground">
        {data.propertyCount} {data.propertyCount === 1 ? "property" : "properties"}
        {proposed && (
          <span className="ml-1 font-semibold" style={{ color: PROPOSED_COLOR }}>
            · proposed · escalates
          </span>
        )}
      </div>
      {growing && data.growingFields.length > 0 && (
        <div className="mt-1 text-[10px] font-medium" style={{ color: PROPOSED_COLOR }}>
          +{data.growingFields.length} proposed: {data.growingFields.join(", ")}
        </div>
      )}
      {data.actions.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {data.actions.map((a) => (
            <div
              key={a.id}
              title={`${a.id} — ${a.policy} (${a.permissions.join(", ") || "no roles"})`}
              className="flex items-center gap-1.5 rounded px-1.5 py-0.5"
              style={{ backgroundColor: POLICY_VAR[a.policy] }}
            >
              <span className="truncate text-[10px] font-medium text-background">{a.label}</span>
            </div>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
}

const nodeTypes = { object: ObjectNode };

export function OntologyGraph({ model }: { model: GraphModel }): React.ReactElement {
  const [selected, setSelected] = useState<string | null>(null);
  const [proposals, setProposals] = useState<{ id: string; diff: ProposalDiff }[]>([]);
  const router = useRouter();
  const prevIds = useRef<Set<string>>(new Set());

  // Live overlay: poll pending proposals. When a previously-pending proposal
  // disappears (approved/rejected), the committed ontology may have grown — so
  // refresh the server component's `model` to "solidify" the new node.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/proposals", { cache: "no-store" });
        if (!res.ok) return; // 401 (anonymous) etc. -> committed-only
        const data = (await res.json()) as { proposals?: { id: string; diff: ProposalDiff }[] };
        if (!alive || !Array.isArray(data.proposals)) return;
        const ids = new Set(data.proposals.map((p) => p.id));
        let shrank = false;
        for (const id of prevIds.current) if (!ids.has(id)) shrank = true;
        prevIds.current = ids;
        setProposals(data.proposals.map((p) => ({ id: p.id, diff: p.diff })));
        if (shrank) router.refresh();
      } catch {
        // transient — keep the last good overlay
      }
    };
    void poll();
    const t = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [router]);

  const overlay = useMemo(
    () => buildOverlay(model, proposals.map((p) => p.diff)),
    [model, proposals],
  );

  const { nodes, edges } = useMemo(() => {
    const positions = new Map(layoutGraph(overlay.model).map((p) => [p.id, p]));
    const actionsByTarget = new Map<string, GraphAction[]>();
    for (const a of overlay.model.actions) {
      if (!a.primaryTarget) continue;
      const list = actionsByTarget.get(a.primaryTarget) ?? [];
      list.push(a);
      actionsByTarget.set(a.primaryTarget, list);
    }
    const nodes: ObjectNodeType[] = overlay.model.nodes.map((n) => ({
      id: n.id,
      type: "object" as const,
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      data: {
        label: n.label,
        propertyCount: n.propertyCount,
        actions: actionsByTarget.get(n.id) ?? [],
        status: overlay.nodeStatus[n.id] ?? "committed",
        growingFields: overlay.growingFields[n.id] ?? [],
        kind: n.kind,
      },
    }));
    const edges: Edge[] = overlay.model.relations.map((r) => {
      const proposed = overlay.edgeStatus[r.id] === "proposed";
      return {
        id: r.id,
        source: r.source,
        target: r.target,
        label: `${r.label} (${r.cardinality})${proposed ? " · proposed" : ""}`,
        labelStyle: { fill: proposed ? PROPOSED_COLOR : "var(--muted-foreground)", fontSize: 10 },
        labelBgStyle: { fill: "var(--card)" },
        animated: proposed,
        style: proposed
          ? { stroke: PROPOSED_COLOR, strokeWidth: 1.5, strokeDasharray: "6 4" }
          : { stroke: "var(--muted-foreground)", strokeWidth: 1.5 },
      };
    });
    return { nodes, edges };
  }, [overlay]);

  const onNodeClick = useCallback(
    (_event: ReactMouseEvent, node: Node) => setSelected(node.id),
    [],
  );

  const selectedNode = overlay.model.nodes.find((n) => n.id === selected) ?? null;
  const selectedActions = overlay.model.actions.filter((a) => a.primaryTarget === selected);
  const proposedCount = Object.values(overlay.nodeStatus).filter((s) => s !== "committed").length;

  return (
    <div className="h-[calc(100vh-3rem)] w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--border)" gap={20} />
        <Controls />
        <Panel position="top-left">
          <Legend proposedCount={proposedCount} />
        </Panel>
        {selectedNode && (
          <Panel position="top-right">
            <Inspector node={selectedNode} actions={selectedActions} onClose={() => setSelected(null)} />
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
