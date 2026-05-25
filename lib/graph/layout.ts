// Pure dagre layout: GraphModel relations form the DAG; returns x/y per node.
// Action chips are positioned client-side relative to their primaryTarget, so
// only object nodes + relations participate in the dagre pass.
import dagre from "@dagrejs/dagre";
import type { GraphModel } from "./derive";

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
}

const NODE_W = 180;
const NODE_H = 64;

export function layoutGraph(model: GraphModel): PositionedNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 90 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of model.nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const r of model.relations) {
    if (g.hasNode(r.source) && g.hasNode(r.target)) g.setEdge(r.source, r.target);
  }

  dagre.layout(g);

  return model.nodes.map((n) => {
    const pos = g.node(n.id);
    // dagre centers nodes; React Flow positions by top-left corner.
    return { id: n.id, x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 };
  });
}
