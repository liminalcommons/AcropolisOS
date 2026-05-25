// V1: Widget catalog — typed config schemas + READ-ONLY queryBindings.
//
// THE FENCE (ARCHITECTURE §2/§7): every queryBinding is strictly READ-ONLY.
// The functions below only call db.select(). There are no insert/update/delete
// calls anywhere in this file — the view layer cannot write through the catalog.
//
// Composition over generation: the agent's job is "pick widget kind → supply
// config → the catalog drives the query." No hardcoded data; config drives
// which type and columns are fetched.
//
// VALID_TYPES and VALID_FIELDS mirror the ontology-type enum in
// app/api/organize/classify/route.ts — any change to the ontology enum must
// be reflected here too (they share the same source of truth: schema.generated.ts).

import { z } from "zod";
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
import type { Database } from "@/lib/db/client";
import { sql } from "drizzle-orm";

// ── Ontology type registry ────────────────────────────────────────────────────
//
// Mirrors TARGET_TYPE_ENUM / VALID_FIELDS in classify/route.ts.
// Agent cannot bind a widget to a non-existent type.

export const CATALOG_VALID_TYPES = [
  "guest",
  "member",
  "booking",
  "event",
  "bed",
  "room",
  "shift",
  "work_trade_agreement",
] as const;

export type CatalogType = (typeof CATALOG_VALID_TYPES)[number];

export const CATALOG_VALID_FIELDS: Record<CatalogType, string[]> = {
  guest: ["id", "full_name", "email", "country", "phone", "arrived_at", "expected_departure", "current_status", "is_work_trader", "notes"],
  member: ["id", "full_name", "email", "phone", "tier_role", "started_at", "notes"],
  booking: ["id", "label", "guest", "bed", "from_date", "to_date", "rate_per_night", "currency", "source", "status"],
  event: ["id", "title", "starts_at", "duration_hours", "attendance_cap", "organizer", "description", "status"],
  bed: ["id", "code", "room", "is_bottom_bunk", "out_of_service", "notes"],
  room: ["id", "code", "kind", "capacity", "floor", "notes"],
  shift: ["id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes", "member_id"],
  work_trade_agreement: ["id", "label", "guest", "bed_comp", "hours_per_week", "start_date", "end_date", "status", "notes"],
};

// Table map for dynamic queries — keyed by CatalogType.
// READ-ONLY: used only in .select() calls.
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

// ── Widget kind names ─────────────────────────────────────────────────────────

export const CATALOG_KINDS = [
  "metric",
  "data_table",
  "roster",
  "calendar",
] as const;

export type CatalogKind = (typeof CATALOG_KINDS)[number];

// ── Config schemas ────────────────────────────────────────────────────────────

const CatalogTypeSchema = z.enum(CATALOG_VALID_TYPES);

export const MetricConfigSchema = z.object({
  type: CatalogTypeSchema,
  agg: z.enum(["count"]),
  filter: z
    .object({
      field: z.string(),
      value: z.string(),
    })
    .optional(),
});
export type MetricConfig = z.infer<typeof MetricConfigSchema>;

export const DataTableConfigSchema = z.object({
  type: CatalogTypeSchema,
  columns: z.array(z.string()).min(1),
  limit: z.number().int().min(1).max(500).optional().default(20),
});
export type DataTableConfig = z.infer<typeof DataTableConfigSchema>;

export const RosterConfigSchema = z.object({
  type: CatalogTypeSchema,
  fields: z.array(z.string()).min(1),
  limit: z.number().int().min(1).max(200).optional().default(50),
});
export type RosterConfig = z.infer<typeof RosterConfigSchema>;

export const CalendarConfigSchema = z.object({
  type: z.enum(["event", "booking"]),
  date_field: z.string(),
  limit: z.number().int().min(1).max(200).optional().default(50),
});
export type CalendarConfig = z.infer<typeof CalendarConfigSchema>;

// ── Output types ──────────────────────────────────────────────────────────────

export interface MetricData {
  value: number;
  label: string;
}

export interface DataTableData {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface RosterData {
  fields: string[];
  entries: Record<string, unknown>[];
}

export interface CalendarData {
  date_field: string;
  buckets: Record<string, Record<string, unknown>[]>;
}

// ── Catalog entry type ────────────────────────────────────────────────────────

export interface CatalogEntry<TConfig, TData> {
  configSchema: z.ZodType<TConfig>;
  // READ-ONLY: implementations must only call db.select(). No insert/update/delete.
  queryBinding: (config: TConfig, db: Database) => Promise<TData>;
}

// ── Helper: validate columns against known fields ────────────────────────────

function filterToValidColumns(
  type: CatalogType,
  requestedColumns: string[],
): string[] {
  const allowed = new Set(CATALOG_VALID_FIELDS[type]);
  return requestedColumns.filter((c) => allowed.has(c));
}

// ── In-binding type resolver ──────────────────────────────────────────────────
//
// Resolves config.type to a verified table name string via TABLE_MAP.
// Returns null for any type not in the whitelist — the binding must check and
// return a safe empty result. This is symmetric with filterToValidColumns and
// ensures no caller can inject a SQL identifier via config.type, even if it
// bypassed validateWidgetConfig.

function resolveTableName(type: string): string | null {
  if (!(CATALOG_VALID_TYPES as readonly string[]).includes(type)) {
    return null;
  }
  // type is now a verified CatalogType — safe to use as SQL identifier
  return type as CatalogType;
}

// ── The catalog ───────────────────────────────────────────────────────────────

export const WIDGET_CATALOG: {
  metric: CatalogEntry<MetricConfig, MetricData>;
  data_table: CatalogEntry<DataTableConfig, DataTableData>;
  roster: CatalogEntry<RosterConfig, RosterData>;
  calendar: CatalogEntry<CalendarConfig, CalendarData>;
} = {
  // ── metric ──────────────────────────────────────────────────────────────────
  // Returns a COUNT(*) aggregate for any ontology type with optional filter.
  // READ-ONLY: db.select() + count aggregate only.
  metric: {
    configSchema: MetricConfigSchema,
    queryBinding: async (config, db) => {
      // In-binding type whitelist check — symmetric with filterToValidColumns.
      // Guards against callers that skipped validateWidgetConfig.
      const resolvedType = resolveTableName(config.type);
      if (!resolvedType) {
        return { value: 0, label: `${config.type} (unknown type — rejected)` };
      }

      const table = TABLE_MAP[resolvedType as CatalogType];

      // Build count query — READ-ONLY select
      let countResult: Array<{ count: unknown }>;

      if (config.filter) {
        // Filtered count: WHERE <field> = <value>
        // Use raw SQL for the WHERE clause since columns are dynamic.
        // The field is constrained to CATALOG_VALID_FIELDS (validated at
        // compose_dashboard time), so no injection risk from config.filter.field.
        // config.filter.value is passed as a bound parameter via sql``.
        const validFields = new Set(CATALOG_VALID_FIELDS[resolvedType as CatalogType]);
        const field = validFields.has(config.filter.field)
          ? config.filter.field
          : null;

        if (!field) {
          return { value: 0, label: `${resolvedType} (invalid filter field)` };
        }

        countResult = await db.execute(
          sql`SELECT COUNT(*)::int AS count FROM ${sql.raw(
            `"${resolvedType}"`,
          )} WHERE ${sql.raw(`"${field}"`)} = ${config.filter.value}`,
        ) as Array<{ count: unknown }>;
      } else {
        // Unfiltered count — simplest path
        countResult = await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(table) as Array<{ count: unknown }>;
      }

      const raw = countResult[0]?.count;
      const value = typeof raw === "number" ? raw : Number(raw ?? 0);

      return {
        value,
        label: resolvedType,
      };
    },
  },

  // ── data_table ───────────────────────────────────────────────────────────────
  // Returns live rows of any ontology type with config-specified columns.
  // Uses raw SQL SELECT so column selection is driven by config, not hardcode.
  // READ-ONLY: db.select() equivalent (raw SELECT query, no mutations).
  data_table: {
    configSchema: DataTableConfigSchema,
    queryBinding: async (config, db) => {
      // In-binding type whitelist check — symmetric with filterToValidColumns.
      // Guards against callers that skipped validateWidgetConfig.
      const resolvedType = resolveTableName(config.type);
      if (!resolvedType) {
        return { columns: [], rows: [] };
      }

      // Validate columns against the known field list — filter out unknown fields
      const validColumns = filterToValidColumns(resolvedType as CatalogType, config.columns);
      if (validColumns.length === 0) {
        return { columns: [], rows: [] };
      }

      const limit = config.limit ?? 20;
      const colList = validColumns.map((c) => `"${c}"`).join(", ");

      // READ-ONLY: raw SELECT query against the world-model table
      const rows = await db.execute(
        sql`SELECT ${sql.raw(colList)} FROM ${sql.raw(
          `"${resolvedType}"`,
        )} LIMIT ${limit}`,
      ) as Record<string, unknown>[];

      return {
        columns: validColumns,
        rows: rows as Record<string, unknown>[],
      };
    },
  },

  // ── roster ───────────────────────────────────────────────────────────────────
  // Returns a list of entities with config-specified fields.
  // READ-ONLY: same SELECT-only pattern as data_table.
  roster: {
    configSchema: RosterConfigSchema,
    queryBinding: async (config, db) => {
      // In-binding type whitelist check — symmetric with filterToValidColumns.
      // Guards against callers that skipped validateWidgetConfig.
      const resolvedType = resolveTableName(config.type);
      if (!resolvedType) {
        return { fields: [], entries: [] };
      }

      const validFields = filterToValidColumns(resolvedType as CatalogType, config.fields);
      if (validFields.length === 0) {
        return { fields: [], entries: [] };
      }

      const limit = config.limit ?? 50;
      const colList = validFields.map((c) => `"${c}"`).join(", ");

      // READ-ONLY: raw SELECT query
      const entries = await db.execute(
        sql`SELECT ${sql.raw(colList)} FROM ${sql.raw(
          `"${resolvedType}"`,
        )} LIMIT ${limit}`,
      ) as Record<string, unknown>[];

      return {
        fields: validFields,
        entries: entries as Record<string, unknown>[],
      };
    },
  },

  // ── calendar ─────────────────────────────────────────────────────────────────
  // Returns items bucketed by date for event or booking types.
  // READ-ONLY: db.select() only, buckets built in-memory.
  calendar: {
    configSchema: CalendarConfigSchema,
    queryBinding: async (config, db) => {
      const table = TABLE_MAP[config.type as CatalogType];
      const limit = config.limit ?? 50;

      // Validate date_field is a real field for this type
      const validFields = new Set(CATALOG_VALID_FIELDS[config.type as CatalogType]);
      const dateField = validFields.has(config.date_field)
        ? config.date_field
        : null;

      if (!dateField) {
        return { date_field: config.date_field, buckets: {} };
      }

      // READ-ONLY: select all rows, bucket in-memory by the date field value
      const rows = await db
        .select()
        .from(table)
        .limit(limit) as Record<string, unknown>[];

      const buckets: Record<string, Record<string, unknown>[]> = {};
      for (const row of rows) {
        const raw = row[dateField];
        const key =
          raw instanceof Date
            ? raw.toISOString().slice(0, 10)
            : typeof raw === "string"
              ? raw.slice(0, 10)
              : String(raw ?? "unknown");
        if (!buckets[key]) buckets[key] = [];
        buckets[key].push(row);
      }

      return { date_field: dateField, buckets };
    },
  },
};

// ── Config validation helper (used by compose_dashboard) ─────────────────────
//
// Validates that a widget config is well-formed AND that all column/field
// references point to real fields in the ontology. Returns structured errors
// rather than throwing.

export type ConfigValidationResult =
  | { ok: true; config: MetricConfig | DataTableConfig | RosterConfig | CalendarConfig }
  | { ok: false; error: string; detail?: unknown };

export function validateWidgetConfig(
  kind: CatalogKind,
  rawConfig: unknown,
): ConfigValidationResult {
  const entry = WIDGET_CATALOG[kind];
  const parsed = entry.configSchema.safeParse(rawConfig);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid_config",
      detail: parsed.error.issues,
    };
  }

  const config = parsed.data;

  // Extra check: verify all column/field references are in the ontology
  if (kind === "data_table") {
    const cfg = config as DataTableConfig;
    const badCols = cfg.columns.filter(
      (c) => !CATALOG_VALID_FIELDS[cfg.type]?.includes(c),
    );
    if (badCols.length > 0) {
      return {
        ok: false,
        error: "unknown_columns",
        detail: { type: cfg.type, unknown_columns: badCols },
      };
    }
  }

  if (kind === "roster") {
    const cfg = config as RosterConfig;
    const badFields = cfg.fields.filter(
      (f) => !CATALOG_VALID_FIELDS[cfg.type]?.includes(f),
    );
    if (badFields.length > 0) {
      return {
        ok: false,
        error: "unknown_fields",
        detail: { type: cfg.type, unknown_fields: badFields },
      };
    }
  }

  // For metric with filter, validate filter.field
  if (kind === "metric") {
    const cfg = config as MetricConfig;
    if (cfg.filter) {
      const valid = CATALOG_VALID_FIELDS[cfg.type]?.includes(cfg.filter.field);
      if (!valid) {
        return {
          ok: false,
          error: "unknown_filter_field",
          detail: { type: cfg.type, unknown_field: cfg.filter.field },
        };
      }
    }
  }

  return { ok: true, config };
}
