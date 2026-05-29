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
// CatalogType is a plain `string`: the SET of valid types is NOT a compile-time
// literal — it is derived at runtime from the LOADED ontology (deriveVocabulary)
// and enforced as a MEMBERSHIP gate inside validateWidgetConfig + the read-api
// fence. This is what makes the catalog a projection of WHATEVER ontology is
// loaded (any org's types work), with zero hostel literals.

import { z } from "zod";
import type { ReadOnlyDataApi } from "./read-api";
import type { Ontology } from "@/lib/ontology/schema";
import { deriveVocabulary } from "./vocabulary";
import {
  scenarioAcceptanceRate,
  decisionLatencyMsMedian,
  coordinationCoverage,
  resolutionAccuracy,
  type MetricBlockerRow,
} from "@/lib/metrics/community-intelligence";

// ── Catalog type ──────────────────────────────────────────────────────────────
//
// A catalog type is a snake_case token naming an ontology object type. The set of
// valid tokens is ontology-derived (deriveVocabulary().validTypes), not a fixed
// union — so `CatalogType` is just `string`; membership is enforced at runtime.

export type CatalogType = string;

// ── Widget kind names ─────────────────────────────────────────────────────────

export const CATALOG_KINDS = [
  "metric",
  "data_table",
  "roster",
  "calendar",
  "intelligence_metric",
] as const;

export type CatalogKind = (typeof CATALOG_KINDS)[number];

// ── Config schemas ────────────────────────────────────────────────────────────

// SHAPE only: the config must carry a string `type`. TYPE MEMBERSHIP (is this a
// real ontology object type?) is enforced separately in validateWidgetConfig
// against the LOADED ontology's deriveVocabulary().validTypes — not here.
const CatalogTypeSchema = z.string();

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

// VETTED community-intelligence KPI widget. Unlike `metric` (a generic COUNT(*)
// over any type), this binds ONE of four hand-vetted KPIs computed by the pure
// metrics core over agent_blocker rows. The config carries only WHICH KPI —
// the query (always agent_blocker, fail-closed via api.select) and the formula
// are fixed in the catalog, not the descriptor. Composition over generation.
export const IntelligenceMetricConfigSchema = z.object({
  metric: z.enum([
    "scenario_acceptance",
    "decision_latency",
    "coordination_coverage",
    "resolution_accuracy",
  ]),
});
export type IntelligenceMetricConfig = z.infer<typeof IntelligenceMetricConfigSchema>;

// ── Output types ──────────────────────────────────────────────────────────────

export interface MetricData {
  value: number;
  label: string;
  // OPTIONAL pre-formatted display string (e.g. "92%", "40 min"). When present
  // the renderer shows this instead of the raw `value`. The generic `metric`
  // widget leaves it undefined → backward-compatible (renders the raw count).
  display?: string;
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

// ── intelligence_metric helpers ──────────────────────────────────────────────
//
// Format a millisecond duration as a human latency string: under an hour →
// "Nm" (rounded minutes); an hour or more → "Xh Ym".
function formatLatency(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function formatRatio(ratio: number | null): string {
  return ratio === null ? "—" : `${Math.round(ratio * 100)}%`;
}

// Coerce a timestamp field (Date | string | null) to the ISO string the pure
// core's Date.parse() expects; null/absent stays null.
function toTs(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// Map raw agent_blocker read rows → the pure-core MetricBlockerRow shape.
function toBlockerRows(rows: Record<string, unknown>[]): MetricBlockerRow[] {
  return rows.map((r) => ({
    status: String(r.status ?? ""),
    created_at: toTs(r.created_at),
    resolved_at: toTs(r.resolved_at),
    reason_kind: (r.reason_kind as string | null | undefined) ?? null,
    blocked_actor_id: (r.blocked_actor_id as string | null | undefined) ?? null,
    summary: (r.summary as string | null | undefined) ?? null,
  }));
}

// ── The catalog ───────────────────────────────────────────────────────────────

export const WIDGET_CATALOG: {
  metric: CatalogEntry<MetricConfig, MetricData>;
  data_table: CatalogEntry<DataTableConfig, DataTableData>;
  roster: CatalogEntry<RosterConfig, RosterData>;
  calendar: CatalogEntry<CalendarConfig, CalendarData>;
  intelligence_metric: CatalogEntry<IntelligenceMetricConfig, MetricData>;
} = {
  // ── metric ──────────────────────────────────────────────────────────────────
  // Returns a COUNT(*) aggregate for any ontology type with optional filter.
  // READ-ONLY: delegates to api.count() — no raw SQL, no db handle.
  metric: {
    configSchema: MetricConfigSchema,
    queryBinding: async (config, api) => {
      // api.count() validates the type against the ontology-derived whitelist and
      // the filter field against the type's field whitelist — returns 0 for an
      // unknown type or filter field (fail-closed, inside the read-api fence). No
      // inline literal check here: membership is the read-api's responsibility and
      // validateWidgetConfig has already rejected an unknown type before persist.
      const value = await api.count(config.type, config.filter);
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

  // ── intelligence_metric ───────────────────────────────────────────────────────
  // VETTED community-intelligence KPI. Reads agent_blocker rows through the
  // fail-closed + permission-aware api.select, then runs the matching pure
  // metrics-core function. An unauthorized viewer gets rows:[] → every KPI
  // computes null → display "—" (no leak). READ-ONLY: api.select only.
  intelligence_metric: {
    configSchema: IntelligenceMetricConfigSchema,
    queryBinding: async (config, api) => {
      const { rows } = await api.select("agent_blocker", {
        columns: ["id", "status", "created_at", "resolved_at", "reason_kind", "blocked_actor_id", "summary"],
        limit: 500,
      });
      const blockers = toBlockerRows(rows);

      switch (config.metric) {
        case "scenario_acceptance": {
          const ratio = scenarioAcceptanceRate(blockers);
          return { value: ratio ?? 0, label: "Scenario acceptance", display: formatRatio(ratio) };
        }
        case "coordination_coverage": {
          const ratio = coordinationCoverage(blockers);
          return { value: ratio ?? 0, label: "Coordination coverage", display: formatRatio(ratio) };
        }
        case "resolution_accuracy": {
          const ratio = resolutionAccuracy(blockers);
          return { value: ratio ?? 0, label: "Resolution accuracy", display: formatRatio(ratio) };
        }
        case "decision_latency": {
          const ms = decisionLatencyMsMedian(blockers);
          return {
            value: ms ?? 0,
            label: "Decision latency",
            display: ms === null ? "—" : formatLatency(ms),
          };
        }
      }
    },
  },
};

// ── Config validation helper (used by compose_dashboard) ─────────────────────
//
// Validates that a widget config is well-formed AND that all column/field
// references point to real fields in the ontology. Returns structured errors
// rather than throwing.

export type ConfigValidationResult =
  | { ok: true; config: MetricConfig | DataTableConfig | RosterConfig | CalendarConfig | IntelligenceMetricConfig }
  | { ok: false; error: string; detail?: unknown };

export function validateWidgetConfig(
  kind: CatalogKind,
  rawConfig: unknown,
  ontology: Ontology,
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

  // The membership gate (was z.enum) + the column/field whitelist now come from
  // the LOADED ontology — never from a hostel literal. data_table/roster/metric/
  // calendar all carry a `type`; intelligence_metric carries none (config.type
  // undefined → no membership/field check, only shape).
  const config = parsed.data as {
    type?: string;
    columns?: string[];
    fields?: string[];
    filter?: { field: string };
  };
  const vocab = deriveVocabulary(ontology);

  if (config.type !== undefined && !vocab.validTypes.includes(config.type)) {
    return { ok: false, error: "unknown_type", detail: { type: config.type } };
  }

  const fieldSet = new Set(config.type ? (vocab.validFields[config.type] ?? []) : []);
  const cols = config.columns ?? config.fields ?? [];
  const bad = cols.filter((c) => !fieldSet.has(c));
  if (bad.length > 0) {
    return {
      ok: false,
      error: "unknown_columns",
      detail: { type: config.type, unknown_columns: bad },
    };
  }
  if (config.filter && !fieldSet.has(config.filter.field)) {
    return {
      ok: false,
      error: "unknown_filter_field",
      detail: { type: config.type, unknown_field: config.filter.field },
    };
  }

  return { ok: true, config: parsed.data };
}
