// Server component: load the SAME ontology the running app uses, project it to
// a graph model, and hand it to the client renderer. Pure read; the ontology
// shape is not member data. We additionally resolve the actor's role (same
// builder the API routes use) so the client can gate the steward-only "Reject"
// (withdraw) control on a proposed node — the button is cosmetic only; the
// DELETE route re-checks role === "steward" server-side.
import { loadOntology } from "@/lib/ontology/load";
import { getRuntimeOntologyDir } from "@/lib/setup/paths";
import { ontologyToGraph } from "@/lib/graph/derive";
import { OntologyGraph } from "@/components/graph/ontology-graph";
import { buildChatRuntime } from "@/lib/agent/chat-runtime";

export const dynamic = "force-dynamic";

export default async function GraphPage(): Promise<React.ReactElement> {
  const ontology = await loadOntology(getRuntimeOntologyDir());
  const model = ontologyToGraph(ontology);
  const { actor } = await buildChatRuntime();
  const isSteward = actor?.role === "steward";
  return <OntologyGraph model={model} isSteward={isSteward} />;
}
