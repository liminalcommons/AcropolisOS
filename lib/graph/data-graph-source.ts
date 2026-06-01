// Server source for the org DATA graph: fetch the rows the viewer may read,
// through the SAME fail-closed read-api the board uses, then hand them to the
// pure deriveDataGraph. Generic — no domain literals; types/fields/refs come
// from the ontology. Edges are derived from declared `ref` columns (the rich,
// reliably-populated source). Link-type table edges are deferred (the runtime
// link surface is currently removed; only one link table is populated) — noted
// as a future enhancement; ref columns already yield a well-connected graph.
import { pascalToSnake } from "@/lib/ontology/casing";
import type { Database } from "@/lib/db/client";
import type { Ontology } from "@/lib/ontology/schema";
import { createReadOnlyDataApi, type CanReadType } from "@/lib/widgets/read-api";
import { deriveDataGraph, type DataGraphModel, type DeriveDataGraphOpts } from "./data-graph";

// Per-type fetch ceiling. High-cardinality types (member, member_context) are
// hidden by default in the UI; this bounds the query for any that aren't.
const PER_TYPE_LIMIT = 500;

export async function loadDataGraph(
  db: Database,
  ontology: Ontology,
  canReadType: CanReadType,
  opts: DeriveDataGraphOpts = {},
): Promise<DataGraphModel> {
  const api = createReadOnlyDataApi(db, canReadType, ontology);
  const hidden = new Set(opts.hiddenTypes ?? []);
  const rowsByType: Record<string, Array<Record<string, unknown>>> = {};

  for (const [name, ot] of Object.entries(ontology.object_types)) {
    const token = pascalToSnake(name);
    if (!canReadType(token) || hidden.has(token)) continue;
    const refCols = Object.entries(ot.properties ?? {})
      .filter(([, d]) => (d as { type?: string; target?: string }).type === "ref" && (d as { target?: string }).target)
      .map(([f]) => f);
    const columns = [...new Set(["id", ...(ot.title_property ? [ot.title_property] : []), ...refCols])];
    // Fail-closed inside select(): an unreadable type returns {rows: []}. Wrap in
    // try/catch so a type that is DECLARED in the ontology but whose table/column
    // is absent in the live DB (ontology↔DB drift) is skipped, not fatal.
    try {
      const { rows } = await api.select(token, { columns, limit: PER_TYPE_LIMIT });
      if (rows.length > 0) rowsByType[token] = rows;
    } catch {
      // missing table / column for this type — omit it from the graph
    }
  }

  return deriveDataGraph(ontology, rowsByType, [], canReadType, opts);
}
