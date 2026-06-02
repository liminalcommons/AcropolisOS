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
//   (a) type validated against vocab.validTypes (from deriveVocabulary) → out-of-whitelist
//       returns safe empty, never reaches SQL.
//   (b) per-actor read permission gate — the VIEWER must be permitted to read
//       the catalog type (per the loaded ontology's object_type read tokens).
//       FAIL CLOSED: a viewer not permitted gets the SAME safe-empty value the
//       unknown-type branch returns, BEFORE any SQL runs. This reuses the exact
//       permission semantics of ctx.objects (actorMatchesTokens) — one model.
//   (c) columns/fields validated against vocab.validFields (from deriveVocabulary) → unknowns dropped.
//   (d) limit / filter values bound as parameters, never interpolated.
//   (e) SELECT-only — no insert/update/delete anywhere in this file.

import { getTableName, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Database } from "@/lib/db/client";
import type { Actor } from "@/lib/ctx";
import { actorMatchesTokens, buildObjectPermissionsMap } from "@/lib/ontology/ctx";
import type { Ontology } from "@/lib/ontology/schema";
import { TABLES } from "@/lib/db/schema.generated";
import { PgAuditReader } from "@/lib/audit/reader";
import {
  computeCommunityIntelligence,
  type CommunityIntelligenceMetrics,
  type MetricBlockerRow,
  type MetricAuditRow,
  type PolicyOf,
} from "@/lib/metrics/community-intelligence";
import { deriveVocabulary, type Vocabulary } from "./vocabulary";

// Any generated Drizzle table — the heterogeneous union TABLES indexes into
// (the typed-select cast target; never a domain-shaped literal).
type AnyTable = (typeof TABLES)[keyof typeof TABLES];

// RELATIVE-DATE filter tokens. A widget filter value of "@today" resolves, at
// QUERY time, to the current date (YYYY-MM-DD) — so a descriptor like
// { field: "from_date", value: "@today" } means "arriving today" without baking
// a fixed date into the saved view. Resolved here (server-side) just before the
// value is bound as a SQL parameter; non-token values pass through untouched.
// Equality against a DATE column; (range/relative-timestamp tokens are a later
// extension — this is the minimal governed primitive that unblocks "today" views).
export function resolveFilterValue(value: string): string {
  if (value === "@today") return new Date().toISOString().slice(0, 10);
  return value;
}

// ── Per-actor read permission gate ──────────────────────────────────────────────
//
// THE SECURITY BOUNDARY: read-api takes a raw db handle and would otherwise let
// any caller read ANY whitelisted type's rows regardless of the viewer's role.
// The structural whitelist (the ontology-derived validTypes/validFields) says
// only WHAT is queryable at all — it says nothing about WHO may read it. This
// predicate closes that hole by gating each read on the viewer's per-type read
// permission, reusing the SAME permission semantics as ctx.objects.

/**
 * Predicate: may the current viewer read this catalog type at all?
 * Built once per request via buildCanReadType (or CAN_READ_ALL for trusted
 * seeder/proof contexts). FAIL CLOSED: when in doubt, deny.
 */
export type CanReadType = (catalogType: string) => boolean;

/**
 * Trusted-context predicate: allow all reads. ONLY for seeder / proof / migration
 * scripts that run with full authority and no actor. Never use on a request path —
 * request paths must build a real per-actor predicate via buildCanReadType.
 */
export const CAN_READ_ALL: CanReadType = () => true;

/**
 * Builds a per-actor read predicate from the SAME source as ctx.objects:
 * buildObjectPermissionsMap(ontology) + actorMatchesTokens, with identical
 * fail-closed semantics:
 *   - missing perms entry for the type        → deny
 *   - empty/absent read token list            → deny
 *   - ["*"] wildcard                          → allow
 *   - token matches actor.role / customRoles  → allow
 * The type-level gate passes row = null, so `member_self` cannot match here —
 * that is intentional: per-row ownership lives in ctx.objects, not the coarse
 * catalog read fence.
 *
 * CASING IS LOAD-BEARING: the read-api's snake token (e.g. `work_trade_agreement`)
 * is mapped to the PascalCase ontology object_type name (`WorkTradeAgreement`)
 * used by buildObjectPermissionsMap. That map is derived by INVERTING the loaded
 * ontology's real keys (deriveVocabulary().typeToObjectType) — never guessed and
 * never a hostel-shaped literal. A token absent from the loaded ontology has no
 * mapping → deny (fail-closed).
 */
export function buildCanReadType(
  actor: Actor | null,
  ontology: Ontology,
  viewerRole?: string,
): CanReadType {
  const permissions = buildObjectPermissionsMap(ontology);
  const vocab = deriveVocabulary(ontology);
  // "View as <role>" preview (steward-only — the CALLER must enforce that the
  // requesting actor is a steward before passing an override). Presents a
  // synthetic actor carrying the chosen role so the lens admits exactly that
  // role's slice — the same render() function, a different viewer.
  const lensActor: Actor | null = viewerRole
    ? ({
        ...(actor ?? { id: "preview" }),
        role: viewerRole === "steward" ? "steward" : "member",
        customRoles:
          viewerRole === "steward" || viewerRole === "member"
            ? []
            : [viewerRole],
      } as Actor)
    : actor;
  return (catalogType: string): boolean => {
    // not even a type present in the loaded ontology → deny (membership gate)
    if (!vocab.validTypes.includes(catalogType)) return false;
    const objectTypeName = vocab.typeToObjectType[catalogType];
    const perms = permissions[objectTypeName];
    // FAIL CLOSED: no permissions entry → deny (mirrors wrapObjectAccess(!perms)).
    if (!perms) return false;
    return actorMatchesTokens(lensActor, perms.read, null, objectTypeName);
  };
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
   * SELECT the requested columns from a given ontology type WHERE id IN (ids).
   * Fetches EXACTLY the referenced ids — no 500-row ceiling, no over-fetch.
   * Unknown types, unknown columns, or empty ids arrays return empty.
   * Fail-closed: unauthorized viewer → {columns:[], rows:[]} before any SQL.
   * Large id sets are chunked to stay under parameter count ceilings.
   */
  selectByIds(
    type: string,
    ids: string[],
    columns: string[],
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

  /**
   * The five community-intelligence KPIs (M3), computed over the agent_blocker
   * lifecycle + the action_audit log via lib/metrics/community-intelligence.
   * FAIL CLOSED: gated on the viewer's agent_blocker read permission — a viewer
   * not permitted to read agent_blocker gets all-null KPIs (the same "no data"
   * value the pure metrics return on an empty denominator), BEFORE any SQL. So
   * these org-intelligence aggregates surface only to roles allowed the blocker
   * queue (the steward), never to a member.
   */
  communityIntelligence(): Promise<CommunityIntelligenceMetrics>;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates a ReadOnlyDataApi bound to the given db handle, gated by the viewer's
 * per-type read permission. The returned object exposes ONLY read methods — no
 * insert/update/delete/create method exists on it or its type.
 *
 * `canReadType` is REQUIRED and is the security boundary: every read method
 * checks it (after the structural whitelist, BEFORE any SQL) and returns the
 * safe-empty value if the viewer may not read the type. Build it per request via
 * buildCanReadType(actor, ontology); use CAN_READ_ALL only in trusted seeder/proof
 * contexts. There is no default — fail-closed requires an explicit decision.
 *
 * `ontology` is the SOURCE of the structural whitelist. The type/field/table
 * whitelist is DERIVED from the loaded ontology (deriveVocabulary + the generated
 * TABLES registry) — never from request input and never from hostel-shaped
 * literals. Any organization's ontology flows through the same fence.
 */
export function createReadOnlyDataApi(
  db: Database,
  canReadType: CanReadType,
  ontology: Ontology,
): ReadOnlyDataApi {
  // The ontology-derived structural whitelist, computed ONCE. Closed over by the
  // gate helpers below. Comes from the validated ontology only — never request input.
  const vocab: Vocabulary = deriveVocabulary(ontology);

  /**
   * Resolves a type string to a verified token via the ontology-derived
   * membership gate. Returns null for anything not in the loaded ontology's
   * object types — caller returns safe empty. The single table-name safety
   * chokepoint: only a returned (validated) token may reach SQL.
   *
   * FAIL-CLOSED ON ONTOLOGY↔SCHEMA DRIFT: a token may be valid in the LOADED
   * ontology's whitelist yet have NO entry in the generated TABLES registry
   * (e.g. a runtime ontology whose object type was never code-genned). Return
   * null in that case too, so the raw-SQL paths never index TABLES with a
   * missing key (which would cast `undefined` to a table and let getTableName
   * throw / a stray identifier escape). resolveType is now the SINGLE place
   * that guarantees both (a) whitelist membership and (b) a real table object —
   * so the permission gate and the raw SQL resolve through the IDENTICAL lookup.
   */
  function resolveType(type: string): string | null {
    if (!vocab.validTypes.includes(type)) return null;
    if (vocab.typeToObjectType[type] === undefined) return null;
    // The generated TABLES registry must hold a defined table for this type —
    // the EXACT object the permission gate keys on. No drift → no phantom read.
    const table = (TABLES as Record<string, unknown>)[vocab.typeToObjectType[type]];
    if (table === undefined || table === null) return null;
    return type;
  }

  /**
   * Filters requested columns to those in the ontology-derived field whitelist
   * for the (already-validated) type. Unknown columns are silently dropped — no
   * injection path. Caller MUST pass a token that passed resolveType.
   */
  function safeColumns(type: string, requested: string[]): string[] {
    const allowed = new Set(vocab.validFields[type] ?? []);
    return requested.filter((c) => allowed.has(c));
  }

  /**
   * Resolves a VALIDATED token to its Drizzle table via the generated TABLES
   * registry, keyed by the EXACT PascalCase ontology object-type name (inversion,
   * never a guess). MUST only be called for a token that passed resolveType.
   * Indexing TABLES yields a union of heterogeneous table types; cast to the
   * generic AnyTable shape for the typed-select paths exactly as the generated
   * TABLES registry does.
   */
  function tableFor(type: string): AnyTable {
    return (TABLES as Record<string, unknown>)[
      vocab.typeToObjectType[type]
    ] as unknown as AnyTable;
  }

  return {
    // ── count ──────────────────────────────────────────────────────────────────
    async count(type, filter) {
      const resolved = resolveType(type);
      if (!resolved) return 0;
      // PERMISSION GATE (fail-closed): viewer must be permitted to read this
      // type. Same safe-empty as the unknown-type branch; runs BEFORE any SQL.
      if (!canReadType(resolved)) return 0;

      if (filter) {
        // Validate filter field against the ontology-derived whitelist
        const allowed = new Set(vocab.validFields[resolved] ?? []);
        if (!allowed.has(filter.field)) return 0;

        // Field name is whitelisted — safe to interpolate as SQL identifier.
        // Filter value is a bound parameter via sql template literal.
        // TABLE NAME comes from getTableName(tableFor(resolved)) — the SAME
        // TABLES object the permission gate keys on — NEVER reconstructed from
        // the token string (token = pascalToSnake, table = snakeCase; these
        // diverge for acronym-cased types → cross-type read leak).
        const rows = await db.execute(
          sql`SELECT COUNT(*)::int AS count FROM ${sql.raw(`"${getTableName(tableFor(resolved))}"`)} WHERE ${sql.raw(`"${filter.field}"`)} = ${resolveFilterValue(filter.value)}`,
        ) as Array<{ count: unknown }>;
        const raw = rows[0]?.count;
        return typeof raw === "number" ? raw : Number(raw ?? 0);
      }

      // Unfiltered count — drizzle typed select (no raw SQL needed)
      const table = tableFor(resolved);
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
      // PERMISSION GATE (fail-closed): same safe-empty as unknown type; pre-SQL.
      if (!canReadType(resolved)) return { columns: [], rows: [] };

      const validCols = safeColumns(resolved, columns);
      if (validCols.length === 0) return { columns: [], rows: [] };

      const colList = validCols.map((c) => `"${c}"`).join(", ");
      const safeLimit = Math.min(Math.max(1, limit), 500);

      if (filter) {
        const allowed = new Set(vocab.validFields[resolved] ?? []);
        // Fail-closed, matching count(): an unrecognized filter field returns
        // empty — never a silent unfiltered superset. (A "status=open" queue
        // must not degrade into "show everything" if the field is wrong.)
        if (!allowed.has(filter.field)) return { columns: [], rows: [] };
        // TABLE NAME from getTableName(tableFor(resolved)) — the SAME TABLES
        // object the permission gate keys on; never the token string.
        const rows = await db.execute(
          sql`SELECT ${sql.raw(colList)} FROM ${sql.raw(`"${getTableName(tableFor(resolved))}"`)} WHERE ${sql.raw(`"${filter.field}"`)} = ${resolveFilterValue(filter.value)} LIMIT ${safeLimit}`,
        ) as Record<string, unknown>[];
        return { columns: validCols, rows };
      }

      const rows = await db.execute(
        sql`SELECT ${sql.raw(colList)} FROM ${sql.raw(`"${getTableName(tableFor(resolved))}"`)} LIMIT ${safeLimit}`,
      ) as Record<string, unknown>[];
      return { columns: validCols, rows };
    },

    // ── selectByIds ────────────────────────────────────────────────────────────
    async selectByIds(type, ids, columns) {
      const resolved = resolveType(type);
      if (!resolved) return { columns: [], rows: [] };
      // PERMISSION GATE (fail-closed): identical to select — same safe-empty
      // value, same pre-SQL position. No second permission model.
      if (!canReadType(resolved)) return { columns: [], rows: [] };

      // Always include "id" so callers can build id→label maps; merge into
      // requested set then apply the whitelist filter.
      const requested = columns.includes("id") ? columns : ["id", ...columns];
      const validCols = safeColumns(resolved, requested);
      if (validCols.length === 0) return { columns: [], rows: [] };

      // De-dup ids; empty set → nothing to fetch (no query).
      const uniqueIds = [...new Set(ids)];
      if (uniqueIds.length === 0) return { columns: validCols, rows: [] };

      const colList = validCols.map((c) => `"${c}"`).join(", ");
      // TABLE NAME from getTableName(tableFor(resolved)) — the SAME TABLES object
      // the permission gate keys on; never the token string (acronym-divergence).
      const tableSql = sql.raw(`"${getTableName(tableFor(resolved))}"`);
      const colsSql = sql.raw(colList);

      // Chunk into batches of 500 to stay under any per-statement parameter
      // ceiling. Each id is BOUND AS A PARAMETER (never interpolated) using
      // drizzle's sql template + sql.join, exactly as select/count bind filter
      // values — the same security discipline, extended to a variable-length list.
      const CHUNK_SIZE = 500;
      const allRows: Record<string, unknown>[] = [];

      for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
        const chunk = uniqueIds.slice(i, i + CHUNK_SIZE);
        // Build: id IN ($1, $2, …) with every id as a bound parameter.
        const inParams = sql.join(
          chunk.map((id) => sql`${id}`),
          sql`, `,
        );
        const rows = await db.execute(
          sql`SELECT ${colsSql} FROM ${tableSql} WHERE "id" IN (${inParams})`,
        ) as Record<string, unknown>[];
        allRows.push(...rows);
      }

      return { columns: validCols, rows: allRows };
    },

    // ── byDate ─────────────────────────────────────────────────────────────────
    async byDate(type, dateField, limit = 50) {
      const resolved = resolveType(type);
      if (!resolved) return [];
      // PERMISSION GATE (fail-closed): same safe-empty as unknown type; pre-SQL.
      if (!canReadType(resolved)) return [];

      // Validate dateField against the ontology-derived whitelist
      const allowed = new Set(vocab.validFields[resolved] ?? []);
      if (!allowed.has(dateField)) return [];

      const safeLimit = Math.min(Math.max(1, limit), 200);
      const table = tableFor(resolved) as unknown as Record<string, PgColumn>;

      // COLUMN-PROJECTION DISCIPLINE: byDate buckets rows by a single date field
      // in-memory — it needs ONLY that field plus the id. Project EXACTLY those
      // two columns instead of SELECT * so a many-field type (Member, Event) does
      // not stream every column over the wire. This mirrors the composition
      // layer's hidden-column discipline (commit 80d76c3): the read layer fetches
      // precisely what the widget consumes, nothing more. dateField is already
      // verified against the ontology field whitelist above, and resolveType
      // guarantees a real table object, so table[dateField] / table.id are
      // defined Drizzle columns. Stable key order [dateField, "id"] is preserved.
      const rows = await db
        .select({ [dateField]: table[dateField], id: table.id })
        .from(table as unknown as AnyTable)
        .limit(safeLimit) as Record<string, unknown>[];

      return rows;
    },

    // ── communityIntelligence ───────────────────────────────────────────────────
    async communityIntelligence() {
      const NULL_METRICS: CommunityIntelligenceMetrics = {
        autonomyRatio: null,
        scenarioAcceptanceRate: null,
        decisionLatencyMsMedian: null,
        coordinationCoverage: null,
        resolutionAccuracy: null,
      };
      // FAIL CLOSED: the KPIs describe the agent_blocker lifecycle — gate on the
      // viewer's agent_blocker read permission (same pre-SQL gate as every read).
      // A type absent from the loaded ontology (or unreadable) → all-null KPIs.
      const resolved = resolveType("agent_blocker");
      if (!resolved || !canReadType(resolved)) return NULL_METRICS;

      // ALL agent_blocker rows (the KPIs span open + closed). Typed drizzle select.
      //
      // COLUMN-PROJECTION DISCIPLINE: computeCommunityIntelligence consumes ONLY the
      // MetricBlockerRow contract — 7 columns. agent_blocker carries many more
      // (detail, blocked_work_ref, resolution_mode, pathways, input_schema,
      // confirm_action, resolved_by_action_audit_id, id) the metric never reads.
      // Project EXACTLY those 7 columns instead of SELECT * so a large steward
      // board does not stream every blocker column over the wire. This mirrors
      // byDate's projection and the composition layer's hidden-column discipline
      // (commit 80d76c3): the read layer fetches precisely what the compute
      // consumes, nothing more. resolveType guarantees a real table object, so each
      // table[col] is a defined Drizzle column. Stable key order matches the
      // MetricBlockerRow mapping below.
      const blockerTable = tableFor(resolved) as unknown as Record<string, PgColumn>;
      const blockerRows = (await db
        .select({
          status: blockerTable.status,
          created_at: blockerTable.created_at,
          resolved_at: blockerTable.resolved_at,
          resolved_via_pathway_id: blockerTable.resolved_via_pathway_id,
          reason_kind: blockerTable.reason_kind,
          blocked_actor_id: blockerTable.blocked_actor_id,
          summary: blockerTable.summary,
        })
        .from(blockerTable as unknown as AnyTable)
        .limit(2000)) as Record<string, unknown>[];
      const toIso = (v: unknown): string | null =>
        v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null;
      const blockers: MetricBlockerRow[] = blockerRows.map((r) => ({
        status: String(r.status ?? ""),
        created_at: toIso(r.created_at),
        resolved_at: toIso(r.resolved_at),
        resolved_via_pathway_id: (r.resolved_via_pathway_id as string | null) ?? null,
        reason_kind: (r.reason_kind as string | null) ?? null,
        blocked_actor_id: (r.blocked_actor_id as string | null) ?? null,
        summary: (r.summary as string | null) ?? null,
      }));

      // action_audit rows via the proven reader (the SAME source the veto-queue
      // autonomy split uses) + policyOf from the LOADED ontology (never a stale map).
      const auditRows = await new PgAuditReader(db).listAction({ limit: 2000 });
      const audits: MetricAuditRow[] = auditRows.map((r) => ({
        subject_type: r.subject_type,
        subject_id: r.subject_id,
        metadata: r.metadata as { result?: string },
      }));
      const policyOf: PolicyOf = (name) => ontology.action_types[name]?.agent_policy;

      return computeCommunityIntelligence(blockers, audits, policyOf);
    },
  };
}
