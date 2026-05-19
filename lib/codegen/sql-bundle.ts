// Emit raw SQL DDL + DML for a seed bundle into a namespaced Postgres schema.
// Domain-agnostic: works for any ontology (small-community, permaculture-org,
// hostel, future bundles). The schema name is the only thing per-bundle.
//
// Output:
//   CREATE SCHEMA IF NOT EXISTS <schema>;
//   CREATE TABLE <schema>.<object_type_snake> (...);
//   CREATE TABLE <schema>.<link_table_name> (...);
//   INSERT INTO <schema>.<object_type_snake> (...) VALUES (...);
//   ...
//
// Used by scripts/seed-from-bundle.ts to materialize a bundle's ontology and
// rows into Postgres without touching the live small-community schema.
import type {
  InlineProperty,
  LinkType,
  ObjectType,
  Ontology,
  PropertyDefinition,
  SharedPropertyRegistry,
} from "../ontology/schema";

export function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function isPropRef(
  prop: PropertyDefinition,
): prop is Extract<PropertyDefinition, { ref: string }> {
  return "ref" in prop;
}

interface Resolved {
  inline: InlineProperty;
  required: boolean;
  primaryKey: boolean;
  hasDefault: boolean;
  defaultValue: unknown;
}

function resolve(
  prop: PropertyDefinition,
  shared: SharedPropertyRegistry,
): Resolved {
  if (isPropRef(prop)) {
    const target = shared[prop.ref];
    if (!target) throw new Error(`shared property "${prop.ref}" not found`);
    return {
      inline: target,
      required: prop.required ?? true,
      primaryKey: prop.primary_key ?? target.primary_key ?? false,
      hasDefault: "default" in target && target.default !== undefined,
      defaultValue: "default" in target ? target.default : undefined,
    };
  }
  return {
    inline: prop,
    required: prop.required ?? true,
    primaryKey: prop.primary_key ?? false,
    hasDefault: "default" in prop && prop.default !== undefined,
    defaultValue: "default" in prop ? prop.default : undefined,
  };
}

function pgType(inline: InlineProperty): string {
  switch (inline.type) {
    // Seed bundles use human-readable IDs ("m-001", "g-012") not real UUIDs.
    // Storing as text keeps Postgres happy without forcing a 50+ row mass-edit
    // of every seed data file. The canonical schema (lib/db/schema.generated.ts)
    // still uses real uuid columns for non-seed code paths.
    case "uuid":
      return "text";
    case "string":
    case "email":
    case "enum":
      return "text";
    case "date":
      return "date";
    case "timestamp":
      return "timestamptz";
    case "integer":
      return "integer";
    case "decimal":
      return "numeric";
    case "boolean":
      return "boolean";
    case "ref":
      return "text";
  }
}

function sqlLiteral(value: unknown, inline: InlineProperty): string {
  if (value === null || value === undefined) return "NULL";
  switch (inline.type) {
    case "boolean":
      return value ? "TRUE" : "FALSE";
    case "integer":
    case "decimal":
      return String(value);
    case "uuid":
    case "string":
    case "email":
    case "enum":
    case "date":
    case "timestamp":
    case "ref":
      return `'${String(value).replace(/'/g, "''")}'`;
  }
}

function quoteIdent(name: string): string {
  // Postgres lowercase-folds unquoted identifiers; safe to leave bare for
  // snake_case keys, but quote anything that could collide with a reserved word.
  return `"${name}"`;
}

export interface BundleSqlOptions {
  /** Schema (namespace) to create and load into, e.g. "perm", "hostel". */
  schema: string;
  /** If true, prepend DROP SCHEMA <schema> CASCADE for idempotent reload. */
  dropFirst?: boolean;
}

export interface BundleData {
  /** Map of object-type-name → array of row objects keyed by property name. */
  objects: Record<string, Record<string, unknown>[]>;
  /** Map of link-type-name → array of link rows ({from-id, to-id, ...props}). */
  links: Record<string, Record<string, unknown>[]>;
}

interface Plan {
  schema: string;
  ontology: Ontology;
  data: BundleData;
  options: BundleSqlOptions;
}

function emitDDL(plan: Plan): string {
  const out: string[] = [];
  const { schema, ontology, options } = plan;
  if (options.dropFirst) {
    out.push(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE;`);
  }
  out.push(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)};`);
  out.push("");

  // Object tables first
  for (const [typeName, ot] of Object.entries(ontology.object_types)) {
    const tableName = `${quoteIdent(schema)}.${quoteIdent(snakeCase(typeName))}`;
    const colDefs: string[] = [];
    const pkCols: string[] = [];
    for (const [propName, propDef] of Object.entries(ot.properties)) {
      const r = resolve(propDef, ontology.properties);
      const col = quoteIdent(propName);
      const type = pgType(r.inline);
      const parts = [col, type];
      if (r.required && !r.primaryKey) parts.push("NOT NULL");
      if (r.hasDefault && r.defaultValue !== undefined) {
        parts.push(`DEFAULT ${sqlLiteral(r.defaultValue, r.inline)}`);
      }
      // No FK constraints in DDL — order-of-insert + cross-table self-refs make
      // FKs awkward to enforce at load time. The loader pre-validates refs.
      colDefs.push("  " + parts.join(" "));
      if (r.primaryKey) pkCols.push(col);
    }
    if (pkCols.length > 0) {
      colDefs.push(`  PRIMARY KEY (${pkCols.join(", ")})`);
    }
    out.push(`CREATE TABLE ${tableName} (`);
    out.push(colDefs.join(",\n"));
    out.push(`);`);
    out.push("");
  }

  // Link (junction) tables
  for (const [linkName, link] of Object.entries(ontology.link_types)) {
    const fromSnake = snakeCase(link.from);
    const toSnake = snakeCase(link.to);
    const tableSnake = `${fromSnake}_${snakeCase(linkName)}_${toSnake}`;
    const tableName = `${quoteIdent(schema)}.${quoteIdent(tableSnake)}`;
    const isSelf = fromSnake === toSnake;
    const fromCol = isSelf ? `from_${fromSnake}_id` : `${fromSnake}_id`;
    const toCol = isSelf ? `to_${toSnake}_id` : `${toSnake}_id`;

    const colDefs: string[] = [
      `  ${quoteIdent(fromCol)} text NOT NULL`,
      `  ${quoteIdent(toCol)} text NOT NULL`,
    ];
    if (link.properties) {
      for (const [propName, propDef] of Object.entries(link.properties)) {
        const r = resolve(propDef, ontology.properties);
        const parts = [quoteIdent(propName), pgType(r.inline)];
        if (r.required) parts.push("NOT NULL");
        if (r.hasDefault && r.defaultValue !== undefined) {
          parts.push(`DEFAULT ${sqlLiteral(r.defaultValue, r.inline)}`);
        }
        colDefs.push("  " + parts.join(" "));
      }
    }
    colDefs.push(`  PRIMARY KEY (${quoteIdent(fromCol)}, ${quoteIdent(toCol)})`);
    out.push(`CREATE TABLE ${tableName} (`);
    out.push(colDefs.join(",\n"));
    out.push(`);`);
    out.push("");
  }
  return out.join("\n");
}

function emitDML(plan: Plan): string {
  const out: string[] = [];
  const { schema, ontology, data } = plan;

  // Object rows
  for (const [typeName, ot] of Object.entries(ontology.object_types)) {
    const rows = data.objects[typeName] ?? [];
    if (rows.length === 0) continue;
    const tableName = `${quoteIdent(schema)}.${quoteIdent(snakeCase(typeName))}`;
    const propNames = Object.keys(ot.properties);

    for (const row of rows) {
      const colsUsed: string[] = [];
      const vals: string[] = [];
      for (const propName of propNames) {
        if (!(propName in row)) continue;
        const propDef = ot.properties[propName];
        const r = resolve(propDef, ontology.properties);
        colsUsed.push(quoteIdent(propName));
        vals.push(sqlLiteral(row[propName], r.inline));
      }
      out.push(
        `INSERT INTO ${tableName} (${colsUsed.join(", ")}) VALUES (${vals.join(", ")});`,
      );
    }
    out.push("");
  }

  // Link rows
  for (const [linkName, link] of Object.entries(ontology.link_types)) {
    const rows = data.links[linkName] ?? [];
    if (rows.length === 0) continue;
    const fromSnake = snakeCase(link.from);
    const toSnake = snakeCase(link.to);
    const tableSnake = `${fromSnake}_${snakeCase(linkName)}_${toSnake}`;
    const tableName = `${quoteIdent(schema)}.${quoteIdent(tableSnake)}`;
    const isSelf = fromSnake === toSnake;
    const fromCol = isSelf ? `from_${fromSnake}_id` : `${fromSnake}_id`;
    const toCol = isSelf ? `to_${toSnake}_id` : `${toSnake}_id`;

    // Link rows can carry either:
    //   {member: "m-001", work_party: "wp-001", hours: 4}  (named by type)
    //   {from: "m-001", to: "wp-001"}                       (generic)
    // Resolve by lowercased object-type name match.
    const fromKey = fromSnake;
    const toKey = toSnake;

    for (const row of rows) {
      let fromVal: unknown = row[fromKey];
      let toVal: unknown = row[toKey];
      if (fromVal === undefined) fromVal = row.from;
      if (toVal === undefined) toVal = row.to;

      const cols: string[] = [quoteIdent(fromCol), quoteIdent(toCol)];
      const vals: string[] = [
        sqlLiteral(fromVal, { type: "uuid" } as InlineProperty),
        sqlLiteral(toVal, { type: "uuid" } as InlineProperty),
      ];
      if (link.properties) {
        for (const [propName, propDef] of Object.entries(link.properties)) {
          if (!(propName in row)) continue;
          const r = resolve(propDef, ontology.properties);
          cols.push(quoteIdent(propName));
          vals.push(sqlLiteral(row[propName], r.inline));
        }
      }
      out.push(
        `INSERT INTO ${tableName} (${cols.join(", ")}) VALUES (${vals.join(", ")});`,
      );
    }
    out.push("");
  }
  return out.join("\n");
}

export function emitBundleSql(
  ontology: Ontology,
  data: BundleData,
  options: BundleSqlOptions,
): { ddl: string; dml: string; combined: string } {
  const plan: Plan = { schema: options.schema, ontology, data, options };
  const ddl = emitDDL(plan);
  const dml = emitDML(plan);
  const combined =
    `-- emit-bundle-sql for schema "${options.schema}"\n` +
    `-- generated ${new Date().toISOString()}\n\n` +
    `BEGIN;\n\n${ddl}\n${dml}\nCOMMIT;\n`;
  return { ddl, dml, combined };
}
