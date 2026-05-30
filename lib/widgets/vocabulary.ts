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

// ── Effective property-type resolution ──────────────────────────────────────
// A property is either INLINE ({ type, ... }) or a PropertyReference
// ({ ref: "<shared>" }). Inline carries its own `type`; a reference inherits the
// shared registry property's `type` (and `required`). We resolve to the inline
// shape so derive helpers read the EFFECTIVE type/required the way codegen does
// (lib/codegen/drizzle.ts resolveProperty). No object-type ref can be expressed
// as a PropertyReference (shared props are scalars), so ref derivation only ever
// reads inline `type: "ref"`.

interface EffectiveProperty {
  type?: string;
  required?: boolean;
  fk_optional?: boolean;
  target?: string;
}

function resolveEffective(
  prop: unknown,
  ontology: Ontology,
): EffectiveProperty {
  const p = prop as Record<string, unknown>;
  if (p && typeof p === "object" && "ref" in p && typeof p.ref === "string") {
    const shared = ontology.properties[p.ref] as Record<string, unknown> | undefined;
    return {
      type: shared?.type as string | undefined,
      // A reference may override `required`; otherwise inherit the shared default.
      required: (p.required ?? shared?.required) as boolean | undefined,
      fk_optional: shared?.fk_optional as boolean | undefined,
      target: shared?.target as string | undefined,
    };
  }
  return {
    type: p?.type as string | undefined,
    required: p?.required as boolean | undefined,
    fk_optional: p?.fk_optional as boolean | undefined,
    target: p?.target as string | undefined,
  };
}

// ── deriveKeyFields ─────────────────────────────────────────────────────────
// The human-identity fields used for near-match dedup scoring: every email-typed
// property (resolved through references) plus the type's title_property. Replaces
// the hostel-literal KEY_FIELDS map — derives from ANY ontology type. Deduped,
// stable order (emails first, then title).
export function deriveKeyFields(ontology: Ontology, objectType: string): string[] {
  const def = ontology.object_types[objectType];
  if (!def) return [];
  const emailProps = Object.entries(def.properties ?? {})
    .filter(([, p]) => resolveEffective(p, ontology).type === "email")
    .map(([name]) => name);
  const title = def.title_property;
  return Array.from(new Set([...emailProps, ...(title ? [title] : [])]));
}

// ── deriveRequiredRefs ──────────────────────────────────────────────────────
// The NOT NULL foreign-key columns that must be present before an insert can
// succeed. Mirrors codegen (lib/codegen/drizzle.ts) EXACTLY — there are two ways
// a .notNull() FK column reaches the generated table:
//
//   1. An INLINE ref property (`type: ref`) on the object type. Emitted
//      .notNull() when its effective `required` is true, where `required`
//      DEFAULTS TO TRUE (`required ?? true`) — a ref with no `required:` marker
//      is required. `fk_optional` excludes it. (e.g. Booking.guest/bed,
//      Event.organizer, Bed.room, WorkTradeAgreement.bed_comp.)
//   2. A LINK-INJECTED FK column on the "to" side of a one-to-one / one-to-many
//      link (codegen planCardinalLinks): column `${from}_id`, emitted .notNull()
//      unless the link is `fk_optional`. (e.g. Shift.member_id from the
//      `staffed` Member→Shift link.)
//
// Both are derived here so the pre-insert guard matches the real NOT NULL set
// for ANY ontology — replacing the hostel-literal REQUIRED_REFS map.
export function deriveRequiredRefs(ontology: Ontology, objectType: string): string[] {
  const def = ontology.object_types[objectType];
  if (!def) return [];

  // 1) Inline required ref properties.
  const inlineRefs = Object.entries(def.properties ?? {})
    .filter(([, p]) => {
      const d = resolveEffective(p, ontology);
      // Codegen default: inline properties are required unless required === false.
      const required = d.required ?? true;
      return d.type === "ref" && required === true && d.fk_optional !== true;
    })
    .map(([name]) => name);

  // 2) Link-injected required FK columns on this type's "to" side.
  const linkRefs: string[] = [];
  for (const link of Object.values(ontology.link_types)) {
    if (link.cardinality === "many-to-many") continue; // join table, no injected FK here
    if (link.to !== objectType) continue;
    if (link.fk_optional === true) continue; // emitted nullable → not a required ref
    linkRefs.push(`${pascalToSnake(link.from)}_id`);
  }

  return Array.from(new Set([...inlineRefs, ...linkRefs]));
}
