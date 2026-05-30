// Pure projection of the loaded ontology into a render-agnostic graph model.
// Nodes = object types; relations = link types; actions = action types attached
// to the object they primarily touch, carrying the agent_policy verification
// contract. No I/O — feed it the result of loadOntology().
import type {
  Ontology,
  AgentPolicy,
  SideEffectChannel,
  PropertyDefinition,
} from "../ontology/schema";

export interface GraphNode {
  id: string;
  label: string;
  titleProperty: string | null;
  propertyCount: number;
  readRoles: string[];
  writeRoles: string[];
  // The universal element kind (agent | resource | event | commitment |
  // concept), or null when the type is unclassified. Drives the node accent.
  kind: string | null;
}

export interface GraphRelationEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  cardinality: string;
}

export type ActionEffect = "creates" | "updates" | "deletes" | "reads";

export interface GraphActionTarget {
  objectType: string;
  effect: ActionEffect;
}

export interface GraphAction {
  id: string;
  label: string;
  policy: AgentPolicy;
  permissions: string[];
  sideEffects: SideEffectChannel[];
  // The object node an action chip anchors to. Null when an action declares no
  // object effect and no ref parameter; such actions are not placed on the graph.
  primaryTarget: string | null;
  targets: GraphActionTarget[];
}

export interface GraphModel {
  nodes: GraphNode[];
  relations: GraphRelationEdge[];
  actions: GraphAction[];
}

function refTarget(prop: PropertyDefinition): string | null {
  return "type" in prop && prop.type === "ref" ? prop.target : null;
}

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

export function ontologyToGraph(ontology: Ontology): GraphModel {
  const nodes: GraphNode[] = Object.entries(ontology.object_types)
    .map(([id, ot]) => ({
      id,
      label: id,
      titleProperty: ot.title_property ?? null,
      propertyCount: Object.keys(ot.properties).length,
      readRoles: ot.permissions?.read ?? [],
      writeRoles: ot.permissions?.write ?? [],
      kind: ot.kind ?? null,
    }))
    .sort(byId);

  const relations: GraphRelationEdge[] = Object.entries(ontology.link_types)
    .map(([id, lt]) => ({
      id,
      source: lt.from,
      target: lt.to,
      label: id,
      cardinality: lt.cardinality,
    }))
    .sort(byId);

  const actions: GraphAction[] = Object.entries(ontology.action_types)
    .map(([id, at]) => {
      const targets: GraphActionTarget[] = [];
      if (at.creates_object) targets.push({ objectType: at.creates_object, effect: "creates" });
      if (at.updates) targets.push({ objectType: at.updates, effect: "updates" });
      if (at.deletes) targets.push({ objectType: at.deletes, effect: "deletes" });
      for (const prop of Object.values(at.parameters ?? {})) {
        const t = refTarget(prop);
        if (t) targets.push({ objectType: t, effect: "reads" });
      }
      const primaryTarget =
        at.creates_object ??
        at.updates ??
        at.deletes ??
        targets.find((t) => t.effect === "reads")?.objectType ??
        null;
      return {
        id,
        label: id,
        policy: at.agent_policy,
        permissions: at.permissions ?? [],
        sideEffects: at.side_effects ?? [],
        primaryTarget,
        targets,
      };
    })
    .sort(byId);

  return { nodes, relations, actions };
}
