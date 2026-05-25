// Server component: load the SAME ontology the running app uses, project it to
// a graph model, and hand it to the client renderer. Pure read; no auth gate
// needed — the ontology shape is not member data.
import { loadOntology } from "@/lib/ontology/load";
import { getRuntimeOntologyDir } from "@/lib/setup/paths";
import { ontologyToGraph } from "@/lib/graph/derive";
import { OntologyGraph } from "@/components/graph/ontology-graph";

export const dynamic = "force-dynamic";

export default async function GraphPage(): Promise<React.ReactElement> {
  const ontology = await loadOntology(getRuntimeOntologyDir());
  const model = ontologyToGraph(ontology);
  return <OntologyGraph model={model} />;
}
