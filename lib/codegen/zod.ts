import { z, type ZodTypeAny } from "zod";
import type {
  ActionType,
  InlineProperty,
  LinkType,
  ObjectType,
  Ontology,
  PropertyDefinition,
  SharedPropertyRegistry,
} from "../ontology/schema";
import { isDynamicDefaultToken } from "./defaults";

export function pascalCase(name: string): string {
  return name
    .split(/[_\-\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function isPropertyReference(
  prop: PropertyDefinition,
): prop is Extract<PropertyDefinition, { ref: string }> {
  return "ref" in prop;
}

function resolveProperty(
  prop: PropertyDefinition,
  shared: SharedPropertyRegistry,
): {
  inline: InlineProperty;
  required: boolean;
  hasDefault: boolean;
  defaultValue: unknown;
  primaryKey: boolean;
} {
  if (isPropertyReference(prop)) {
    const target = shared[prop.ref];
    if (!target) {
      throw new Error(`shared property "${prop.ref}" not found`);
    }
    return {
      inline: target,
      required: prop.required ?? true,
      // Dynamic date/timestamp tokens (CURRENT_DATE/now()) live only at the DB
      // column-default layer — zod cannot represent them, so they carry NO zod default.
      hasDefault:
        "default" in target &&
        target.default !== undefined &&
        !isDynamicDefaultToken(target.default),
      defaultValue: "default" in target ? target.default : undefined,
      primaryKey: prop.primary_key ?? target.primary_key ?? false,
    };
  }
  return {
    inline: prop,
    required: prop.required ?? true,
    hasDefault:
      "default" in prop &&
      prop.default !== undefined &&
      !isDynamicDefaultToken(prop.default),
    defaultValue: "default" in prop ? prop.default : undefined,
    primaryKey: prop.primary_key ?? false,
  };
}

function inlineToZodSchema(inline: InlineProperty): ZodTypeAny {
  switch (inline.type) {
    case "uuid":
      return z.uuid();
    case "string":
      return z.string();
    case "email":
      return z.email();
    case "date":
      return z.iso.date();
    case "timestamp":
      return z.iso.datetime({ offset: true });
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

function inlineToZodExpr(inline: InlineProperty): string {
  switch (inline.type) {
    case "uuid":
      return "z.uuid()";
    case "string":
      return "z.string()";
    case "email":
      return "z.email()";
    case "date":
      return "z.iso.date()";
    case "timestamp":
      return "z.iso.datetime({ offset: true })";
    case "integer":
      return "z.number().int()";
    case "decimal":
      return "z.number()";
    case "boolean":
      return "z.boolean()";
    case "enum":
      return `z.enum([${inline.values.map((v) => JSON.stringify(v)).join(", ")}])`;
    case "ref":
      return "z.string()";
  }
}

function applyOptionality(
  schema: ZodTypeAny,
  resolved: ReturnType<typeof resolveProperty>,
  context: "object" | "params",
): ZodTypeAny {
  if (context === "object") {
    if (resolved.primaryKey) return schema;
    if (resolved.hasDefault) return schema.default(resolved.defaultValue);
    if (!resolved.required) return schema.optional();
    return schema;
  }
  if (resolved.hasDefault) return schema.default(resolved.defaultValue);
  if (!resolved.required) return schema.optional();
  return schema;
}

function applyOptionalityExpr(
  exprIn: string,
  resolved: ReturnType<typeof resolveProperty>,
  context: "object" | "params",
): string {
  if (context === "object") {
    if (resolved.primaryKey) return exprIn;
    if (resolved.hasDefault) {
      return `${exprIn}.default(${JSON.stringify(resolved.defaultValue)})`;
    }
    if (!resolved.required) return `${exprIn}.optional()`;
    return exprIn;
  }
  if (resolved.hasDefault) {
    return `${exprIn}.default(${JSON.stringify(resolved.defaultValue)})`;
  }
  if (!resolved.required) return `${exprIn}.optional()`;
  return exprIn;
}

function propertyMapToZodObject(
  props: Record<string, PropertyDefinition>,
  shared: SharedPropertyRegistry,
  context: "object" | "params",
): ZodTypeAny {
  const shape: Record<string, ZodTypeAny> = {};
  for (const [name, prop] of Object.entries(props)) {
    const resolved = resolveProperty(prop, shared);
    const base = inlineToZodSchema(resolved.inline);
    shape[name] = applyOptionality(base, resolved, context);
  }
  return z.object(shape);
}

function propertyMapToZodExpr(
  props: Record<string, PropertyDefinition>,
  shared: SharedPropertyRegistry,
  context: "object" | "params",
): string {
  const lines: string[] = [];
  for (const [name, prop] of Object.entries(props)) {
    const resolved = resolveProperty(prop, shared);
    const base = inlineToZodExpr(resolved.inline);
    const withOptional = applyOptionalityExpr(base, resolved, context);
    lines.push(`  ${JSON.stringify(name)}: ${withOptional},`);
  }
  return `z.object({\n${lines.join("\n")}\n})`;
}

export interface RuntimeZodSchemas {
  objectSchemas: Record<string, ZodTypeAny>;
  linkSchemas: Record<string, ZodTypeAny>;
  actionParamSchemas: Record<string, ZodTypeAny>;
}

export function buildZodSchemas(ontology: Ontology): RuntimeZodSchemas {
  const objectSchemas: Record<string, ZodTypeAny> = {};
  for (const [name, obj] of Object.entries(ontology.object_types)) {
    objectSchemas[pascalCase(name)] = propertyMapToZodObject(
      obj.properties,
      ontology.properties,
      "object",
    );
  }

  const linkSchemas: Record<string, ZodTypeAny> = {};
  for (const [name, link] of Object.entries(ontology.link_types)) {
    if (!link.properties || Object.keys(link.properties).length === 0) continue;
    linkSchemas[`${pascalCase(name)}Link`] = propertyMapToZodObject(
      link.properties,
      ontology.properties,
      "object",
    );
  }

  const actionParamSchemas: Record<string, ZodTypeAny> = {};
  for (const [name, action] of Object.entries(ontology.action_types)) {
    actionParamSchemas[`${pascalCase(name)}Params`] = propertyMapToZodObject(
      action.parameters ?? {},
      ontology.properties,
      "params",
    );
  }

  return { objectSchemas, linkSchemas, actionParamSchemas };
}

const HEADER = `// THIS FILE IS GENERATED. DO NOT EDIT.
// Source: lib/codegen/zod.ts — regenerate via the ontology codegen pipeline.

`;

function emitObjectTypeBlock(
  name: string,
  obj: ObjectType,
  shared: SharedPropertyRegistry,
): string {
  const pascal = pascalCase(name);
  const expr = propertyMapToZodExpr(obj.properties, shared, "object");
  const indented = expr.replace(/^/gm, "");
  return (
    `export const ${pascal}Schema = ${indented};\n` +
    `export type ${pascal} = z.infer<typeof ${pascal}Schema>;\n`
  );
}

function emitLinkTypeBlock(
  name: string,
  link: LinkType,
  shared: SharedPropertyRegistry,
): string {
  if (!link.properties || Object.keys(link.properties).length === 0) return "";
  const pascal = `${pascalCase(name)}Link`;
  const expr = propertyMapToZodExpr(link.properties, shared, "object");
  return (
    `export const ${pascal}Schema = ${expr};\n` +
    `export type ${pascal} = z.infer<typeof ${pascal}Schema>;\n`
  );
}

function emitActionTypeBlock(
  name: string,
  action: ActionType,
  shared: SharedPropertyRegistry,
): string {
  const pascal = `${pascalCase(name)}Params`;
  const expr = propertyMapToZodExpr(action.parameters ?? {}, shared, "params");
  return (
    `export const ${pascal}Schema = ${expr};\n` +
    `export type ${pascal} = z.infer<typeof ${pascal}Schema>;\n`
  );
}

export function generateZodModule(ontology: Ontology): string {
  const parts: string[] = [HEADER, 'import { z } from "zod";\n\n'];

  parts.push("// === Object types ===\n\n");
  for (const [name, obj] of Object.entries(ontology.object_types)) {
    parts.push(emitObjectTypeBlock(name, obj, ontology.properties));
    parts.push("\n");
  }

  const linksWithProps = Object.entries(ontology.link_types).filter(
    ([, link]) => link.properties && Object.keys(link.properties).length > 0,
  );
  if (linksWithProps.length > 0) {
    parts.push("// === Link types (with properties) ===\n\n");
    for (const [name, link] of linksWithProps) {
      parts.push(emitLinkTypeBlock(name, link, ontology.properties));
      parts.push("\n");
    }
  }

  parts.push("// === Action parameter schemas ===\n\n");
  for (const [name, action] of Object.entries(ontology.action_types)) {
    parts.push(emitActionTypeBlock(name, action, ontology.properties));
    parts.push("\n");
  }

  return parts.join("");
}

export function generateOntologyModule(ontology: Ontology): string {
  const objectNames = Object.keys(ontology.object_types).map(pascalCase);
  const linkNames = Object.entries(ontology.link_types)
    .filter(
      ([, link]) => link.properties && Object.keys(link.properties).length > 0,
    )
    .map(([name]) => `${pascalCase(name)}Link`);
  const actionNames = Object.keys(ontology.action_types).map(
    (n) => `${pascalCase(n)}Params`,
  );

  const allTypeNames = [...objectNames, ...linkNames, ...actionNames];
  const allSchemaNames = allTypeNames.map((n) => `${n}Schema`);

  // Only object-type names appear in the local Ontology type body;
  // the rest are re-exported via `export type {...} from ...` without a local import.
  const importList = [
    ...allSchemaNames.map((n) => `  ${n},`),
    ...objectNames.map((n) => `  type ${n},`),
  ].join("\n");

  const ontologyTypeBody = objectNames
    .map((n) => `  ${n}: ${n};`)
    .join("\n");
  const schemasMapBody = objectNames
    .map((n) => `  ${n}: ${n}Schema,`)
    .join("\n");
  const linkSchemasMapBody = linkNames
    .map((n) => `  ${n}: ${n}Schema,`)
    .join("\n");
  const actionSchemasMapBody = actionNames
    .map((n) => `  ${n}: ${n}Schema,`)
    .join("\n");

  const schemaReexportList = allSchemaNames.map((n) => `  ${n},`).join("\n");
  const typeReexportList = allTypeNames.map((n) => `  ${n},`).join("\n");

  return (
    HEADER +
    'import {\n' +
    importList +
    '\n} from "./types.generated";\n\n' +
    'export {\n' +
    schemaReexportList +
    '\n} from "./types.generated";\n' +
    'export type {\n' +
    typeReexportList +
    '\n} from "./types.generated";\n\n' +
    `export type Ontology = {\n${ontologyTypeBody}\n};\n\n` +
    `export const OntologySchemas = {\n${schemasMapBody}\n} as const;\n\n` +
    (linkNames.length > 0
      ? `export const LinkSchemas = {\n${linkSchemasMapBody}\n} as const;\n\n`
      : "export const LinkSchemas = {} as const;\n\n") +
    `export const ActionParamSchemas = {\n${actionSchemasMapBody}\n} as const;\n`
  );
}
