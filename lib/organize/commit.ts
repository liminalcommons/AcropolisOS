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
import { sql } from "drizzle-orm";
import { getDb, type Database } from "../db/client";
import { raw_inbox } from "../db/schema";
import {
  guest as guestTable,
  member as memberTable,
  booking as bookingTable,
  event as eventTable,
  bed as bedTable,
  room as roomTable,
  shift as shiftTable,
  work_trade_agreement as workTradeTable,
} from "../db/schema.generated";
import { validateFieldMap } from "../../app/api/organize/classify/route";
import { findDuplicates, type DuplicateCandidate } from "./resolve";
import type { Actor } from "../ctx";

// ── Input schema ──────────────────────────────────────────────────────────────

const TARGET_TYPE_ENUM = z.enum([
  "guest",
  "member",
  "booking",
  "event",
  "bed",
  "room",
  "shift",
  "work_trade_agreement",
]);
type TargetType = z.infer<typeof TARGET_TYPE_ENUM>;

export const CommitProposalInputSchema = z.object({
  inbox_id: z.string().uuid(),
  target_type: TARGET_TYPE_ENUM,
  field_map: z.record(z.string(), z.string()),
  confidence: z.number().min(0).max(1),
  unmapped: z.array(z.string()),
  reasoning: z.string(),
});
export type CommitProposalInput = z.infer<typeof CommitProposalInputSchema>;

// ── Result discriminated union ────────────────────────────────────────────────

export type CommitProposalResult =
  | { status: "committed"; typed_row_id: string; target_type: TargetType }
  | { status: "already_classified"; classified_as: string | null }
  | { status: "forbidden" }
  | { status: "validation_error"; issues: z.ZodIssue[] }
  | { status: "field_map_error"; invalid_fields: string[] }
  | { status: "inbox_not_found" }
  | { status: "incomplete_required_refs"; missing: string[] }
  | { status: "commit_error"; detail: string }
  // A4 statuses
  | { status: "duplicate_candidate"; candidates: DuplicateCandidate[]; proposal: CommitProposalInput }
  | { status: "merged"; merged_into: string };

// ── A4 Resolution argument ────────────────────────────────────────────────────
// Passed by the UI after the human has made a choice from the duplicate_candidate list.

export type Resolution =
  | "create_new"
  | { merge_into: string };

// ── Required FK columns per type ─────────────────────────────────────────────
// These are the NOT NULL foreign-key columns derived from schema.generated.ts.
// If any of these are absent from the mapped fields before insert, we return
// { status: "incomplete_required_refs" } — FK resolution is A4 territory.

const REQUIRED_REFS: Record<TargetType, string[]> = {
  guest: [],
  member: [],
  booking: ["guest", "bed"],
  event: ["organizer"],
  bed: ["room"],
  room: [],
  shift: ["member_id"],
  work_trade_agreement: ["bed_comp"],
};

// ── Non-FK defaults per type ──────────────────────────────────────────────────
// Only non-FK NOT NULL columns with sensible defaults. Sentinel-UUID FK values
// are NOT included here — those must be resolved via A4 entity resolution.

const TYPE_DEFAULTS: Record<TargetType, Record<string, unknown>> = {
  guest: {
    country: "unknown",
    phone: "unknown",
    arrived_at: new Date().toISOString().slice(0, 10),
    expected_departure: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    current_status: "booked",
    is_work_trader: false,
  },
  member: {
    phone: "unknown",
    tier_role: "staff",
    started_at: new Date().toISOString().slice(0, 10),
  },
  booking: {
    label: "Imported",
    from_date: new Date().toISOString().slice(0, 10),
    to_date: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    rate_per_night: 0,
    currency: "EUR",
    source: "direct",
    status: "confirmed",
  },
  event: {
    title: "Imported event",
    starts_at: new Date().toISOString(),
    duration_hours: 2,
    status: "scheduled",
  },
  bed: {
    code: "imported",
    is_bottom_bunk: true,
    out_of_service: false,
  },
  room: {
    code: "imported",
    kind: "dorm_mixed",
    capacity: 0,
  },
  shift: {
    label: "Imported shift",
    kind: "reception",
    starts_at: new Date().toISOString(),
    duration_hours: 8,
    status: "open",
  },
  work_trade_agreement: {
    label: "Imported agreement",
    hours_per_week: 20,
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
    status: "pending",
  },
};

// ── Table lookup ──────────────────────────────────────────────────────────────

type AnyTable = typeof guestTable | typeof memberTable | typeof bookingTable |
  typeof eventTable | typeof bedTable | typeof roomTable |
  typeof shiftTable | typeof workTradeTable;

function tableForType(targetType: TargetType): AnyTable {
  switch (targetType) {
    case "guest": return guestTable;
    case "member": return memberTable;
    case "booking": return bookingTable;
    case "event": return eventTable;
    case "bed": return bedTable;
    case "room": return roomTable;
    case "shift": return shiftTable;
    case "work_trade_agreement": return workTradeTable;
  }
}

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
  const fieldMapCheck = validateFieldMap(target_type, field_map);
  if (!fieldMapCheck.ok) {
    return { status: "field_map_error", invalid_fields: fieldMapCheck.invalid };
  }

  // ── A4: Handle merge_into resolution path ─────────────────────────────────
  // resolution = { merge_into: "<existing_id>" }:
  //   No new row is created. Stamp provenance on raw_inbox so the row is marked
  //   processed and disappears from /organize. The existing row already holds
  //   the canonical data — the incoming duplicate is simply discarded.
  if (resolution !== undefined && resolution !== "create_new" && typeof resolution === "object" && "merge_into" in resolution) {
    const mergeTarget = (resolution as { merge_into: string }).merge_into;
    try {
      await db.execute(
        sql`UPDATE raw_inbox
            SET classified_as = ${target_type},
                classified_at = NOW(),
                classified_by = ${actorId}
            WHERE id = ${inbox_id} AND classified_as IS NULL`,
      );
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

    const candidates = await findDuplicates(db, target_type, mappedForDedup);
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

      // Step c: build the typed row with defaults + mapped fields
      const defaults = TYPE_DEFAULTS[target_type] ?? {};
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
      // If any required-ref col is absent from both defaults AND mapped fields,
      // return structured result — FK resolution is A4 / Resolve territory.
      const combinedFields = { ...defaults, ...mappedFields };
      const requiredRefs = REQUIRED_REFS[target_type] ?? [];
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
      const table = tableForType(target_type);
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
