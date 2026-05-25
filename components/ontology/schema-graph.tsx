"use client";

import { useMemo } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { SchemaGraph } from "@/lib/ontology/schema-graph";

interface Props {
  graph: SchemaGraph;
}

function toFlowNode(n: SchemaGraph["nodes"][number]): Node {
  return {
    id: n.id,
    position: n.position,
    data: {
      label: (
        <div className="text-center">
          <div className="font-semibold text-foreground">{n.data.label}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {n.data.propertyCount} props
          </div>
        </div>
      ),
    },
    type: "default",
    style: {
      background: "rgb(24 24 27)",
      border: "1px solid rgb(63 63 70)",
      borderRadius: 6,
      color: "rgb(244 244 245)",
      padding: 8,
      minWidth: 140,
    },
  };
}

function toFlowEdge(e: SchemaGraph["edges"][number]): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    labelStyle: { fill: "rgb(161 161 170)", fontSize: 11 },
    style: { stroke: "rgb(82 82 91)" },
    data: e.data,
  };
}

export function SchemaGraphView({ graph }: Props): React.ReactElement {
  const nodes = useMemo(() => graph.nodes.map(toFlowNode), [graph.nodes]);
  const edges = useMemo(() => graph.edges.map(toFlowEdge), [graph.edges]);

  return (
    <div
      data-testid="ontology-schema-graph"
      className="h-[60vh] w-full rounded-md border border-border bg-background"
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color="rgb(39 39 42)" gap={20} />
          <Controls
            showInteractive={false}
            className="!bg-card !text-foreground"
          />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
