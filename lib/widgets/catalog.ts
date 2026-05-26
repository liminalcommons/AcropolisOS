// V2: Widget catalog — typed config schemas + READ-ONLY queryBindings.
//
// THE FENCE (ARCHITECTURE §2/§7): every queryBinding is strictly READ-ONLY.
// queryBindings receive a ReadOnlyDataApi, NOT the raw db handle — they
// physically cannot call db.insert/update/delete. Raw SQL lives exclusively
// in lib/widgets/read-api.ts behind the type+field whitelists.
//
// Composition over generation: the agent's job is "pick widget kind → supply
// config → the catalog drives the query." No hardcoded data; config drives
// which type and columns are fetched.
//
// VALID_TYPES and VALID_FIELDS mirror the ontology-type enum in
// app/api/organize/classify/route.ts — any change to the ontology enum must
// be reflected here too (they share the same source of truth: schema.generated.ts).

import { z } from "zod";
import type { ReadOnlyDataApi } from "./read-api";

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
  "agent_blocker",
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
  agent_blocker: ["id", "summary", "reason_kind", "blocked_actor_id", "status", "resolution_mode", "created_at", "blocked_work_ref", "detail", "pathways", "confirm_action"],
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
  filter: z
    .object({
      field: z.string(),
      value: z.string(),
    })
    .optional(),
  limit: z.number().int().min(1).max(500).optional().default(20),
  // Opt-in: when true, the renderer derives one-click row actions for this
  // type from the ontology (oneClickRowActionsForType) and shows an Actions
  // cell per row. Generic data_tables omit it → unchanged (no Actions column).
  row_actions: z.boolean().optional(),
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
  // READ-ONLY: implementations receive a ReadOnlyDataApi — no mutation method
  // exists on the type. Raw SQL lives in read-api.ts behind the whitelists.
  queryBinding: (config: TConfig, api: ReadOnlyDataApi) => Promise<TData>;
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
  // READ-ONLY: delegates to api.count() — no raw SQL, no db handle.
  metric: {
    configSchema: MetricConfigSchema,
    queryBinding: async (config, api) => {
      // api.count() validates type against CATALOG_VALID_TYPES whitelist and
      // the filter field against CATALOG_VALID_FIELDS — returns 0 for unknowns.
      const value = await api.count(config.type, config.filter);
      // Distinguish unknown type from valid-type-zero-count via type check:
      // resolveTableName would return null for unknowns → api.count returns 0.
      // For label signaling, check whitelist inline (no SQL).
      const isKnown = (CATALOG_VALID_TYPES as readonly string[]).includes(config.type);
      if (!isKnown) {
        return { value: 0, label: `${config.type} (unknown type — rejected)` };
      }
      return { value, label: config.type };
    },
  },

  // ── data_table ───────────────────────────────────────────────────────────────
  // Returns live rows of any ontology type with config-specified columns.
  // READ-ONLY: delegates to api.select() — no raw SQL, no db handle.
  data_table: {
    configSchema: DataTableConfigSchema,
    queryBinding: async (config, api) => {
      // api.select() validates type + columns against whitelists internally,
      // and validates+parameterizes the optional filter (field whitelist + bound value).
      return api.select(config.type, {
        columns: config.columns,
        filter: config.filter,
        limit: config.limit ?? 20,
      });
    },
  },

  // ── roster ───────────────────────────────────────────────────────────────────
  // Returns a list of entities with config-specified fields.
  // READ-ONLY: delegates to api.select() — no raw SQL, no db handle.
  roster: {
    configSchema: RosterConfigSchema,
    queryBinding: async (config, api) => {
      // api.select() validates type + columns against whitelists internally.
      // Roster uses "fields" terminology; api.select uses "columns" — same concept.
      const result = await api.select(config.type, {
        columns: config.fields,
        limit: config.limit ?? 50,
      });
      return {
        fields: result.columns,
        entries: result.rows,
      };
    },
  },

  // ── calendar ─────────────────────────────────────────────────────────────────
  // Returns items bucketed by date for event or booking types.
  // READ-ONLY: delegates to api.byDate() — no raw SQL, no db handle.
  calendar: {
    configSchema: CalendarConfigSchema,
    queryBinding: async (config, api) => {
      // api.byDate() validates type and dateField against whitelists internally.
      const rows = await api.byDate(
        config.type,
        config.date_field,
        config.limit ?? 50,
      );

      if (rows.length === 0) {
        return { date_field: config.date_field, buckets: {} };
      }

      // Bucket in-memory by the date field value
      const buckets: Record<string, Record<string, unknown>[]> = {};
      for (const row of rows) {
        const raw = row[config.date_field];
        const key =
          raw instanceof Date
            ? raw.toISOString().slice(0, 10)
            : typeof raw === "string"
              ? raw.slice(0, 10)
              : String(raw ?? "unknown");
        if (!buckets[key]) buckets[key] = [];
        buckets[key].push(row);
      }

      return { date_field: config.date_field, buckets };
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
    // Optional filter field must reference a real ontology field (mirrors metric).
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
