// lib/widgets/vocabulary.ts
// The single ONTOLOGY-DERIVED source for the read-only fence's structural
// whitelist. Pure: ontology in → whitelist structures out. No hostel literals.
import type { Ontology } from "@/lib/ontology/schema";
import { pascalToSnake } from "@/lib/ontology/casing";

export interface Vocabulary {
  /** snake_case tokens, one per ontology object type */
  validTypes: string[];
  /** token → readable field names (the column whitelist) */
  validFields: Record<string, string[]>;
  /** token → EXACT PascalCase ontology key (built by inversion, never guessed) */
  typeToObjectType: Record<string, string>;
}

export function deriveVocabulary(ontology: Ontology): Vocabulary {
  const validTypes: string[] = [];
  const validFields: Record<string, string[]> = {};
  const typeToObjectType: Record<string, string> = {};

  for (const objectTypeName of Object.keys(ontology.object_types)) {
    const token = pascalToSnake(objectTypeName);
    validTypes.push(token);
    typeToObjectType[token] = objectTypeName; // inversion: token resolves to the REAL key
    const props = ontology.object_types[objectTypeName].properties ?? {};
    validFields[token] = Object.keys(props);
  }

  return { validTypes, validFields, typeToObjectType };
}
