import type { LinkCardinality, Ontology } from "./schema";

export interface SchemaGraphNode {
  id: string;
  position: { x: number; y: number };
  data: {
    label: string;
    propertyCount: number;
  };
}

export interface SchemaGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  data?: {
    cardinality: LinkCardinality;
    description?: string;
  };
}

export interface SchemaGraph {
  nodes: SchemaGraphNode[];
  edges: SchemaGraphEdge[];
}

// Lay nodes on a simple circle so the page renders something reasonable
// before an automatic layouting library is wired in. Index-based polar
// positioning is fine for an MVP — once the graph grows past ~10 types we
// should swap in dagre or elkjs.
function layoutPosition(index: number, total: number): {
  x: number;
  y: number;
} {
  if (total === 0) return { x: 0, y: 0 };
  const radius = Math.max(200, total * 60);
  const angle = (2 * Math.PI * index) / total;
  return {
    x: Math.round(radius * Math.cos(angle)),
    y: Math.round(radius * Math.sin(angle)),
  };
}

export function ontologyToGraph(ontology: Ontology): SchemaGraph {
  const typeNames = Object.keys(ontology.object_types);
  const nodes: SchemaGraphNode[] = typeNames.map((name, i) => ({
    id: name,
    position: layoutPosition(i, typeNames.length),
    data: {
      label: name,
      propertyCount: Object.keys(ontology.object_types[name].properties).length,
    },
  }));

  const edges: SchemaGraphEdge[] = Object.entries(ontology.link_types).map(
    ([name, link]) => ({
      id: name,
      source: link.from,
      target: link.to,
      label: name,
      data: {
        cardinality: link.cardinality,
        description: link.description,
      },
    }),
  );

  return { nodes, edges };
}
