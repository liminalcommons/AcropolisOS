// Pure projection of (ontology + data + viewer) into an instance-level graph
// model — the DATA sibling of derive.ts's ontologyToGraph (which projects the
// TYPE schema). Nodes are object rows; edges are the ontology's declared `ref`
// columns plus any provided link-type edges. No I/O, no DB, no domain literals:
// every type/field/ref comes from the loaded ontology, and the viewer's
// canReadType is the fence — an unreadable (or hidden) type contributes no
// nodes, and any edge to a missing node is dropped (no dangling endpoints, no
// id leak). A member's graph is therefore a strict subset of the steward's.
import { pascalToSnake } from "@/lib/ontology/casing";
import type { Ontology } from "@/lib/ontology/schema";
import type { CanReadType } from "@/lib/widgets/read-api";

export interface DataGraphNode {
  id: string; // `${typeToken}:${rowId}`
  type: string; // snake token
  label: string;
  kind: string | null; // element kind (agent|resource|event|commitment|concept) or null
}

export interface DataGraphEdge {
  id: string;
  source: string;
  target: string;
  label: string; // the ref property name, or the link-type name
}

export interface DataGraphModel {
  nodes: DataGraphNode[];
  edges: DataGraphEdge[];
}

export interface LinkEdgeInput {
  source: string; // full node id `${token}:${id}`
  target: string;
  label: string;
}

export interface DeriveDataGraphOpts {
  /** Snake tokens to omit entirely (de-clutter high-cardinality types). */
  hiddenTypes?: string[];
  /** Ego mode: keep only the N-hop neighborhood of this node. `type` is the snake token. */
  focus?: { type: string; id: string } | null;
  /** BFS depth for ego mode (default 1). */
  hops?: number;
}

export function deriveDataGraph(
  ontology: Ontology,
  rowsByType: Record<string, Array<Record<string, unknown>>>,
  linkEdges: LinkEdgeInput[],
  canReadType: CanReadType,
  opts: DeriveDataGraphOpts = {},
): DataGraphModel {
  const hidden = new Set(opts.hiddenTypes ?? []);
  const visible = (token: string): boolean => canReadType(token) && !hidden.has(token);

  // ── 1. nodes: one per row of each visible object type ──
  const nodes: DataGraphNode[] = [];
  const present = new Set<string>();

  for (const [name, ot] of Object.entries(ontology.object_types)) {
    const token = pascalToSnake(name);
    if (!visible(token)) continue;
    const titleProp = ot.title_property ?? null;
    const kind = (ot as { kind?: string }).kind ?? null;
    for (const row of rowsByType[token] ?? []) {
      const rawId = row["id"];
      if (rawId == null) continue;
      const id = `${token}:${String(rawId)}`;
      const labelVal = titleProp ? row[titleProp] : undefined;
      const label =
        labelVal != null && String(labelVal).length > 0 ? String(labelVal) : String(rawId);
      nodes.push({ id, type: token, label, kind });
      present.add(id);
    }
  }

  // ── 2. edges: one per non-null ref column whose target node is present ──
  const edges: DataGraphEdge[] = [];
  const pushEdge = (source: string, target: string, label: string): void => {
    if (!present.has(source) || !present.has(target)) return; // FENCE: no dangling endpoints
    edges.push({ id: `${source}->${target}:${label}`, source, target, label });
  };

  for (const [name, ot] of Object.entries(ontology.object_types)) {
    const token = pascalToSnake(name);
    if (!visible(token)) continue;
    const refCols: Array<{ field: string; targetToken: string }> = [];
    for (const [field, def] of Object.entries(ot.properties ?? {})) {
      const d = def as { type?: string; target?: string };
      if (d.type === "ref" && d.target) {
        refCols.push({ field, targetToken: pascalToSnake(d.target) });
      }
    }
    if (refCols.length === 0) continue;
    for (const row of rowsByType[token] ?? []) {
      const rawId = row["id"];
      if (rawId == null) continue;
      const source = `${token}:${String(rawId)}`;
      for (const { field, targetToken } of refCols) {
        const val = row[field];
        if (val == null || String(val).length === 0) continue;
        pushEdge(source, `${targetToken}:${String(val)}`, field);
      }
    }
  }

  // ── 3. provided link-type edges, filtered to present endpoints ──
  for (const le of linkEdges) pushEdge(le.source, le.target, le.label);

  // ── 4. ego filter: keep only the focus node's N-hop neighborhood ──
  if (opts.focus) {
    const fid = `${opts.focus.type}:${opts.focus.id}`;
    if (!present.has(fid)) return { nodes: [], edges: [] };
    const adj = new Map<string, Set<string>>();
    const link = (a: string, b: string): void => {
      if (!adj.has(a)) adj.set(a, new Set());
      adj.get(a)!.add(b);
    };
    for (const e of edges) {
      link(e.source, e.target);
      link(e.target, e.source);
    }
    const hops = opts.hops ?? 1;
    const keep = new Set<string>([fid]);
    let frontier = [fid];
    for (let h = 0; h < hops; h++) {
      const next: string[] = [];
      for (const n of frontier) {
        for (const nb of adj.get(n) ?? []) {
          if (!keep.has(nb)) {
            keep.add(nb);
            next.push(nb);
          }
        }
      }
      frontier = next;
    }
    return {
      nodes: nodes.filter((n) => keep.has(n.id)),
      edges: edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
    };
  }

  return { nodes, edges };
}
