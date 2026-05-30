// Ontology-derived form model for generated CRUD. Pure (no I/O, no randomness):
// derive the input fields for an object type, coerce raw string form values to
// typed values, and assemble a create-row (defaults + caller-supplied id) or an
// update-patch. The actual write goes through the fenced ctx.objects[type] in
// the server action — this module only shapes/validates the data.
import type { Ontology, PropertyDefinition } from "./schema";
import { deriveTypeDefaults } from "../organize/derive-defaults";

export type FieldKind =
  | "string"
  | "email"
  | "integer"
  | "decimal"
  | "boolean"
  | "date"
  | "timestamp"
  | "enum"
  | "ref"
  | "uuid";

export interface FormField {
  name: string;
  kind: FieldKind;
  required: boolean;
  enumValues?: string[];
  refTarget?: string;
}

// Owner-identity columns (mirror rowOwnedBy in ctx.ts): auto-filled with the
// actor on create so member_self-scoped types pass the write fence.
export const OWNER_FIELDS = new Set([
  "user_id",
  "owner_id",
  "owner",
  "member_id",
  "recipient_member_id",
  "blocked_actor_id",
]);

interface ResolvedDef {
  type: string;
  values?: string[];
  target?: string;
  required: boolean | undefined;
  primaryKey: boolean;
  hasDefault: boolean;
}

function resolveDef(def: PropertyDefinition, ontology: Ontology): ResolvedDef {
  let inline: Record<string, unknown> = def as Record<string, unknown>;
  let required: boolean | undefined;
  let primaryKey = false;
  let hasDefault = false;

  if (def && typeof def === "object" && "ref" in def) {
    const shared = (ontology.properties?.[(def as { ref: string }).ref] ?? {}) as Record<string, unknown>;
    inline = shared;
    required = "required" in def ? (def as { required?: boolean }).required : (shared.required as boolean | undefined);
    primaryKey =
      ("primary_key" in def ? (def as { primary_key?: boolean }).primary_key : (shared.primary_key as boolean)) === true;
    hasDefault = "default" in shared;
  } else {
    const d = def as Record<string, unknown>;
    required = d.required as boolean | undefined;
    primaryKey = d.primary_key === true;
    hasDefault = "default" in d;
  }

  const type = (typeof inline.type === "string" ? inline.type : "string") as string;
  return {
    type,
    values: type === "enum" && Array.isArray(inline.values) ? (inline.values as string[]) : undefined,
    target: type === "ref" && typeof inline.target === "string" ? (inline.target as string) : undefined,
    required,
    primaryKey,
    hasDefault,
  };
}

// The editable input fields for an object type: every property EXCEPT the
// primary key (auto-filled). `required` means the user must supply it — i.e.
// the ontology marks it required (no explicit `required: false`) AND it has no
// default (defaults fill blanks).
export function deriveFormFields(ontology: Ontology, objectTypeName: string): FormField[] {
  const ot = ontology.object_types[objectTypeName];
  if (!ot) return [];
  const fields: FormField[] = [];
  for (const [name, def] of Object.entries(ot.properties)) {
    const r = resolveDef(def, ontology);
    if (r.primaryKey || name === "id") continue;
    fields.push({
      name,
      kind: r.type as FieldKind,
      required: r.required !== false && !r.hasDefault,
      enumValues: r.values,
      refTarget: r.target,
    });
  }
  return fields;
}

export type CoerceResult = { ok: true; value: unknown } | { ok: false; error: string };

export function coerceFieldValue(field: FormField, raw: string): CoerceResult {
  const v = raw.trim();
  switch (field.kind) {
    case "integer":
      if (!/^-?\d+$/.test(v)) return { ok: false, error: `${field.name} must be a whole number` };
      return { ok: true, value: parseInt(v, 10) };
    case "decimal": {
      const n = Number(v);
      if (v === "" || Number.isNaN(n)) return { ok: false, error: `${field.name} must be a number` };
      return { ok: true, value: n };
    }
    case "boolean":
      return { ok: true, value: v === "true" || v === "on" || v === "1" };
    case "enum":
      if (field.enumValues && !field.enumValues.includes(v))
        return { ok: false, error: `${field.name} must be one of: ${field.enumValues.join(", ")}` };
      return { ok: true, value: v };
    case "email":
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return { ok: false, error: `${field.name} must be a valid email` };
      return { ok: true, value: v };
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, error: `${field.name} must be a date (YYYY-MM-DD)` };
      return { ok: true, value: v };
    default:
      // string | uuid | ref | timestamp — pass through (the PG store coerces
      // ISO date/timestamp strings to Date via coerceTimestamps).
      return { ok: true, value: v };
  }
}

export type BuildResult =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; errors: string[] };

// Assemble a full create row: ontology defaults (resolved @today/@now), the
// caller-supplied id (kept pure — the server action passes randomUUID()),
// coerced form values, owner-field auto-fill, and required-field validation.
export function buildObjectRow(
  ontology: Ontology,
  objectTypeName: string,
  values: Record<string, string>,
  opts: { id: string; ownerUserId?: string },
): BuildResult {
  const fields = deriveFormFields(ontology, objectTypeName);
  const defaults = deriveTypeDefaults(ontology, objectTypeName);
  const row: Record<string, unknown> = { ...defaults, id: opts.id };
  const errors: string[] = [];

  for (const f of fields) {
    const raw = values[f.name];
    const provided = raw !== undefined && raw.trim() !== "";
    if (provided) {
      const c = coerceFieldValue(f, raw);
      if (c.ok) row[f.name] = c.value;
      else errors.push(c.error);
      continue;
    }
    if (f.name in defaults) continue; // default fills the blank
    if (opts.ownerUserId && OWNER_FIELDS.has(f.name)) {
      row[f.name] = opts.ownerUserId; // member_self ownership
      continue;
    }
    if (f.required) errors.push(`${f.name} is required`);
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, row };
}

// Assemble an update patch: coerce ONLY the provided fields (no id, no defaults,
// no required check — a patch is partial).
export function buildObjectPatch(
  ontology: Ontology,
  objectTypeName: string,
  values: Record<string, string>,
): BuildResult {
  const fields = deriveFormFields(ontology, objectTypeName);
  const patch: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const f of fields) {
    const raw = values[f.name];
    if (raw === undefined) continue;
    if (raw.trim() === "" && f.kind !== "string") continue; // skip blanked non-strings
    const c = coerceFieldValue(f, raw);
    if (c.ok) patch[f.name] = c.value;
    else errors.push(c.error);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, row: patch };
}
