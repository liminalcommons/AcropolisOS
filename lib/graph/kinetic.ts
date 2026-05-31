// The KINETIC LAYER — the org's verbs (action_types), grouped by the autonomy
// dial (agent_policy). The semantic layer (objects/links) says what things ARE;
// the kinetic layer says what can be DONE and with how much agent autonomy. This
// is the request→promise→accept transaction grammar made legible: auto_apply (the
// agent runs it), confirm_if_unfamiliar (graduated), always_confirm (a human
// always approves). Pure — fed ontologyToGraph(ontology).actions.
import type { AgentPolicy } from "@/lib/ontology/schema";
import type { GraphAction } from "./derive";

export interface KineticGroup {
  policy: AgentPolicy;
  actions: GraphAction[];
}

// Fixed display order: most autonomous → least (the autonomy you grant, then the
// judgment you keep).
const POLICY_ORDER: AgentPolicy[] = ["auto_apply", "confirm_if_unfamiliar", "always_confirm"];

export function groupActionsByPolicy(actions: GraphAction[]): KineticGroup[] {
  return POLICY_ORDER.map((policy) => ({
    policy,
    actions: actions.filter((a) => a.policy === policy).sort((x, y) => x.id.localeCompare(y.id)),
  })).filter((g) => g.actions.length > 0);
}
