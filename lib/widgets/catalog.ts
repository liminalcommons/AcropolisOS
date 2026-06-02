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
import type { CommunityIntelligenceMetrics } from "@/lib/metrics/community-intelligence";
import { deriveVocabulary } from "./vocabulary";

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
  type: CatalogTypeSchema,
  date_field: z.string(),
  limit: z.number().int().min(1).max(200).optional().default(50),
});
export type CalendarConfig = z.infer<typeof CalendarConfigSchema>;

// intelligence_metric: a single community-intelligence KPI (M3 deliverable #6).
// Unlike the other kinds it carries NO ontology `type` — it is a derived ORG
// metric (autonomy / acceptance / coverage / accuracy / latency) computed by
// lib/metrics/community-intelligence over agent_blocker + action_audit, read
// THROUGH the fence (api.communityIntelligence, gated on agent_blocker read).
export const INTELLIGENCE_KPIS = [
  "autonomy",
  "acceptance",
  "coverage",
  "accuracy",
  "latency",
] as const;
export type IntelligenceKpi = (typeof INTELLIGENCE_KPIS)[number];

export const IntelligenceMetricConfigSchema = z.object({
  kpi: z.enum(INTELLIGENCE_KPIS),
});
export type IntelligenceMetricConfig = z.infer<typeof IntelligenceMetricConfigSchema>;

// Pure mapping: a computed KPI bundle → the MetricData a card renders. Ratios
// render as a percentage; latency as minutes; a null KPI (no data) renders "—"
// (never a fake 0). Exported for unit testing without a DB.
export function kpiToMetricData(
  kpi: IntelligenceKpi,
  m: CommunityIntelligenceMetrics,
): MetricData {
  const pct = (r: number | null): string => (r === null ? "—" : `${Math.round(r * 100)}%`);
  switch (kpi) {
    case "autonomy":
      return { value: m.autonomyRatio ?? 0, label: "Agent autonomy", display: pct(m.autonomyRatio) };
    case "acceptance":
      return { value: m.scenarioAcceptanceRate ?? 0, label: "Scenario acceptance", display: pct(m.scenarioAcceptanceRate) };
    case "coverage":
      return { value: m.coordinationCoverage ?? 0, label: "Coordination coverage", display: pct(m.coordinationCoverage) };
    case "accuracy":
      return { value: m.resolutionAccuracy ?? 0, label: "Resolution accuracy", display: pct(m.resolutionAccuracy) };
    case "latency": {
      const ms = m.decisionLatencyMsMedian;
      return { value: ms ?? 0, label: "Decision latency", display: ms === null ? "—" : `${Math.round(ms / 60000)} min` };
    }
  }
}

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

  // ── intelligence_metric ──────────────────────────────────────────────────────
  // Returns one community-intelligence KPI as MetricData. READ-ONLY: delegates to
  // api.communityIntelligence(), which reads agent_blocker + action_audit behind
  // the fence (fail-closed on agent_blocker read permission) and computes the KPIs.
  intelligence_metric: {
    configSchema: IntelligenceMetricConfigSchema,
    queryBinding: async (config, api) => {
      const m = await api.communityIntelligence();
      return kpiToMetricData(config.kpi, m);
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
  // calendar all carry a `type` (config.type undefined → no membership/field check).
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

  // Calendar: validate date_field against the ontology-derived field whitelist.
  // The type-membership check above already ran; fieldSet is populated for the
  // validated type. This makes calendar date_field ontology-derived, matching the
  // filter-field gate for metric/data_table/roster — same error shape.
  if (kind === "calendar") {
    const calConfig = parsed.data as { date_field: string; type?: string };
    if (!fieldSet.has(calConfig.date_field)) {
      return {
        ok: false,
        error: "unknown_filter_field",
        detail: { type: config.type, unknown_field: calConfig.date_field },
      };
    }
  }

  return { ok: true, config: parsed.data };
}

// ── describeValidationError ──────────────────────────────────────────────────
//
// Turns a FAILED ConfigValidationResult into the small, fully-serializable
// { kind, error } payload carried on a ResolvedWidget.validation_error. This is
// what makes ontology drift VISIBLE: instead of a stale widget vanishing, the
// resolve path returns a data-less error widget the renderer shows as an error
// card. We DELIBERATELY do not carry the raw Zod-issue `detail` array (it can be
// large / awkward to clone across the RSC boundary) — only a plain human-readable
// message that names the offending type / columns / field, derived from `detail`.
export function describeValidationError(
  result: Extract<ConfigValidationResult, { ok: false }>,
): { kind: string; error: string } {
  const d = result.detail as
    | { type?: string; unknown_columns?: string[]; unknown_field?: string }
    | undefined;
  switch (result.error) {
    case "unknown_type":
      return {
        kind: "unknown_type",
        error: `This widget references a type that no longer exists in the ontology: "${d?.type ?? "?"}".`,
      };
    case "unknown_columns":
      return {
        kind: "unknown_columns",
        error: `This widget references field(s) that were removed from "${d?.type ?? "?"}": ${(d?.unknown_columns ?? []).join(", ")}.`,
      };
    case "unknown_filter_field":
      return {
        kind: "unknown_filter_field",
        error: `This widget references a field "${d?.unknown_field ?? "?"}" that no longer exists on "${d?.type ?? "?"}".`,
      };
    case "invalid_config":
      return { kind: "invalid_config", error: "This widget's saved configuration is no longer valid." };
    default:
      return { kind: result.error, error: `This widget could not be resolved (${result.error}).` };
  }
}
