import type {
  InlineProperty,
  LinkType,
  ObjectType,
  Ontology,
  PropertyDefinition,
  SharedPropertyRegistry,
} from "../ontology/schema";
import { isDynamicDefaultToken, tokenToSqlDefault } from "./defaults";

export function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

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

interface ColumnBuilderInfo {
  builder: string;
  refTarget: string | null;
}

function inlineToColumnBuilder(
  columnName: string,
  inline: InlineProperty,
): ColumnBuilderInfo {
  const n = JSON.stringify(columnName);
  switch (inline.type) {
    case "uuid":
      return { builder: `uuid(${n})`, refTarget: null };
    case "string":
      return { builder: `text(${n})`, refTarget: null };
    case "email":
      return { builder: `text(${n})`, refTarget: null };
    case "date":
      return { builder: `date(${n})`, refTarget: null };
    case "timestamp":
      return {
        builder: `timestamp(${n}, { withTimezone: true })`,
        refTarget: null,
      };
    case "integer":
      return { builder: `integer(${n})`, refTarget: null };
    case "decimal":
      return { builder: `numeric(${n})`, refTarget: null };
    case "boolean":
      return { builder: `boolean(${n})`, refTarget: null };
    case "enum":
      return { builder: `text(${n})`, refTarget: null };
    case "ref":
      return { builder: `uuid(${n})`, refTarget: inline.target };
  }
}

function formatDefault(value: unknown, colType?: string): string {
  if (typeof value === "string") return JSON.stringify(value);
  // drizzle-orm numeric() requires string defaults — coerce number to quoted string
  if (typeof value === "number") {
    if (colType === "decimal") return JSON.stringify(String(value));
    return String(value);
  }
  if (typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function buildColumnExpression(
  columnName: string,
  resolved: ResolvedProperty,
): string {
  const { builder, refTarget } = inlineToColumnBuilder(
    columnName,
    resolved.inline,
  );
  let expr = builder;
  if (resolved.primaryKey) {
    expr += ".primaryKey()";
    // UUID primary keys need gen_random_uuid() as the DB-level default so
    // INSERT statements that omit `id` (e.g. from the ingest pipeline) work
    // without application-side UUID generation.
    if (resolved.inline.type === "uuid") expr += ".defaultRandom()";
  }
  if (resolved.required) expr += ".notNull()";
  if (resolved.hasDefault) {
    if (
      (resolved.inline.type === "date" || resolved.inline.type === "timestamp") &&
      isDynamicDefaultToken(resolved.defaultValue)
    ) {
      // Dynamic token → DB-level SQL expression (CURRENT_DATE, now(), interval
      // arithmetic). Emit a drizzle sql`` template literally into the generated
      // module so an INSERT that omits the column gets a live value.
      expr += ".default(sql`" + tokenToSqlDefault(resolved.defaultValue, resolved.inline.type) + "`)";
    } else {
      expr += `.default(${formatDefault(resolved.defaultValue, resolved.inline.type)})`;
    }
  }
  if (refTarget) {
    // Use explicit AnyPgColumn return type on all FK lambdas to prevent TS
    // from choking on circular references (e.g. bed ↔ work_trade_agreement).
    expr += `.references((): AnyPgColumn => ${snakeCase(refTarget)}.id)`;
  }
  return expr;
}

interface JoinColumn {
  name: string;
  expr: string;
}

function buildLinkFkColumn(
  columnName: string,
  targetObject: string,
  nullable = false,
): JoinColumn {
  const expr =
    `uuid(${JSON.stringify(columnName)})${nullable ? "" : ".notNull()"}` +
    `.references((): AnyPgColumn => ${snakeCase(targetObject)}.id)`;
  return { name: columnName, expr };
}

const HEADER =
  "// THIS FILE IS GENERATED. DO NOT EDIT.\n" +
  "// Source: lib/codegen/drizzle.ts — regenerate via the ontology codegen pipeline.\n" +
  "\n";

function emitObjectTable(
  typeName: string,
  obj: ObjectType,
  shared: SharedPropertyRegistry,
  inboundLinkFks: JoinColumn[],
): string {
  const tableSnake = snakeCase(typeName);
  const lines: string[] = [];
  const seenColumnNames = new Set<string>();
  for (const [propName, prop] of Object.entries(obj.properties)) {
    const resolved = resolveProperty(prop, shared);
    const expr = buildColumnExpression(propName, resolved);
    lines.push(`  ${propName}: ${expr},`);
    seenColumnNames.add(propName);
  }
  for (const fk of inboundLinkFks) {
    if (seenColumnNames.has(fk.name)) continue;
    lines.push(`  ${fk.name}: ${fk.expr},`);
    seenColumnNames.add(fk.name);
  }
  return (
    `export const ${tableSnake} = pgTable(${JSON.stringify(tableSnake)}, {\n` +
    lines.join("\n") +
    "\n});\n"
  );
}

function emitJoinTable(
  linkName: string,
  link: LinkType,
  shared: SharedPropertyRegistry,
): string {
  const fromSnake = snakeCase(link.from);
  const toSnake = snakeCase(link.to);
  const tableName = `${fromSnake}_${snakeCase(linkName)}_${toSnake}`;

  const isSelf = fromSnake === toSnake;
  const fromCol = isSelf ? `from_${fromSnake}_id` : `${fromSnake}_id`;
  const toCol = isSelf ? `to_${toSnake}_id` : `${toSnake}_id`;

  const fromExpr = buildLinkFkColumn(fromCol, link.from);
  const toExpr = buildLinkFkColumn(toCol, link.to);

  const lines: string[] = [
    `    ${fromExpr.name}: ${fromExpr.expr},`,
    `    ${toExpr.name}: ${toExpr.expr},`,
  ];
  if (link.properties) {
    for (const [propName, prop] of Object.entries(link.properties)) {
      const resolved = resolveProperty(prop, shared);
      const expr = buildColumnExpression(propName, resolved);
      lines.push(`    ${propName}: ${expr},`);
    }
  }
  return (
    `export const ${tableName} = pgTable(\n` +
    `  ${JSON.stringify(tableName)},\n` +
    `  {\n` +
    lines.join("\n") +
    `\n  },\n` +
    `  (t) => [primaryKey({ columns: [t.${fromExpr.name}, t.${toExpr.name}] })],\n` +
    `);\n`
  );
}

interface CardinalLinkPlan {
  manySideObject: string;
  fkColumn: string;
  targetObject: string;
  fkOptional: boolean;
}

function planCardinalLinks(ontology: Ontology): CardinalLinkPlan[] {
  const plans: CardinalLinkPlan[] = [];
  for (const [, link] of Object.entries(ontology.link_types)) {
    if (link.cardinality === "many-to-many") continue;
    if (link.cardinality === "one-to-many") {
      plans.push({
        manySideObject: link.to,
        fkColumn: `${snakeCase(link.from)}_id`,
        targetObject: link.from,
        fkOptional: link.fk_optional ?? false,
      });
    } else if (link.cardinality === "one-to-one") {
      plans.push({
        manySideObject: link.to,
        fkColumn: `${snakeCase(link.from)}_id`,
        targetObject: link.from,
        fkOptional: link.fk_optional ?? false,
      });
    }
  }
  return plans;
}

// Scan the whole ontology (object-type properties AND link-type properties,
// resolving refs via ontology.properties) for any date/timestamp property whose
// default is a dynamic token. If any exist, the generated module needs the
// `sql` import for the emitted `.default(sql`...`)` expressions.
function ontologyUsesSqlDefault(ontology: Ontology): boolean {
  const scanProps = (props: Record<string, PropertyDefinition>): boolean => {
    for (const prop of Object.values(props)) {
      const resolved = resolveProperty(prop, ontology.properties);
      if (
        resolved.hasDefault &&
        (resolved.inline.type === "date" || resolved.inline.type === "timestamp") &&
        isDynamicDefaultToken(resolved.defaultValue)
      ) {
        return true;
      }
    }
    return false;
  };
  for (const obj of Object.values(ontology.object_types)) {
    if (scanProps(obj.properties)) return true;
  }
  for (const link of Object.values(ontology.link_types)) {
    if (link.properties && scanProps(link.properties)) return true;
  }
  return false;
}

export function generateDrizzleModule(ontology: Ontology): string {
  const parts: string[] = [HEADER];
  parts.push(
    'import {\n' +
      '  pgTable,\n' +
      '  boolean,\n' +
      '  date,\n' +
      '  integer,\n' +
      '  numeric,\n' +
      '  primaryKey,\n' +
      '  text,\n' +
      '  timestamp,\n' +
      '  uuid,\n' +
      '  type AnyPgColumn,\n' +
      '} from "drizzle-orm/pg-core";\n',
  );
  if (ontologyUsesSqlDefault(ontology)) {
    parts.push('import { sql } from "drizzle-orm";\n');
  }
  parts.push("\n");

  const cardinalPlans = planCardinalLinks(ontology);
  const inboundByObject = new Map<string, JoinColumn[]>();
  for (const plan of cardinalPlans) {
    const list = inboundByObject.get(plan.manySideObject) ?? [];
    const fk = buildLinkFkColumn(plan.fkColumn, plan.targetObject, plan.fkOptional);
    list.push(fk);
    inboundByObject.set(plan.manySideObject, list);
  }

  parts.push("// === Object types ===\n\n");
  for (const [typeName, obj] of Object.entries(ontology.object_types)) {
    const inbound = inboundByObject.get(typeName) ?? [];
    parts.push(emitObjectTable(typeName, obj, ontology.properties, inbound));
    parts.push("\n");
  }

  const manyToMany = Object.entries(ontology.link_types).filter(
    ([, l]) => l.cardinality === "many-to-many",
  );
  if (manyToMany.length > 0) {
    parts.push("// === Link tables (many-to-many) ===\n\n");
    for (const [linkName, link] of manyToMany) {
      parts.push(emitJoinTable(linkName, link, ontology.properties));
      parts.push("\n");
    }
  }

  // === TABLES registry ===
  // Keyed by PascalCase ontology object-type name → its generated snake_case table variable.
  // Used by the read-only data API to resolve a validated type to its Drizzle table.
  const tableEntries = Object.keys(ontology.object_types)
    .map((typeName) => `  ${typeName}: ${snakeCase(typeName)},`)
    .join("\n");

  parts.push(
    "// Registry of all object-type tables keyed by PascalCase ontology name.\n" +
    "// Generated — used by the read-only data API to resolve a validated type to its table.\n" +
    `export const TABLES = {\n${tableEntries}\n} as const;\n`,
  );

  return parts.join("");
}
