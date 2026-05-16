// US-024: Declarative action runner.
//
// Interprets the four declarative directives an action_type YAML can carry:
//   - creates_object: <ObjectType>  → ctx.objects[X].create(row)
//   - creates_link:   <LinkType>    → ctx.links[L].create({ from, to, properties })
//   - updates:        <ObjectType>  → ctx.objects[X].update(id, patch)
//   - deletes:        <ObjectType>  → ctx.objects[X].delete(id)
//
// Params are validated against the ontology's declared parameters block
// (via the same Zod-from-property-defs builder used by codegen). For object
// creation we fill in required system fields the caller can't supply:
// primary-key uuids, timestamp/date columns, and empty strings (matching the
// generated object schema), since action params are intentionally narrower
// than the row shape.

import { randomUUID } from "node:crypto";
import { z, type ZodTypeAny } from "zod";
import type { OntologyCtx } from "../ontology/ctx";
import type {
  ActionType,
  InlineProperty,
  LinkType,
  ObjectType,
  Ontology,
  PropertyDefinition,
  SharedPropertyRegistry,
} from "../ontology/schema";

export type DeclarativeDirective =
  | "creates_object"
  | "creates_link"
  | "updates"
  | "deletes";

export class DeclarativeActionError extends Error {
  constructor(
    message: string,
    readonly actionName: string,
    readonly stage:
      | "lookup"
      | "directive"
      | "validate_params"
      | "execute",
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DeclarativeActionError";
  }
}

export interface RunDeclarativeActionInput {
  actionName: string;
  ontology: Ontology;
  params: unknown;
  ctx: OntologyCtx;
}

export type DeclarativeActionResult =
  | {
      ok: true;
      directive: "creates_object";
      object_type: string;
      id: string;
    }
  | {
      ok: true;
      directive: "creates_link";
      link_type: string;
      from: string;
      to: string;
    }
  | {
      ok: true;
      directive: "updates";
      object_type: string;
      id: string;
    }
  | { ok: true; directive: "deletes"; object_type: string; id: string }
  | {
      ok: false;
      reason: "not_found";
      directive: "updates" | "deletes";
      object_type: string;
      id: string;
    };

// === Directive dispatch ===

function pickDirective(action: ActionType): DeclarativeDirective | null {
  if (action.creates_object) return "creates_object";
  if (action.creates_link) return "creates_link";
  if (action.updates) return "updates";
  if (action.deletes) return "deletes";
  return null;
}

// === Property resolution (shared with codegen, kept local to avoid a cycle) ===

function isPropertyReference(
  prop: PropertyDefinition,
): prop is Extract<PropertyDefinition, { ref: string }> {
  return "ref" in prop;
}

interface ResolvedProperty {
  inline: InlineProperty;
  required: boolean;
  hasDefault: boolean;
  defaultValue: unknown;
  primaryKey: boolean;
}

function resolveProperty(
  prop: PropertyDefinition,
  shared: SharedPropertyRegistry,
): ResolvedProperty {
  if (isPropertyReference(prop)) {
    const target = shared[prop.ref];
    if (!target) {
      throw new Error(`shared property "${prop.ref}" not found`);
    }
    return {
      inline: target,
      required: prop.required ?? true,
      hasDefault: "default" in target && target.default !== undefined,
      defaultValue: "default" in target ? target.default : undefined,
      primaryKey: prop.primary_key ?? target.primary_key ?? false,
    };
  }
  return {
    inline: prop,
    required: prop.required ?? true,
    hasDefault: "default" in prop && prop.default !== undefined,
    defaultValue: "default" in prop ? prop.default : undefined,
    primaryKey: prop.primary_key ?? false,
  };
}

function inlineToZod(inline: InlineProperty): ZodTypeAny {
  switch (inline.type) {
    case "uuid":
      return z.string();
    case "string":
      return z.string();
    case "email":
      return z.string().email();
    case "date":
      return z.string();
    case "timestamp":
      return z.string();
    case "integer":
      return z.number().int();
    case "decimal":
      return z.number();
    case "boolean":
      return z.boolean();
    case "enum":
      return z.enum(inline.values as [string, ...string[]]);
    case "ref":
      return z.string();
  }
}

function buildParamsSchema(action: ActionType): ZodTypeAny {
  const shape: Record<string, ZodTypeAny> = {};
  for (const [name, prop] of Object.entries(action.parameters ?? {})) {
    // Action params live in their own registry-free namespace in practice;
    // ref-style params are uncommon here, so resolve inline only.
    if (isPropertyReference(prop)) {
      // For an action param like `event: { ref: "email" }` we'd still want
      // to honor the shared registry, but action YAMLs in seed don't do
      // that. Fall back to string to keep the runner robust.
      shape[name] = z.string();
      continue;
    }
    let s = inlineToZod(prop);
    const hasDefault = "default" in prop && prop.default !== undefined;
    const required = prop.required ?? true;
    if (hasDefault) s = s.default(prop.default);
    else if (!required) s = s.optional();
    shape[name] = s;
  }
  return z.object(shape).strict();
}

// === Auto-fill missing required object-row fields ===

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowIsoTimestamp(): string {
  return new Date().toISOString();
}

function autoFillForProperty(
  resolved: ResolvedProperty,
): unknown | undefined {
  switch (resolved.inline.type) {
    case "uuid":
      // Only fill uuids when they're primary keys; non-pk uuids would need a
      // domain hint we don't have.
      return resolved.primaryKey ? randomUUID() : undefined;
    case "string":
      return "";
    case "email":
      return undefined;
    case "date":
      return todayIsoDate();
    case "timestamp":
      return nowIsoTimestamp();
    case "integer":
      return undefined;
    case "decimal":
      return undefined;
    case "boolean":
      return undefined;
    case "enum":
      return undefined;
    case "ref":
      return undefined;
  }
}

interface BuildRowInput {
  objectType: ObjectType;
  shared: SharedPropertyRegistry;
  params: Record<string, unknown>;
}

// Build a full object row by mapping action params onto the target type's
// property schema. Any required property not in params gets an auto-fill if
// we know how; everything else falls through and surfaces as a downstream
// store error rather than being silently dropped.
function buildRowFromParams({
  objectType,
  shared,
  params,
}: BuildRowInput): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [propName, propDef] of Object.entries(objectType.properties)) {
    const resolved = resolveProperty(propDef, shared);

    // Convention: an action param like `event: <id>` maps to the row's
    // `event_id: <id>` column (mirrors how Drizzle codegen names FK columns).
    const refColumnSource =
      resolved.inline.type === "ref" && propName.endsWith("_id")
        ? propName.slice(0, -"_id".length)
        : null;

    if (propName in params) {
      row[propName] = params[propName];
      continue;
    }
    if (refColumnSource && refColumnSource in params) {
      row[propName] = params[refColumnSource];
      continue;
    }

    if (resolved.hasDefault) {
      row[propName] = resolved.defaultValue;
      continue;
    }
    if (!resolved.required) continue;

    const filled = autoFillForProperty(resolved);
    if (filled !== undefined) row[propName] = filled;
  }
  return row;
}

// === Link endpoint resolution ===

// Convention used in seed: a `record_attendance` action with `creates_link:
// attended` (Member -> Event) takes params { member, event, role }. So the
// param key matching the lowercased endpoint type name supplies the id.
function paramKeyForEndpoint(typeName: string): string {
  return typeName.charAt(0).toLowerCase() + typeName.slice(1);
}

interface BuildLinkPropertiesInput {
  link: LinkType;
  shared: SharedPropertyRegistry;
  fromKey: string;
  toKey: string;
  params: Record<string, unknown>;
}

function buildLinkProperties({
  link,
  shared,
  fromKey,
  toKey,
  params,
}: BuildLinkPropertiesInput): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const linkPropDefs = link.properties ?? {};
  for (const [propName, propDef] of Object.entries(linkPropDefs)) {
    const resolved = resolveProperty(propDef, shared);
    if (propName in params) {
      props[propName] = params[propName];
      continue;
    }
    if (resolved.hasDefault) {
      props[propName] = resolved.defaultValue;
      continue;
    }
    if (!resolved.required) continue;
    const filled = autoFillForProperty(resolved);
    if (filled !== undefined) props[propName] = filled;
  }
  // Pass through any extra params that aren't from/to endpoint keys and
  // aren't already accounted for by the link's declared property block, so
  // ad-hoc data flows through (e.g. an audit-only tag).
  for (const [k, v] of Object.entries(params)) {
    if (k === fromKey || k === toKey) continue;
    if (k in props) continue;
    if (k in linkPropDefs) continue;
    props[k] = v;
  }
  return props;
}

// === Main entry point ===

function getObjectAccess(
  ctx: OntologyCtx,
  objectType: string,
): {
  create(row: unknown): Promise<unknown>;
  update(id: string, patch: Record<string, unknown>): Promise<unknown>;
  delete(id: string): Promise<boolean>;
  findById(id: string): Promise<unknown>;
} {
  const objects = ctx.objects as unknown as Record<
    string,
    {
      create(row: unknown): Promise<unknown>;
      update(
        id: string,
        patch: Record<string, unknown>,
      ): Promise<unknown>;
      delete(id: string): Promise<boolean>;
      findById(id: string): Promise<unknown>;
    }
  >;
  const access = objects[objectType];
  if (!access) {
    throw new DeclarativeActionError(
      `object type "${objectType}" is not exposed on ctx.objects`,
      objectType,
      "execute",
    );
  }
  return access;
}

function getLinkAccess(
  ctx: OntologyCtx,
  linkType: string,
): {
  create(input: {
    from: string;
    to: string;
    properties: Record<string, unknown>;
  }): Promise<void>;
} {
  const links = ctx.links as unknown as Record<
    string,
    {
      create(input: {
        from: string;
        to: string;
        properties: Record<string, unknown>;
      }): Promise<void>;
    }
  >;
  const access = links[linkType];
  if (!access) {
    throw new DeclarativeActionError(
      `link type "${linkType}" is not exposed on ctx.links`,
      linkType,
      "execute",
    );
  }
  return access;
}

export async function runDeclarativeAction(
  input: RunDeclarativeActionInput,
): Promise<DeclarativeActionResult> {
  const { actionName, ontology, params, ctx } = input;

  const action = ontology.action_types[actionName];
  if (!action) {
    throw new DeclarativeActionError(
      `action "${actionName}" not found in ontology`,
      actionName,
      "lookup",
    );
  }
  const directive = pickDirective(action);
  if (!directive) {
    throw new DeclarativeActionError(
      `action "${actionName}" is not declarative (no creates_object / creates_link / updates / deletes)`,
      actionName,
      "directive",
    );
  }

  const paramsSchema = buildParamsSchema(action);
  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success) {
    throw new DeclarativeActionError(
      `params failed validation for "${actionName}": ${formatZodError(parsed.error)}`,
      actionName,
      "validate_params",
      parsed.error,
    );
  }
  const validated = parsed.data as Record<string, unknown>;

  switch (directive) {
    case "creates_object": {
      const objectType = action.creates_object as string;
      const def = ontology.object_types[objectType];
      if (!def) {
        throw new DeclarativeActionError(
          `creates_object references unknown object type "${objectType}"`,
          actionName,
          "execute",
        );
      }
      const row = buildRowFromParams({
        objectType: def,
        shared: ontology.properties,
        params: validated,
      });
      await getObjectAccess(ctx, objectType).create(row);
      return {
        ok: true,
        directive: "creates_object",
        object_type: objectType,
        id: row.id as string,
      };
    }
    case "creates_link": {
      const linkType = action.creates_link as string;
      const link = ontology.link_types[linkType];
      if (!link) {
        throw new DeclarativeActionError(
          `creates_link references unknown link type "${linkType}"`,
          actionName,
          "execute",
        );
      }
      const fromKey = paramKeyForEndpoint(link.from);
      const toKey = paramKeyForEndpoint(link.to);
      const fromId = validated[fromKey];
      const toId = validated[toKey];
      if (typeof fromId !== "string" || typeof toId !== "string") {
        throw new DeclarativeActionError(
          `creates_link "${linkType}" requires string params "${fromKey}" and "${toKey}"`,
          actionName,
          "validate_params",
        );
      }
      const properties = buildLinkProperties({
        link,
        shared: ontology.properties,
        fromKey,
        toKey,
        params: validated,
      });
      await getLinkAccess(ctx, linkType).create({
        from: fromId,
        to: toId,
        properties,
      });
      return {
        ok: true,
        directive: "creates_link",
        link_type: linkType,
        from: fromId,
        to: toId,
      };
    }
    case "updates": {
      const objectType = action.updates as string;
      const id = validated.id;
      if (typeof id !== "string") {
        throw new DeclarativeActionError(
          `updates "${objectType}" requires a string "id" param`,
          actionName,
          "validate_params",
        );
      }
      const { id: _drop, ...patch } = validated;
      void _drop;
      const updated = await getObjectAccess(ctx, objectType).update(id, patch);
      if (!updated) {
        return {
          ok: false,
          reason: "not_found",
          directive: "updates",
          object_type: objectType,
          id,
        };
      }
      return { ok: true, directive: "updates", object_type: objectType, id };
    }
    case "deletes": {
      const objectType = action.deletes as string;
      const id = validated.id;
      if (typeof id !== "string") {
        throw new DeclarativeActionError(
          `deletes "${objectType}" requires a string "id" param`,
          actionName,
          "validate_params",
        );
      }
      const removed = await getObjectAccess(ctx, objectType).delete(id);
      if (!removed) {
        return {
          ok: false,
          reason: "not_found",
          directive: "deletes",
          object_type: objectType,
          id,
        };
      }
      return { ok: true, directive: "deletes", object_type: objectType, id };
    }
  }
}

function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => `/${i.path.map(String).join("/")}: ${i.message}`)
    .join("; ");
}
