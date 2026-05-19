// seed-from-bundle.ts — load a seed bundle's data/*.json into Postgres,
// validated against the bundle's ontology YAML.
//
// Usage:
//   tsx scripts/seed-from-bundle.ts <bundle-name> [--dry-run] [--insert]
//
// Default mode is --dry-run: parse the ontology, parse each data file, and
// report any drift (missing required props, unknown enum values, dangling
// refs) without touching the database. Pass --insert to actually write rows.
//
// The bundle is expected at:
//   packages/acropolisos/seed/<bundle-name>/{properties,roles,link-types}.yaml
//   packages/acropolisos/seed/<bundle-name>/{object-types,action-types}/*.yaml
//   packages/acropolisos/seed/<bundle-name>/data/*.json
//
// Each data file is named for the object type it represents
// (e.g. member.json -> object_types.Member) OR a link type (e.g. attended.json).
// File names are matched case-insensitively after snake-casing the type name.
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadOntology } from "../lib/ontology/load";
import type {
  InlineProperty,
  LinkType,
  ObjectType,
  Ontology,
  PropertyDefinition,
  SharedPropertyRegistry,
} from "../lib/ontology/schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface DataFile {
  filePath: string;
  basename: string;       // e.g. "member"
  rows: Record<string, unknown>[];
}

interface ResolvedProp {
  inline: InlineProperty;
  required: boolean;
  hasDefault: boolean;
}

interface Violation {
  file: string;
  row: number | string;
  field?: string;
  message: string;
}

function snakeCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function isPropRef(
  prop: PropertyDefinition,
): prop is Extract<PropertyDefinition, { ref: string }> {
  return "ref" in prop;
}

function resolveProperty(
  prop: PropertyDefinition,
  shared: SharedPropertyRegistry,
): ResolvedProp {
  if (isPropRef(prop)) {
    const target = shared[prop.ref];
    if (!target) {
      throw new Error(`shared property "${prop.ref}" not found in registry`);
    }
    return {
      inline: target,
      required: prop.required ?? true,
      hasDefault: "default" in target && target.default !== undefined,
    };
  }
  return {
    inline: prop,
    required: prop.required ?? true,
    hasDefault: "default" in prop && prop.default !== undefined,
  };
}

async function readDataDir(bundleRoot: string): Promise<DataFile[]> {
  const dataDir = path.join(bundleRoot, "data");
  let names: string[];
  try {
    names = await readdir(dataDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
  const out: DataFile[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const filePath = path.join(dataDir, name);
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`${filePath}: expected JSON array at root`);
    }
    out.push({
      filePath,
      basename: name.replace(/\.json$/, ""),
      rows: parsed,
    });
  }
  return out;
}

// Match a data file basename to an ontology object type or link type by
// snake-casing both sides. Returns the matched key, or null.
function matchOntologyKey(
  basename: string,
  candidates: string[],
): string | null {
  const target = snakeCase(basename);
  for (const c of candidates) {
    if (snakeCase(c) === target) return c;
  }
  return null;
}

function validateRow(
  row: Record<string, unknown>,
  rowIndex: number,
  filePath: string,
  props: Record<string, PropertyDefinition>,
  shared: SharedPropertyRegistry,
  knownIdsByType: Map<string, Set<string>>,
  violations: Violation[],
): void {
  // Required + type checks per declared property
  for (const [name, propDef] of Object.entries(props)) {
    const resolved = resolveProperty(propDef, shared);
    const present = name in row;
    const value = row[name];

    if (!present || value === undefined || value === null) {
      if (resolved.required && !resolved.hasDefault) {
        violations.push({
          file: filePath,
          row: rowIndex,
          field: name,
          message: "required property missing/null",
        });
      }
      continue;
    }

    const inline = resolved.inline;
    switch (inline.type) {
      case "enum": {
        const allowed = inline.values;
        if (!allowed.includes(String(value))) {
          violations.push({
            file: filePath,
            row: rowIndex,
            field: name,
            message: `enum value ${JSON.stringify(value)} not in [${allowed.join(", ")}]`,
          });
        }
        break;
      }
      case "ref": {
        const target = inline.target;
        const ids = knownIdsByType.get(target);
        if (!ids) {
          violations.push({
            file: filePath,
            row: rowIndex,
            field: name,
            message: `ref target object type "${target}" has no data file loaded`,
          });
          break;
        }
        if (!ids.has(String(value))) {
          violations.push({
            file: filePath,
            row: rowIndex,
            field: name,
            message: `ref to ${target} id="${value}" — id not found among loaded ${target} rows`,
          });
        }
        break;
      }
      case "uuid":
      case "string":
      case "email":
        if (typeof value !== "string") {
          violations.push({
            file: filePath,
            row: rowIndex,
            field: name,
            message: `expected string for type=${inline.type}, got ${typeof value}`,
          });
        }
        break;
      case "date":
      case "timestamp":
        if (typeof value !== "string") {
          violations.push({
            file: filePath,
            row: rowIndex,
            field: name,
            message: `expected ISO ${inline.type} string, got ${typeof value}`,
          });
        }
        break;
      case "integer":
      case "decimal":
        if (typeof value !== "number") {
          violations.push({
            file: filePath,
            row: rowIndex,
            field: name,
            message: `expected number for type=${inline.type}, got ${typeof value}`,
          });
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") {
          violations.push({
            file: filePath,
            row: rowIndex,
            field: name,
            message: `expected boolean, got ${typeof value}`,
          });
        }
        break;
    }
  }

  // Unknown fields (not declared in ontology)
  for (const key of Object.keys(row)) {
    if (!(key in props)) {
      violations.push({
        file: filePath,
        row: rowIndex,
        field: key,
        message: `field not declared in ontology (will be ignored on insert)`,
      });
    }
  }
}

interface AuditResult {
  bundle: string;
  objectTypeCounts: Record<string, number>;
  linkTypeCounts: Record<string, number>;
  violations: Violation[];
  unmatched: string[]; // data files that didn't map to any ontology type
}

async function auditBundle(bundleName: string): Promise<AuditResult> {
  const pkgRoot = path.resolve(__dirname, "..");
  const bundleRoot = path.join(pkgRoot, "seed", bundleName);
  const ontology: Ontology = await loadOntology(bundleRoot);
  const dataFiles = await readDataDir(bundleRoot);

  const violations: Violation[] = [];
  const objectTypeCounts: Record<string, number> = {};
  const linkTypeCounts: Record<string, number> = {};
  const unmatched: string[] = [];

  // First pass: collect ids per object type so refs can be checked
  // (assumes "id" is the primary key field across all object types).
  const knownIdsByType = new Map<string, Set<string>>();
  for (const file of dataFiles) {
    const objectTypeKey = matchOntologyKey(
      file.basename,
      Object.keys(ontology.object_types),
    );
    if (!objectTypeKey) continue;
    const ids = new Set<string>();
    for (const row of file.rows) {
      const id = (row as { id?: unknown }).id;
      if (typeof id === "string") ids.add(id);
    }
    knownIdsByType.set(objectTypeKey, ids);
  }

  // Second pass: per-row validation
  for (const file of dataFiles) {
    const objectTypeKey = matchOntologyKey(
      file.basename,
      Object.keys(ontology.object_types),
    );
    if (objectTypeKey) {
      const ot = ontology.object_types[objectTypeKey];
      objectTypeCounts[objectTypeKey] = file.rows.length;
      for (let i = 0; i < file.rows.length; i++) {
        validateRow(
          file.rows[i] as Record<string, unknown>,
          i,
          file.filePath,
          ot.properties,
          ontology.properties,
          knownIdsByType,
          violations,
        );
      }
      continue;
    }

    const linkTypeKey = matchOntologyKey(
      file.basename,
      Object.keys(ontology.link_types),
    );
    if (linkTypeKey) {
      const lt = ontology.link_types[linkTypeKey];
      linkTypeCounts[linkTypeKey] = file.rows.length;
      // Link rows are validated as a virtual property map: {from-end, to-end, ...props}
      // We don't enforce schema here yet — that comes when we build the actual
      // junction-table insert. For now just check that referenced ids exist.
      for (let i = 0; i < file.rows.length; i++) {
        const row = file.rows[i] as Record<string, unknown>;
        for (const [key, value] of Object.entries(row)) {
          // Heuristic: any string field whose name matches a known object-type
          // (lowercased) is treated as a ref to that type.
          const matchedType = matchOntologyKey(
            key,
            Object.keys(ontology.object_types),
          );
          if (matchedType && typeof value === "string") {
            const ids = knownIdsByType.get(matchedType);
            if (ids && !ids.has(value)) {
              violations.push({
                file: file.filePath,
                row: i,
                field: key,
                message: `link refers to ${matchedType} id="${value}" not present in loaded ${matchedType} rows`,
              });
            }
          }
        }
      }
      continue;
    }

    unmatched.push(file.basename);
  }

  return {
    bundle: bundleName,
    objectTypeCounts,
    linkTypeCounts,
    violations,
    unmatched,
  };
}

function printReport(result: AuditResult): void {
  const out = process.stdout;
  out.write(`\n=== Bundle: ${result.bundle} ===\n\n`);

  out.write("Object types loaded from data/:\n");
  for (const [type, count] of Object.entries(result.objectTypeCounts).sort()) {
    out.write(`  ${type.padEnd(28)} ${count} rows\n`);
  }
  if (Object.keys(result.linkTypeCounts).length > 0) {
    out.write("\nLink types loaded from data/:\n");
    for (const [type, count] of Object.entries(result.linkTypeCounts).sort()) {
      out.write(`  ${type.padEnd(28)} ${count} rows\n`);
    }
  }

  if (result.unmatched.length > 0) {
    out.write("\nData files with no matching ontology type:\n");
    for (const name of result.unmatched) {
      out.write(`  ${name}.json\n`);
    }
  }

  if (result.violations.length === 0) {
    out.write("\n✓ No integrity violations found.\n");
    return;
  }

  out.write(`\n✗ ${result.violations.length} integrity violations:\n`);
  // Group by file → row for readability
  const byFile = new Map<string, Violation[]>();
  for (const v of result.violations) {
    const key = path.basename(v.file);
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)!.push(v);
  }
  for (const [file, vs] of byFile) {
    out.write(`\n  ${file} (${vs.length}):\n`);
    for (const v of vs.slice(0, 20)) {
      const field = v.field ? `.${v.field}` : "";
      out.write(`    [row ${v.row}${field}] ${v.message}\n`);
    }
    if (vs.length > 20) {
      out.write(`    ... and ${vs.length - 20} more in this file\n`);
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const bundleName = argv.find((a) => !a.startsWith("--"));
  const insert = argv.includes("--insert");

  if (!bundleName) {
    process.stderr.write(
      "usage: tsx scripts/seed-from-bundle.ts <bundle-name> [--insert]\n",
    );
    process.exit(2);
  }

  const result = await auditBundle(bundleName);
  printReport(result);

  if (insert) {
    process.stderr.write(
      "\n--insert not yet implemented. Dry-run is the current default.\n",
    );
    process.exit(result.violations.length === 0 ? 0 : 1);
  }

  process.exit(result.violations.length === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(2);
});
