// REF-LABEL resolution for column-based widgets (data_table / roster).
//
// PROBLEM: a data_table/roster column that is a REF property (FK to another
// object type) carries the target's raw UUID (e.g. bed.room → "b3b21a55-…").
// Raw UUIDs are unreadable. We resolve each ref column's value to the target
// object's human label (its `title_property`, e.g. Room→`code`, Guest→`full_name`).
//
// SECURITY (fail-closed): resolving a ref REVEALS the target's label, so it MUST
// respect the TARGET type's read permission. We reuse the SAME permission-aware
// read path (ReadOnlyDataApi + canReadType) the rows themselves came through —
// no second permission model. If the viewer cannot read the target type, the
// read-api returns `[]` for it (fail-closed, pre-SQL), resolution is skipped, and
// the raw UUID stays in place. No leak: the viewer already sees the FK id because
// they can read the source type.
//
// BATCHED: one fetch per distinct target type (not per row). No N+1.
//
// VALIDATION: the target type must be a CatalogType and the title_property must
// be a whitelisted field on it (CATALOG_VALID_FIELDS) — otherwise the read-api
// would drop it anyway; we skip (leave raw) rather than fetch a column that the
// whitelist would refuse.

import type { Ontology } from "@/lib/ontology/schema";
import type { ReadOnlyDataApi } from "./read-api";
import {
  CATALOG_VALID_TYPES,
  CATALOG_VALID_FIELDS,
  type CatalogType,
} from "./catalog";

// Catalog's lowercase/snake type ↔ ontology PascalCase object-type name.
// read-api owns CATALOG_TYPE_TO_OBJECT_TYPE (name→catalog is the forward map);
// here we need the INVERSE (ontology object-type name → catalog type) so we can
// take a ref's `target` (PascalCase, e.g. "Room") back to the read-api's catalog
// type (e.g. "room"). Derived once from CATALOG_VALID_TYPES so it stays in sync:
// catalog types are snake_case; object-type names are PascalCase of the segments.
function snakeToPascal(snake: string): string {
  return snake
    .split("_")
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join("");
}

const OBJECT_TYPE_TO_CATALOG_TYPE: Record<string, CatalogType> = Object.fromEntries(
  CATALOG_VALID_TYPES.map((ct) => [snakeToPascal(ct), ct]),
) as Record<string, CatalogType>;

// A ref column on the source type that we can attempt to resolve.
interface RefColumn {
  /** the column on the source rows whose value is a target UUID */
  column: string;
  /** the target catalog type (e.g. "room") to fetch labels from */
  targetCatalogType: CatalogType;
  /** the target's title property / label field (e.g. "code") */
  titleProp: string;
}

/**
 * From the ontology, find which of `columns` are REF properties on the source
 * object type whose target is (a) a known catalog type and (b) has a
 * title_property that is itself a whitelisted, queryable field. Returns the
 * resolvable ref columns; non-ref columns and unresolvable refs are omitted
 * (their values stay raw).
 */
function refColumnsFor(
  sourceCatalogType: CatalogType,
  columns: string[],
  ontology: Ontology,
): RefColumn[] {
  const sourceObjectTypeName = snakeToPascal(sourceCatalogType);
  const sourceDef = ontology.object_types[sourceObjectTypeName];
  if (!sourceDef) return [];

  const out: RefColumn[] = [];
  for (const column of columns) {
    const prop = sourceDef.properties[column];
    // Inline ref properties have { type: "ref", target }. PropertyReference
    // ({ ref }) entries are shared-registry scalars (email/country/phone) —
    // never refs to object types — so the `"type" in prop` guard filters them.
    if (!prop || !("type" in prop) || prop.type !== "ref") continue;

    const targetCatalogType = OBJECT_TYPE_TO_CATALOG_TYPE[prop.target];
    // Target not a known catalog type → cannot fetch via read-api → leave raw.
    if (!targetCatalogType) continue;

    const targetDef = ontology.object_types[prop.target];
    const titleProp = targetDef?.title_property;
    // No title_property → nothing to resolve to → leave raw.
    if (!titleProp) continue;

    // The title field must be whitelisted/queryable on the target type, else
    // the read-api would drop it. Guard here so we never fetch a doomed column.
    if (!CATALOG_VALID_FIELDS[targetCatalogType]?.includes(titleProp)) continue;
    // The id field must also be queryable (it is for every type) — defensive.
    if (!CATALOG_VALID_FIELDS[targetCatalogType]?.includes("id")) continue;

    out.push({ column, targetCatalogType, titleProp });
  }
  return out;
}

/**
 * Resolve REF-column UUIDs in `rows` to their target objects' labels.
 *
 * @param rows               the source widget rows (mutated copies returned)
 * @param sourceCatalogType  the source widget's catalog type (e.g. "bed")
 * @param columns            the columns present in the widget (data_table.columns
 *                           or roster.fields)
 * @param ontology           the loaded ontology (ref/title metadata)
 * @param api                the SAME permission-aware ReadOnlyDataApi the rows
 *                           came through (built with the viewer's canReadType)
 * @returns new row objects with ref columns rewritten to labels where permitted;
 *          raw UUID retained for unreadable / unresolvable targets.
 *
 * Fail-closed: for each ref column, we ask the api for the target's
 * (id, title_property). If the viewer cannot read the target type, the api
 * returns `[]` → no id→label map → the column is left as the raw UUID.
 */
export async function resolveRefLabels(
  rows: Record<string, unknown>[],
  sourceCatalogType: string,
  columns: string[],
  ontology: Ontology,
  api: ReadOnlyDataApi,
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return rows;
  if (!(CATALOG_VALID_TYPES as readonly string[]).includes(sourceCatalogType)) {
    return rows;
  }
  const source = sourceCatalogType as CatalogType;

  const refCols = refColumnsFor(source, columns, ontology);
  if (refCols.length === 0) return rows;

  // For each resolvable ref column, build an id→label map.
  // labelMaps: column → Map<uuid, label>
  const labelMaps = new Map<string, Map<string, string>>();

  // Collect distinct referenced ids PER TARGET TYPE across ALL columns pointing
  // at that target. This allows a single fetch per target type that covers every
  // column referencing it, with no 500-row ceiling and no over-fetch (we request
  // exactly the ids present in the current row set).
  const idsByTarget = new Map<CatalogType, Set<string>>();
  const titlePropByTarget = new Map<CatalogType, string>();

  for (const ref of refCols) {
    if (!idsByTarget.has(ref.targetCatalogType)) {
      idsByTarget.set(ref.targetCatalogType, new Set<string>());
      // title_property is a property of the TARGET type — it is the same for
      // every column that references that target, so storing it once is correct.
      titlePropByTarget.set(ref.targetCatalogType, ref.titleProp);
    }
    const idSet = idsByTarget.get(ref.targetCatalogType)!;
    for (const row of rows) {
      const v = row[ref.column];
      if (typeof v === "string" && v.length > 0) idSet.add(v);
    }
  }

  // One fetch per distinct target type with EXACTLY the referenced ids.
  // PERMISSION-AWARE: api.selectByIds is gated by the viewer's canReadType
  // (fail-closed, pre-SQL) — same gate as api.select. Unauthorized target →
  // { columns: [], rows: [] } → empty map → labels left raw. No fetch leak.
  const fetchedByTarget = new Map<CatalogType, Map<string, string>>();

  for (const [targetCatalogType, idSet] of idsByTarget) {
    if (idSet.size === 0) {
      fetchedByTarget.set(targetCatalogType, new Map());
      continue;
    }
    const titleProp = titlePropByTarget.get(targetCatalogType)!;
    const result = await api.selectByIds(
      targetCatalogType,
      [...idSet],
      ["id", titleProp],
    );
    const idToLabel = new Map<string, string>();
    // If title column was dropped or read was denied, rows is empty → map stays sparse.
    for (const trow of result.rows) {
      const id = trow.id;
      const label = trow[titleProp];
      if (typeof id === "string" && id.length > 0 && label != null) {
        idToLabel.set(id, String(label));
      }
    }
    fetchedByTarget.set(targetCatalogType, idToLabel);
  }

  for (const ref of refCols) {
    const idToLabel = fetchedByTarget.get(ref.targetCatalogType);
    if (idToLabel) labelMaps.set(ref.column, idToLabel);
  }

  if (labelMaps.size === 0) return rows;

  // Rewrite: produce new row objects (don't mutate the inputs). Only ref columns
  // with a hit in the label map are rewritten; misses (unreadable target, or an
  // id with no matching target row) keep the raw UUID — fail-closed by default.
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const [column, idToLabel] of labelMaps) {
      const v = out[column];
      if (typeof v === "string") {
        const label = idToLabel.get(v);
        if (label !== undefined) out[column] = label;
      }
    }
    return out;
  });
}
