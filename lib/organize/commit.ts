// A4: commitProposalCore — extended with dedup/resolve step.
// A3: commitProposalCore — the governed assimilation commit step.
//
// Maps a structured proposal (from A1 classify) to a typed world-model row and
// stamps provenance on the raw_inbox row. This is the step that closes the
// F4-fake: a real typed row is written with a real provenance trail.
//
// A4 extension — resolution argument:
//   - absent (default): run near-match dedup first. If ≥1 candidate found →
//     return { status: "duplicate_candidate", candidates, proposal } without
//     writing anything. If no candidate → proceed to A3 create.
//   - "create_new": skip dedup, run A3 create (user explicitly chose new row).
//   - { merge_into: "<id>" }: no new row; stamp provenance on raw_inbox
//     (classified_as/at/by) so the row is marked processed and leaves /organize.
//     Returns { status: "merged", merged_into: id }.
//
// Design invariants:
//   - Steward-gated: caller MUST supply a steward actor; non-steward returns 403.
//   - Zod-validated input: proposal shape is validated via CommitProposalInputSchema.
//   - field_map re-validated server-side via validateFieldMap (imported from A1) —
//     never trusts the client's already-validated proposal without re-checking.
//   - Idempotent: a transactional SELECT FOR UPDATE checks classified_as IS NULL
//     before the insert; a second Confirm returns { status:"already_classified" }
//     and writes nothing. The guard is atomic so concurrent confirms cannot both
//     proceed.
//   - Many-to-one field mapping: multiple source keys mapping to the same target
//     are joined with a space, in field_map order.
//   - Required fields with no mapping: sensible per-type defaults are applied so
//     NOT NULL columns are satisfied even when the source payload is sparse.
//
// File location: lib/organize/commit.ts
// Exported for use by the "use server" action in app/organize/actions.ts AND
// the proof script in scripts/confirm-proof.ts.

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, getTableName } from "drizzle-orm";
import { getDb, type Database } from "../db/client";
import { raw_inbox, action_audit } from "../db/schema";
import { validateFieldMap, buildTargetVocab } from "../../app/api/organize/classify/route";
import { getOntologyCached } from "@/lib/agent/chat-runtime";
import { getRuntimeOntologyDir } from "@/lib/setup/paths";
import { resolveTargetTable } from "./target-table";
import { findDuplicates, type DuplicateCandidate } from "./resolve";
import { deriveRequiredRefs } from "../widgets/vocabulary";
import { deriveTypeDefaults } from "./derive-defaults";
import type { Actor } from "../ctx";

// ── Input schema ──────────────────────────────────────────────────────────────

export const CommitProposalInputSchema = z.object({
  inbox_id: z.string().uuid(),
  target_type: z.string().min(1),
  field_map: z.record(z.string(), z.string()),
  confidence: z.number().min(0).max(1),
  unmapped: z.array(z.string()),
  reasoning: z.string(),
});
export type CommitProposalInput = z.infer<typeof CommitProposalInputSchema>;

// ── Result discriminated union ────────────────────────────────────────────────

export type CommitProposalResult =
  | { status: "committed"; typed_row_id: string; target_type: string }
  | { status: "already_classified"; classified_as: string | null }
  | { status: "forbidden" }
  | { status: "validation_error"; issues: z.ZodIssue[] }
  | { status: "field_map_error"; invalid_fields: string[] }
  | { status: "invalid_target_type"; target_type: string }
  | { status: "inbox_not_found" }
  | { status: "incomplete_required_refs"; missing: string[] }
  | { status: "commit_error"; detail: string }
  // A4 statuses
  | { status: "duplicate_candidate"; candidates: DuplicateCandidate[]; proposal: CommitProposalInput }
  | { status: "merged"; merged_into: string }
  | { status: "merge_target_not_found"; merge_into: string };

// ── A4 Resolution argument ────────────────────────────────────────────────────
// Passed by the UI after the human has made a choice from the duplicate_candidate list.

export type Resolution =
  | "create_new"
  | { merge_into: string };

// ── Field mapping ─────────────────────────────────────────────────────────────
// Applies field_map to payload: source_key → target_field.
// Many-to-one: multiple source keys mapping to the same target are joined
// with a space, in field_map order.

function applyFieldMap(
  payload: Record<string, unknown>,
  fieldMap: Record<string, string>,
): Record<string, unknown> {
  // Accumulate in order — field_map entries are iterated in insertion order.
  const accumulator: Record<string, string[]> = {};

  for (const [sourceKey, targetField] of Object.entries(fieldMap)) {
    const value = payload[sourceKey];
    if (value === undefined) continue;
    if (!accumulator[targetField]) accumulator[targetField] = [];
    accumulator[targetField].push(String(value));
  }

  const result: Record<string, unknown> = {};
  for (const [targetField, parts] of Object.entries(accumulator)) {
    result[targetField] = parts.join(" ");
  }
  return result;
}

// ── Core commit function ──────────────────────────────────────────────────────
// This is the testable, injectable core. The server action and proof script
// both call this function — no HTTP dependency, pure business logic.

export async function commitProposalCore(
  db: Database,
  actorRole: string,
  actorId: string,
  proposal: CommitProposalInput,
  resolution?: Resolution,
): Promise<CommitProposalResult> {
  // 1. Steward gate
  if (actorRole !== "steward") {
    return { status: "forbidden" };
  }

  // 2. Zod-validate proposal input
  const validated = CommitProposalInputSchema.safeParse(proposal);
  if (!validated.success) {
    return { status: "validation_error", issues: validated.error.issues };
  }

  const { inbox_id, target_type, field_map, } = validated.data;

  // 3. Re-validate field_map values server-side (never trust the client's prior validation)
  const { fields: vocabFields } = await buildTargetVocab();
  const fieldMapCheck = validateFieldMap(target_type, field_map, vocabFields);
  if (!fieldMapCheck.ok) {
    return { status: "field_map_error", invalid_fields: fieldMapCheck.invalid };
  }

  // 3b. Resolve target type → Drizzle table from the LOADED ontology (fail-closed).
  //     Single write-path chokepoint: no hostel literals. resolveTargetTable
  //     returns null when the type is not in the ontology OR has no generated
  //     TABLES entry (ontology<->schema drift), so a missing key never reaches SQL.
  const ontology = await getOntologyCached(getRuntimeOntologyDir());
  const resolved = resolveTargetTable(ontology, target_type);
  if (resolved === null) {
    return { status: "invalid_target_type", target_type };
  }

  // ── A4: Handle merge_into resolution path ─────────────────────────────────
  // resolution = { merge_into: "<existing_id>" }:
  //   No new row is created. Stamp provenance on raw_inbox so the row is marked
  //   processed and disappears from /organize. The existing row already holds
  //   the canonical data — the incoming duplicate is simply discarded.
  //
  //   INTEGRITY CONTRACT (A4 HIGH fix):
  //   1. Validate merge target EXISTS and is of the correct target_type via
  //      a parameterized query (table name from safe hardcoded map, id is bound).
  //      Bogus/cross-type id → merge_target_not_found, data preserved, no write.
  //   2. Assert UPDATE hit exactly 1 row (checking raw row existence + classified_as
  //      IS NULL). 0 rows → structured error, never false 'merged'.
  //   3. Persist merge decision to action_audit for recoverability.
  if (resolution !== undefined && resolution !== "create_new" && typeof resolution === "object" && "merge_into" in resolution) {
    const mergeTarget = (resolution as { merge_into: string }).merge_into;
    const tableName = getTableName(resolved.table);

    // ── Step 1: Validate the merge target exists and is of the correct type ──
    let targetExists = false;
    try {
      // Safe: tableName is the SQL name of the ontology-resolved Drizzle table
      // (not user input — resolved.table came from the fail-closed TABLES lookup).
      // mergeTarget is a bound parameter — never concatenated into the query string.
      const existResult = await db.execute(
        sql`SELECT 1 FROM ${sql.identifier(tableName)} WHERE id = ${mergeTarget} LIMIT 1`,
      );
      const existRows = Array.isArray(existResult)
        ? existResult
        : ((existResult as { rows?: unknown[] }).rows ?? []);
      targetExists = existRows.length > 0;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { status: "commit_error", detail };
    }

    if (!targetExists) {
      // Bogus id or cross-type id (an id whose row is of a different type than
      // target_type). Write NOTHING. classified_as stays NULL so the data is
      // preserved and re-resolvable. Never silently discard inbound payload.
      return { status: "merge_target_not_found", merge_into: mergeTarget };
    }

    // ── Step 2: Stamp provenance + assert exactly 1 row was touched ──────────
    try {
      // First check if the inbox row exists and its classified_as state.
      const inboxCheck = await db.execute(
        sql`SELECT classified_as FROM raw_inbox WHERE id = ${inbox_id}`,
      );
      const checkRows = Array.isArray(inboxCheck)
        ? (inboxCheck as Array<Record<string, unknown>>)
        : ((inboxCheck as { rows?: Array<Record<string, unknown>> }).rows ?? []);

      if (checkRows.length === 0) {
        return { status: "inbox_not_found" };
      }

      const existingClassifiedAs = checkRows[0].classified_as;
      if (existingClassifiedAs !== null && existingClassifiedAs !== undefined) {
        return { status: "already_classified", classified_as: String(existingClassifiedAs) };
      }

      // Update only rows where classified_as IS NULL (idempotency guard).
      const updateResult = await db.execute(
        sql`UPDATE raw_inbox
            SET classified_as = ${target_type},
                classified_at = NOW(),
                classified_by = ${actorId}
            WHERE id = ${inbox_id} AND classified_as IS NULL
            RETURNING id`,
      );
      const updatedRows = Array.isArray(updateResult)
        ? updateResult
        : ((updateResult as { rows?: unknown[] }).rows ?? []);

      // Assert exactly 1 row was touched — never return false 'merged'.
      if (updatedRows.length !== 1) {
        // Race: another request classified this row between our check and update.
        return { status: "already_classified", classified_as: null };
      }

      // ── Step 3: Persist merge decision to action_audit ────────────────────
      // Uses the existing action_audit table (schema.ts) — no schema change.
      // subject_type = target_type, subject_id = mergeTarget (the canonical row),
      // metadata carries inbox_id for full traceability of the resolution.
      //
      // DATA-LOSS FIX: the incoming duplicate may carry fields the canonical row
      // lacks (e.g. a phone number). Merging into the canonical row writes no
      // typed columns, so without recording them those fields would vanish with
      // no trace. Map the inbox payload through field_map and stash the result
      // as metadata.incomingFields so a steward can later inspect — and reconcile
      // — what the duplicate contributed. Best-effort: a payload read failure
      // must not undo the already-committed merge.
      let incomingFields: Record<string, unknown> = {};
      try {
        const payloadRows = (await db.execute(
          sql`SELECT payload FROM raw_inbox WHERE id = ${inbox_id}`,
        )) as unknown as Array<Record<string, unknown>>;
        const payloadArray: Array<Record<string, unknown>> = Array.isArray(
          payloadRows,
        )
          ? payloadRows
          : ((payloadRows as { rows?: Array<Record<string, unknown>> }).rows ??
            []);
        const raw = payloadArray[0]?.payload;
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          incomingFields = applyFieldMap(
            raw as Record<string, unknown>,
            field_map,
          );
        }
      } catch {
        // Non-fatal — the merge stands; we just couldn't capture the payload.
      }

      try {
        await db.insert(action_audit).values({
          actor: actorId,
          actor_role: "steward",
          via: "commitProposalCore/merge_into",
          subject_type: target_type,
          subject_id: mergeTarget,
          before: null,
          after: null,
          metadata: {
            inbox_id,
            merged_into: mergeTarget,
            target_type,
            incomingFields,
          },
        });
      } catch {
        // Audit write failure is non-fatal — the merge is already committed.
        // Log the omission but do not surface it as an error to the caller.
        console.error("[commit] WARNING: action_audit write failed for merge", inbox_id, "→", mergeTarget);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { status: "commit_error", detail };
    }

    return { status: "merged", merged_into: mergeTarget };
  }

  // ── A4: Dedup check (when no resolution provided → default path) ──────────
  // resolution absent → run near-match dedup before committing.
  // resolution = "create_new" → skip dedup (user explicitly chose new row).
  if (resolution === undefined) {
    // We need the payload to build mappedFields for dedup scoring.
    // Read it here before the transaction (read-only, no lock needed yet).
    let dedupPayload: Record<string, unknown> = {};
    try {
      const payloadRows = await db.execute(
        sql`SELECT payload FROM raw_inbox WHERE id = ${inbox_id}`,
      ) as unknown as Array<Record<string, unknown>>;
      const payloadArray: Array<Record<string, unknown>> = Array.isArray(payloadRows)
        ? payloadRows
        : ((payloadRows as { rows?: Array<Record<string, unknown>> }).rows ?? []);
      const raw = payloadArray[0]?.payload;
      if (raw !== null && raw !== undefined && typeof raw === "object" && !Array.isArray(raw)) {
        dedupPayload = raw as Record<string, unknown>;
      }
    } catch {
      // If the read fails (inbox not found), the transaction below will catch it properly.
    }

    // Build mapped fields for scoring — same logic as applyFieldMap but for dedup only.
    const mappedForDedup = applyFieldMap(dedupPayload, field_map);

    // findDuplicates derives key fields + table name from the ontology-resolved
    // target (fail-closed): table name comes from getTableName(resolved.table),
    // never the raw target_type string.
    const candidates = await findDuplicates(db, resolved, ontology, mappedForDedup);
    if (candidates.length > 0) {
      return {
        status: "duplicate_candidate",
        candidates,
        proposal: validated.data,
      };
    }
    // No candidates → fall through to normal A3 create below.
  }

  // 4. Transactional atomic commit with idempotency guard
  //    Uses a CTE-based conditional update:
  //      a) UPDATE raw_inbox SET classified_as=<type>, classified_at=now(), classified_by=<actor>
  //         WHERE id=<inbox_id> AND classified_as IS NULL RETURNING *
  //      b) If update touched 0 rows → already classified → return already_classified
  //      c) If update touched 1 row → INSERT typed row → return committed
  //    All inside one transaction so a failure in step (c) rolls back step (a).

  let typedRowId: string | null = null;

  try {
    await db.transaction(async (tx) => {
      // Step a: conditional provenance update — only proceeds if not yet classified.
      // We use raw SQL for SELECT ... FOR UPDATE to lock the row atomically.
      const lockResult = await tx.execute(
        sql`SELECT classified_as FROM raw_inbox WHERE id = ${inbox_id} FOR UPDATE`,
      );

      // postgres.js result shape: rows array
      const rows = (lockResult as unknown as { rows?: unknown[]; } & unknown[]);
      const rowsArray: Array<Record<string, unknown>> = Array.isArray(rows)
        ? (rows as Array<Record<string, unknown>>)
        : ((rows as { rows?: Array<Record<string, unknown>> }).rows ?? []);

      if (rowsArray.length === 0) {
        // Row doesn't exist — will be caught as inbox_not_found after tx
        throw new Error("__INBOX_NOT_FOUND__");
      }

      const existingClassifiedAs = rowsArray[0].classified_as;
      if (existingClassifiedAs !== null && existingClassifiedAs !== undefined) {
        // Already classified — signal the outer function without rolling back
        throw new Error("__ALREADY_CLASSIFIED__:" + String(existingClassifiedAs));
      }

      // Step b: UPDATE provenance (row is locked, we know classified_as IS NULL)
      await tx.execute(
        sql`UPDATE raw_inbox
            SET classified_as = ${target_type},
                classified_at = NOW(),
                classified_by = ${actorId}
            WHERE id = ${inbox_id}`,
      );

      // Step c: build the typed row from mapped fields only. Per-type insert
      // defaults now live as DB column defaults (ontology YAML `default:` →
      // codegen → Drizzle), so an INSERT that omits a defaulted column gets the
      // DB-filled value — no app-side per-type default map.
      const inboxRows = await tx.execute(
        sql`SELECT payload FROM raw_inbox WHERE id = ${inbox_id}`,
      );
      const inboxRowsArray: Array<Record<string, unknown>> = Array.isArray(inboxRows)
        ? (inboxRows as Array<Record<string, unknown>>)
        : ((inboxRows as { rows?: Array<Record<string, unknown>> }).rows ?? []);

      const rawPayload = inboxRowsArray[0]?.payload ?? {};
      const payload = (rawPayload !== null && typeof rawPayload === "object" && !Array.isArray(rawPayload))
        ? (rawPayload as Record<string, unknown>)
        : {};

      const mappedFields = applyFieldMap(payload, field_map);

      // Step d: check required FK columns before attempting the insert.
      // If any required-ref col is absent from the mapped fields, return a
      // structured result — FK resolution is A4 / Resolve territory.
      // Per-type insert defaults projected from the ontology's `default:` fields
      // (declared in the scenario YAML, never a hostel literal here); mapped
      // fields win over defaults. Mirrors the DB column defaults the codegen
      // emits, but applied app-side so the insert is correct regardless of
      // whether drizzle-kit push has ALTERed the live columns.
      const defaults = deriveTypeDefaults(ontology, resolved.objectType);
      const combinedFields = { ...defaults, ...mappedFields };
      const requiredRefs = deriveRequiredRefs(ontology, resolved.objectType);
      const missingRefs = requiredRefs.filter(
        (col) => combinedFields[col] === undefined || combinedFields[col] === null,
      );
      if (missingRefs.length > 0) {
        // Signal the outer function — no insert, provenance rolls back
        throw new Error("__INCOMPLETE_REFS__:" + missingRefs.join(","));
      }

      // Merge: defaults < mapped (mapped wins over defaults)
      const newId = randomUUID();
      const rowToInsert: Record<string, unknown> = {
        id: newId,
        ...combinedFields,
      };

      // Step e: insert the typed row — wrapped so any DB error maps to
      // { status:"commit_error" } rather than re-throwing raw SQL strings.
      const table = resolved.table;
      try {
        await tx.insert(table as never).values(rowToInsert as never);
      } catch (insertErr) {
        const detail = insertErr instanceof Error ? insertErr.message : String(insertErr);
        throw new Error("__COMMIT_ERROR__:" + detail);
      }

      typedRowId = newId;
    });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "__INBOX_NOT_FOUND__") {
        return { status: "inbox_not_found" };
      }
      if (err.message.startsWith("__ALREADY_CLASSIFIED__:")) {
        const classifiedAs = err.message.slice("__ALREADY_CLASSIFIED__:".length) || null;
        return { status: "already_classified", classified_as: classifiedAs };
      }
      if (err.message.startsWith("__INCOMPLETE_REFS__:")) {
        const missing = err.message.slice("__INCOMPLETE_REFS__:".length).split(",").filter(Boolean);
        return { status: "incomplete_required_refs", missing };
      }
      if (err.message.startsWith("__COMMIT_ERROR__:")) {
        const detail = err.message.slice("__COMMIT_ERROR__:".length);
        return { status: "commit_error", detail };
      }
    }
    throw err; // re-throw truly unexpected errors
  }

  return {
    status: "committed",
    typed_row_id: typedRowId!,
    target_type,
  };
}
