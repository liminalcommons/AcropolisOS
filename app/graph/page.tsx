// Server component for /graph. Two views of the SAME world-model:
//   • ?view=schema (default) — the ontology TYPE graph (how the org is shaped).
//   • ?view=data            — the org DATA graph: object instances + their refs
//                             (the org itself), viewer-scoped through the read-api
//                             fence. Optional ?hide=tokens, ?focus=type/id, ?hops=N.
// Pure read on both paths; the ontology shape is not member data, and the data
// graph only ever contains rows the viewer's canReadType admits.
import { loadOntology } from "@/lib/ontology/load";
import { getRuntimeOntologyDir } from "@/lib/setup/paths";
import { ontologyToGraph } from "@/lib/graph/derive";
import { OntologyGraph } from "@/components/graph/ontology-graph";
import { buildChatRuntime } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import { pascalToSnake } from "@/lib/ontology/casing";
import { buildCanReadType } from "@/lib/widgets/read-api";
import { loadDataGraph } from "@/lib/graph/data-graph-source";
import { DataGraph, type DataGraphTypeInfo } from "@/components/graph/data-graph";

export const dynamic = "force-dynamic";

// High-cardinality types hidden on first paint so the full graph is legible; the
// type-filter toggles re-enable them. Skipped when focused (ego mode self-limits).
const DEFAULT_HIDE = ["member", "member_context", "notification"];

export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; hide?: string; focus?: string; hops?: string }>;
}): Promise<React.ReactElement> {
  const ontology = await loadOntology(getRuntimeOntologyDir());
  const { actor } = await buildChatRuntime();
  const isSteward = actor?.role === "steward";
  const sp = await searchParams;

  if (sp.view === "data") {
    const db = getDb();
    const canReadType = buildCanReadType(actor ?? null, ontology);

    const focus = (() => {
      if (!sp.focus) return null;
      const i = sp.focus.indexOf("/");
      if (i < 0) return null;
      return { type: sp.focus.slice(0, i), id: sp.focus.slice(i + 1) };
    })();
    const hops = Math.min(3, Math.max(1, Number.parseInt(sp.hops ?? "1", 10) || 1));
    const hidden =
      sp.hide !== undefined
        ? sp.hide.split(",").map((s) => s.trim()).filter(Boolean)
        : focus
          ? []
          : DEFAULT_HIDE;

    const model = await loadDataGraph(db, ontology, canReadType, { hiddenTypes: hidden, focus, hops });

    const allTypes: DataGraphTypeInfo[] = Object.entries(ontology.object_types)
      .map(([name, ot]) => ({ token: pascalToSnake(name), kind: (ot as { kind?: string }).kind ?? null }))
      .filter((t) => canReadType(t.token))
      .sort((a, b) => a.token.localeCompare(b.token));

    return <DataGraph model={model} allTypes={allTypes} hidden={hidden} focus={focus} hops={hops} />;
  }

  // Default: the ontology type-schema graph.
  const model = ontologyToGraph(ontology);
  return <OntologyGraph model={model} isSteward={isSteward} />;
}
