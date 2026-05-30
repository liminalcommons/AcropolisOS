// Shared-key -> LINK inference (storyboard Scene 4, Step 2: "shared keys -> the
// AI proposes a link"). evolve.ts grows TYPES and FIELDS; this proposes the
// relationships between them. Pure (no I/O): given a source object type and the
// field names of the data landing for it, propose a link to any EXISTING object
// type a field references by the FK-naming convention (the same convention
// declarative.ts uses: `<type>` / `<type>_id` / `<type>_<key>`).
//
// Inferred links are MANY-TO-MANY: a join table is a pure additive create that
// DiffMigrationRunner materializes safely (one-to-* links inject an FK column the
// migration runner does not yet ALTER in — see the growth-finish contract). They
// are always proposed as PENDING (links are structural — §4.3 escalate ceiling);
// the steward approves on the graph.
import type { Ontology } from "@/lib/ontology/schema";
import { pascalToSnake } from "@/lib/ontology/casing";

export interface InferredLink {
  name: string;
  from: string; // Pascal object-type key
  to: string; // Pascal object-type key
  cardinality: "many-to-many";
  viaField: string;
}

export function inferLinks(
  ontology: Ontology,
  sourceType: string,
  fieldNames: string[],
): InferredLink[] {
  const targets = Object.keys(ontology.object_types).map((key) => ({ key, token: pascalToSnake(key) }));
  const sourceToken = pascalToSnake(sourceType);
  const links: InferredLink[] = [];
  const seen = new Set<string>();

  for (const field of fieldNames) {
    const f = field.toLowerCase();
    for (const { key, token } of targets) {
      if (token === sourceToken) continue; // never self-link off a key
      const matches = f === token || f === `${token}_id` || f.startsWith(`${token}_`);
      if (!matches) continue;
      const name = `${sourceToken}_links_${token}`;
      if (seen.has(name)) break;
      seen.add(name);
      links.push({ name, from: sourceType, to: key, cardinality: "many-to-many", viaField: field });
      break; // one link per field — first matching target wins
    }
  }
  return links;
}
