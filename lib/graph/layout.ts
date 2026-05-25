// Pure dagre layout: GraphModel relations form the DAG; returns x/y per node.
// Nodes are a FIXED width and a height derived from how many action chips they
// carry (chips stack vertically in the renderer), so dagre reserves the right
// box per node and neighbours don't visually collide. Action chips are not graph
// nodes; only object nodes + relations participate in the dagre pass.
import dagre from "@dagrejs/dagre";
import type { GraphModel } from "./derive";

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
}

// Must stay in sync with the ObjectNode renderer (components/graph/ontology-graph.tsx):
// NODE_W = the node's fixed width (w-52 = 13rem = 208px); BASE_H = header + padding;
// CHIP_H = one stacked action-chip row.
const NODE_W = 208;
const BASE_H = 60;
const CHIP_H = 24;

export function layoutGraph(model: GraphModel): PositionedNode[] {
  const chipCount = new Map<string, number>();
  for (const a of model.actions) {
    if (!a.primaryTarget) continue;
    chipCount.set(a.primaryTarget, (chipCount.get(a.primaryTarget) ?? 0) + 1);
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 80, ranksep: 110 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of model.nodes) {
    const height = BASE_H + (chipCount.get(n.id) ?? 0) * CHIP_H;
    g.setNode(n.id, { width: NODE_W, height });
  }
  for (const r of model.relations) {
    if (g.hasNode(r.source) && g.hasNode(r.target)) g.setEdge(r.source, r.target);
  }

  dagre.layout(g);

  return model.nodes.map((n) => {
    const pos = g.node(n.id);
    // dagre centers nodes; React Flow positions by top-left corner.
    return { id: n.id, x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 };
  });
}
