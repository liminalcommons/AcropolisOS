// The deterministic FLOOR of the representation generator: ontology + viewer
// permissions → default board descriptors. Pure (no DB, no LLM). No domain
// literals — every type/field comes from the loaded ontology. The read-only
// fence (read-api) re-validates everything downstream; this only proposes shape.
import type { Ontology } from "@/lib/ontology/schema";
import { pascalToSnake } from "@/lib/ontology/casing";
import type { CatalogKind } from "./catalog";
import type { CanReadType } from "./read-api";
import { resolversForType } from "./row-resolver";
import { confirmsForType } from "./row-confirm";

export interface SliceDescriptor {
  kind: CatalogKind;
  config: unknown;
  title?: string;
}

const DATE_TYPES = new Set(["date", "timestamp"]);
const MAX_TABLE_COLS = 4;

function resolvedType(def: unknown, ontology: Ontology): string | undefined {
  if (!def || typeof def !== "object") return undefined;
  const d = def as { type?: string; ref?: string };
  if (d.type) return d.type;
  if (d.ref) return ontology.properties?.[d.ref]?.type;
  return undefined;
}

// PK detection: an explicit `primary_key: true` flag is the ontology's canonical
// marker (see schema.ts InlinePropertyBase / PropertyReference). A field literally
// named "id" is ALSO treated as PK so it never leaks into a default data_table's
// columns even if a runtime ontology omits the flag.
function isPrimaryKey(fieldName: string, def: unknown): boolean {
  if (fieldName === "id") return true;
  return !!(def && typeof def === "object" && (def as { primary_key?: boolean }).primary_key);
}

// When a data_table opts into row_actions, the read fence selects ONLY the
// requested columns — so the HIDDEN columns the row affordances read from must
// be requested explicitly, or Dismiss/pathway/confirm render dead. Derive them
// from the ontology's own row-action definitions (no domain literals): the row
// id (action target), each resolver's choices column, each confirm's source
// column. These are stripped from the visible table by the renderer.
export function rowActionColumns(token: string, ontology: Ontology): string[] {
  const cols = new Set<string>(["id"]);
  for (const r of resolversForType(token, ontology)) cols.add(r.choicesFrom);
  for (const c of confirmsForType(token, ontology)) cols.add(c.source);
  return [...cols];
}

export function deriveDefaultBoard(
  ontology: Ontology,
  canReadType: CanReadType,
  opts: { admin?: boolean } = {},
): SliceDescriptor[] {
  const board: SliceDescriptor[] = [];
  const objectTypes = Object.keys(ontology.object_types); // order as loaded (insertion order of object_types)

  if (opts.admin) {
    const hasBlocker = objectTypes.some((n) => pascalToSnake(n) === "agent_blocker");
    if (hasBlocker && canReadType("agent_blocker")) {
      const visible = ["summary", "reason_kind", "status"];
      const hidden = rowActionColumns("agent_blocker", ontology).filter((c) => !visible.includes(c));
      board.push({
        kind: "data_table",
        title: "Awaiting your decision",
        config: {
          type: "agent_blocker",
          columns: [...visible, ...hidden],
          filter: { field: "status", value: "open" },
          row_actions: true,
          limit: 50,
        },
      });
      // M3 deliverable #6: surface the community-intelligence KPIs as governed
      // intelligence_metric widgets on the steward board. Computed behind the
      // fence over agent_blocker + action_audit (api.communityIntelligence), so
      // they ride the SAME agent_blocker read gate as the queue above — steward
      // sees them, a member never does. Titles come from the resolved KPI label.
      for (const kpi of ["autonomy", "acceptance", "coverage", "accuracy"] as const) {
        board.push({ kind: "intelligence_metric", config: { kpi } });
      }
    }
  }

  for (const name of objectTypes) {
    const token = pascalToSnake(name);
    if (opts.admin && token === "agent_blocker") continue; // already led with it
    if (!canReadType(token)) continue;

    const ot = ontology.object_types[name];
    const props = ot.properties ?? {};
    const fieldNames = Object.keys(props);

    if (opts.admin) {
      board.push({ kind: "metric", title: name, config: { type: token, agg: "count" } });
    }

    const cols: string[] = [];
    if (ot.title_property && fieldNames.includes(ot.title_property)) {
      cols.push(ot.title_property);
    }
    for (const f of fieldNames) {
      if (cols.length >= MAX_TABLE_COLS) break;
      if (cols.includes(f)) continue;
      const def = props[f];
      if (isPrimaryKey(f, def)) continue;
      const t = resolvedType(def, ontology);
      if (t === "ref" || t === "uuid") continue;
      cols.push(f);
    }
    if (cols.length > 0) {
      board.push({ kind: "data_table", title: name, config: { type: token, columns: cols, limit: 20 } });
    }

    // A calendar only makes sense for time-anchored types. Gate on the element
    // kind: only `event`/`commitment` types get one — a Member or Notification
    // "calendar" is noise. Backward-compat: an UNCLASSIFIED type (kind absent —
    // a legacy ontology authored before kinds) keeps the old behavior so existing
    // instances never silently lose a useful calendar; GROW assigns kinds for new
    // orgs, which then trim automatically.
    const kind = ot.kind;
    const calendarWorthy =
      kind === undefined || kind === "event" || kind === "commitment";
    const dateField = fieldNames.find((f) => DATE_TYPES.has(resolvedType(props[f], ontology) ?? ""));
    if (dateField && calendarWorthy) {
      board.push({ kind: "calendar", title: `${name} calendar`, config: { type: token, date_field: dateField, limit: 50 } });
    }
  }

  return board; // empty when nothing is readable → caller falls back to its floor
}
