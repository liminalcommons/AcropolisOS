// Client React Flow renderer for the ontology graph. Object types are nodes
// (positioned by the pure dagre pass), link types are solid edges, and action
// types render as small policy-colored chips inside the object they primarily
// touch. Clicking a node opens the inspector. Read-only.
"use client";

import { useMemo, useState, useCallback } from "react";
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
import { layoutGraph } from "@/lib/graph/layout";
import { POLICY_VAR, Legend } from "./legend";
import { Inspector } from "./inspector";

interface ObjectNodeData extends Record<string, unknown> {
  label: string;
  propertyCount: number;
  actions: GraphAction[];
}

// v12 idiomatic pattern: name the full Node specialisation, then pass to NodeProps
type ObjectNodeType = Node<ObjectNodeData, "object">;

function ObjectNode({ data }: NodeProps<ObjectNodeType>): React.ReactElement {
  return (
    <div className="w-52 rounded-md border border-border bg-card px-3 py-2 shadow-sm">
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <div className="truncate text-sm font-medium text-foreground" title={data.label}>
        {data.label}
      </div>
      <div className="text-[10px] text-muted-foreground">{data.propertyCount} properties</div>
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

  const { nodes, edges } = useMemo(() => {
    const positions = new Map(layoutGraph(model).map((p) => [p.id, p]));
    const actionsByTarget = new Map<string, GraphAction[]>();
    for (const a of model.actions) {
      if (!a.primaryTarget) continue;
      const list = actionsByTarget.get(a.primaryTarget) ?? [];
      list.push(a);
      actionsByTarget.set(a.primaryTarget, list);
    }
    const nodes: ObjectNodeType[] = model.nodes.map((n) => ({
      id: n.id,
      type: "object" as const,
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      data: { label: n.label, propertyCount: n.propertyCount, actions: actionsByTarget.get(n.id) ?? [] },
    }));
    const edges: Edge[] = model.relations.map((r) => ({
      id: r.id,
      source: r.source,
      target: r.target,
      label: `${r.label} (${r.cardinality})`,
      labelStyle: { fill: "var(--muted-foreground)", fontSize: 10 },
      labelBgStyle: { fill: "var(--card)" },
      style: { stroke: "var(--muted-foreground)", strokeWidth: 1.5 },
    }));
    return { nodes, edges };
  }, [model]);

  const onNodeClick = useCallback(
    (_event: ReactMouseEvent, node: Node) => setSelected(node.id),
    [],
  );

  const selectedNode = model.nodes.find((n) => n.id === selected) ?? null;
  const selectedActions = model.actions.filter((a) => a.primaryTarget === selected);

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
        <Panel position="top-left"><Legend /></Panel>
        {selectedNode && (
          <Panel position="top-right">
            <Inspector node={selectedNode} actions={selectedActions} onClose={() => setSelected(null)} />
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
