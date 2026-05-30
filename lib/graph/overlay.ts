// Pure overlay of PENDING proposals onto the committed ontology graph.
//
// ontologyToGraph(ontology) shows the ontology as it IS. This projects each
// pending proposal's diff on top and classifies every node/edge:
//   - committed: present in the live ontology
//   - proposed:  a brand-new object type the diff introduces (dashed-amber node)
//   - growing:   an existing type the diff adds fields to (the committed node
//                stays, gains an amber ring + a "+N proposed" badge of the new
//                field names — never duplicated)
// New link types are "proposed" edges (dashed-amber). A proposed edge whose
// endpoint resolves to no node (neither committed nor proposed) is DROPPED —
// React Flow would drop it silently, so we drop it explicitly and keep
// edgeStatus truthful.
//
// PURE: no I/O. Feed it ontologyToGraph(ontology) + the pending proposals' diffs.
// Added as a SIBLING of ontologyToGraph so the committed projector stays
// untouched and status-free (Axiom 1: additive, justified by the new "proposed"
// dimension committed nodes lack).
import type { ProposalDiff } from "../proposals/diff";
import type { GraphModel, GraphNode, GraphRelationEdge } from "./derive";

export type NodeStatus = "committed" | "proposed" | "growing";
export type EdgeStatus = "committed" | "proposed";

export interface Overlay {
  model: GraphModel;
  nodeStatus: Record<string, NodeStatus>;
  growingFields: Record<string, string[]>;
  edgeStatus: Record<string, EdgeStatus>;
}

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

// Project a single proposal diff into graph nodes/edges, mirroring
// ontologyToGraph's object_types -> nodes and link_types -> relations mapping.
// Actions are intentionally omitted (no proposed-action rendering yet).
export function diffToGraph(diff: ProposalDiff): GraphModel {
  const nodes: GraphNode[] = Object.entries(diff.new_object_types)
    .map(([id, ot]) => ({
      id,
      label: id,
      titleProperty: ot.title_property ?? null,
      propertyCount: Object.keys(ot.properties).length,
      readRoles: ot.permissions?.read ?? [],
      writeRoles: ot.permissions?.write ?? [],
    }))
    .sort(byId);
  const relations: GraphRelationEdge[] = Object.entries(diff.new_link_types)
    .map(([id, lt]) => ({
      id,
      source: lt.from,
      target: lt.to,
      label: id,
      cardinality: lt.cardinality,
    }))
    .sort(byId);
  return { nodes, relations, actions: [] };
}

export function buildOverlay(committed: GraphModel, diffs: ProposalDiff[]): Overlay {
  const nodeStatus: Record<string, NodeStatus> = {};
  const growingFields: Record<string, string[]> = {};
  const edgeStatus: Record<string, EdgeStatus> = {};

  const committedIds = new Set(committed.nodes.map((n) => n.id));
  for (const n of committed.nodes) nodeStatus[n.id] = "committed";
  for (const r of committed.relations) edgeStatus[r.id] = "committed";

  const proposedNodes: GraphNode[] = [];
  const proposedRelations: GraphRelationEdge[] = [];
  const seenProposed = new Set<string>();

  for (const diff of diffs) {
    const pg = diffToGraph(diff);
    for (const n of pg.nodes) {
      if (committedIds.has(n.id)) {
        // existing type gaining fields -> growing (never duplicate the node)
        if (nodeStatus[n.id] === "committed") nodeStatus[n.id] = "growing";
        const fields = Object.keys(diff.new_object_types[n.id].properties);
        growingFields[n.id] = dedupe([...(growingFields[n.id] ?? []), ...fields]);
      } else if (!seenProposed.has(n.id)) {
        seenProposed.add(n.id);
        nodeStatus[n.id] = "proposed";
        proposedNodes.push(n);
      }
    }
    for (const r of pg.relations) {
      if (edgeStatus[r.id] === undefined) {
        edgeStatus[r.id] = "proposed";
        proposedRelations.push(r);
      }
    }
  }

  // Drop proposed edges whose endpoints resolve to no node in the merged set.
  const allIds = new Set([...committedIds, ...proposedNodes.map((n) => n.id)]);
  const keptProposed: GraphRelationEdge[] = [];
  for (const r of proposedRelations) {
    if (allIds.has(r.source) && allIds.has(r.target)) keptProposed.push(r);
    else delete edgeStatus[r.id];
  }

  return {
    model: {
      nodes: [...committed.nodes, ...proposedNodes],
      relations: [...committed.relations, ...keptProposed],
      actions: committed.actions,
    },
    nodeStatus,
    growingFields,
    edgeStatus,
  };
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}
