// V2: ReadOnlyDataApi — the single choke-point for world-model reads.
//
// ARCHITECTURE §7 contract: "the view layer consumes a scoped, ontology-typed,
// read-only query interface over the world-model. The agent knows what it can
// query (typed from the ontology); it physically cannot write."
//
// This file is the ONLY place raw SELECT SQL lives for the widget path.
// queryBindings receive a ReadOnlyDataApi, NOT the db handle, so they
// physically cannot call db.insert / db.update / db.delete.
//
// Safety rules (enforced here, not by callers):
//   (a) type validated against CATALOG_VALID_TYPES whitelist → out-of-whitelist
//       returns safe empty, never reaches SQL.
//   (b) columns/fields validated against CATALOG_VALID_FIELDS → unknowns dropped.
//   (c) limit / filter values bound as parameters, never interpolated.
//   (d) SELECT-only — no insert/update/delete anywhere in this file.

import { sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import {
  guest as guestTable,
  member as memberTable,
  booking as bookingTable,
  event as eventTable,
  bed as bedTable,
  room as roomTable,
  shift as shiftTable,
  work_trade_agreement as wtaTable,
} from "@/lib/db/schema.generated";
import {
  CATALOG_VALID_TYPES,
  CATALOG_VALID_FIELDS,
  type CatalogType,
} from "./catalog";

// ── Table map ─────────────────────────────────────────────────────────────────
// Internal only — never exposed on ReadOnlyDataApi.

const TABLE_MAP: Record<CatalogType, typeof guestTable> = {
  guest: guestTable as unknown as typeof guestTable,
  member: memberTable as unknown as typeof guestTable,
  booking: bookingTable as unknown as typeof guestTable,
  event: eventTable as unknown as typeof guestTable,
  bed: bedTable as unknown as typeof guestTable,
  room: roomTable as unknown as typeof guestTable,
  shift: shiftTable as unknown as typeof guestTable,
  work_trade_agreement: wtaTable as unknown as typeof guestTable,
};

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Resolves a type string to a verified CatalogType via the whitelist.
 * Returns null for anything not in the whitelist — caller returns safe empty.
 * This is the single table-name safety chokepoint (previously scattered across
 * individual queryBindings as resolveTableName; now centralised here).
 */
function resolveType(type: string): CatalogType | null {
  if ((CATALOG_VALID_TYPES as readonly string[]).includes(type)) {
    return type as CatalogType;
  }
  return null;
}

/**
 * Filters requested columns to those present in CATALOG_VALID_FIELDS[type].
 * Unknown columns are silently dropped (no injection path).
 */
function safeColumns(type: CatalogType, requested: string[]): string[] {
  const allowed = new Set(CATALOG_VALID_FIELDS[type]);
  return requested.filter((c) => allowed.has(c));
}

// ── ReadOnlyDataApi interface ─────────────────────────────────────────────────
//
// THE TYPE CONTRACT: this interface has NO insert / update / delete / create /
// write / mutation members. A value typed as ReadOnlyDataApi cannot write.

export interface ReadOnlyDataApi {
  /**
   * COUNT(*) for a given ontology type, with an optional field=value filter.
   * Returns 0 for unknown types or invalid filter fields.
   */
  count(
    type: string,
    filter?: { field: string; value: string },
  ): Promise<number>;

  /**
   * SELECT the requested columns from a given ontology type.
   * Unknown columns are dropped; unknown types return empty.
   */
  select(
    type: string,
    opts: { columns: string[]; filter?: { field: string; value: string }; limit?: number },
  ): Promise<{ columns: string[]; rows: Record<string, unknown>[] }>;

  /**
   * SELECT all columns for a given ontology type ordered in DB order.
   * Useful for calendar widgets that bucket results by a date field in-memory.
   * Unknown types or invalid date fields return [].
   */
  byDate(
    type: string,
    dateField: string,
    limit?: number,
  ): Promise<Record<string, unknown>[]>;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates a ReadOnlyDataApi bound to the given db handle.
 * The returned object exposes ONLY read methods — no insert/update/delete/create
 * method exists on it or its type.
 */
export function createReadOnlyDataApi(db: Database): ReadOnlyDataApi {
  return {
    // ── count ──────────────────────────────────────────────────────────────────
    async count(type, filter) {
      const resolved = resolveType(type);
      if (!resolved) return 0;

      if (filter) {
        // Validate filter field against whitelist
        const allowed = new Set(CATALOG_VALID_FIELDS[resolved]);
        if (!allowed.has(filter.field)) return 0;

        // Field name is whitelisted — safe to interpolate as SQL identifier.
        // Filter value is a bound parameter via sql template literal.
        const rows = await db.execute(
          sql`SELECT COUNT(*)::int AS count FROM ${sql.raw(`"${resolved}"`)} WHERE ${sql.raw(`"${filter.field}"`)} = ${filter.value}`,
        ) as Array<{ count: unknown }>;
        const raw = rows[0]?.count;
        return typeof raw === "number" ? raw : Number(raw ?? 0);
      }

      // Unfiltered count — drizzle typed select (no raw SQL needed)
      const table = TABLE_MAP[resolved];
      const rows = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(table) as Array<{ count: unknown }>;
      const raw = rows[0]?.count;
      return typeof raw === "number" ? raw : Number(raw ?? 0);
    },

    // ── select ─────────────────────────────────────────────────────────────────
    async select(type, { columns, filter, limit = 20 }) {
      const resolved = resolveType(type);
      if (!resolved) return { columns: [], rows: [] };

      const validCols = safeColumns(resolved, columns);
      if (validCols.length === 0) return { columns: [], rows: [] };

      const colList = validCols.map((c) => `"${c}"`).join(", ");
      const safeLimit = Math.min(Math.max(1, limit), 500);

      if (filter) {
        const allowed = new Set(CATALOG_VALID_FIELDS[resolved]);
        if (allowed.has(filter.field)) {
          const rows = await db.execute(
            sql`SELECT ${sql.raw(colList)} FROM ${sql.raw(`"${resolved}"`)} WHERE ${sql.raw(`"${filter.field}"`)} = ${filter.value} LIMIT ${safeLimit}`,
          ) as Record<string, unknown>[];
          return { columns: validCols, rows };
        }
        // Invalid filter field — fall through to unfiltered
      }

      const rows = await db.execute(
        sql`SELECT ${sql.raw(colList)} FROM ${sql.raw(`"${resolved}"`)} LIMIT ${safeLimit}`,
      ) as Record<string, unknown>[];
      return { columns: validCols, rows };
    },

    // ── byDate ─────────────────────────────────────────────────────────────────
    async byDate(type, dateField, limit = 50) {
      const resolved = resolveType(type);
      if (!resolved) return [];

      // Validate dateField against whitelist
      const allowed = new Set(CATALOG_VALID_FIELDS[resolved]);
      if (!allowed.has(dateField)) return [];

      const safeLimit = Math.min(Math.max(1, limit), 200);
      const table = TABLE_MAP[resolved];

      // drizzle typed select — no raw column list needed
      const rows = await db
        .select()
        .from(table)
        .limit(safeLimit) as Record<string, unknown>[];

      return rows;
    },
  };
}
