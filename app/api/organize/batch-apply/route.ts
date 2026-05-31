// /api/organize/batch-apply — bulk-ingest ALL unclassified rows of a source.
//
// Companion to /api/organize/batch-classify. After a steward reviews the single
// proposal that batch-classify produced for a source, this route applies it to
// EVERY unclassified row of that source by looping the per-row commit primitive
// commitProposalCore with resolution = "create_new".
//
// WHY commitProposalCore (and NOT the proposal/apply `new_ingests` path):
//   commitProposalCore already (a) targets raw_inbox, (b) stamps the correct
//   classified_as/at/by provenance, (c) routes through the fail-closed
//   resolveTargetTable chokepoint, (d) applies deriveTypeDefaults /
//   deriveRequiredRefs, (e) is idempotent via SELECT ... FOR UPDATE. It is the
//   exact per-row ingest primitive; looping it chunked is the minimal, safe bulk
//   path. The proposals `PgInboxMigrator`/`new_ingests` machinery reads the OTHER
//   staging table (`inbox`, not `raw_inbox`) and stamps a different provenance
//   column — reusing it here would be a deep, wrong-table rewrite.
//
// resolution = "create_new": per-row dedup (findDuplicates) is SKIPPED for the
// bulk case on purpose. Dedup is a human-gated, single-confirm affordance; running
// it per row over a large source would be O(rows²) and would surface thousands of
// duplicate prompts. Dedup remains available on the single-row Confirm path.
//
// MAX_BATCH caps a single apply so a steward never blocks the request for an
// unbounded time; rows beyond the cap stay unclassified and a re-run picks them up.
//
// Steward-gated (also enforced inside commitProposalCore).

import { z } from "zod";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import { raw_inbox } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import {
  commitProposalCore,
  type CommitProposalInput,
  type CommitProposalResult,
} from "@/lib/organize/commit";
import { chunk } from "@/app/api/organize/batch-classify/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Process at most this many rows in one request. The steward re-runs for the
// remainder (each run leaves the rest unclassified, so it is naturally resumable).
const MAX_BATCH = 5000;
// Rows per id-fetch slice. Each commitProposalCore opens its own transaction, so
// chunking here is just to cap memory of the id list; the loop is sequential.
const CHUNK_SIZE = 500;

const BodySchema = z.object({
  source: z.string().min(1),
  target_type: z.string().min(1),
  field_map: z.record(z.string(), z.string()),
  confidence: z.number().min(0).max(1).optional(),
  reasoning: z.string().optional(),
  unmapped: z.array(z.string()).optional(),
});

interface BatchApplyResult {
  source: string;
  target_type: string;
  attempted: number;
  committed: number;
  already_classified: number;
  incomplete_refs: number;
  merged: number;
  errors: number;
  // First incomplete-refs detail (if any) so the UI can explain WHY nothing committed.
  missing_refs: string[];
  // First commit_error detail (truncated) for surfacing in the panel.
  first_error: string | null;
  // Rows beyond MAX_BATCH that were not touched this run.
  remaining: number;
}

export async function POST(req: Request): Promise<Response> {
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (chatRuntime.actor.role !== "steward") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { source, target_type, field_map } = parsed.data;

  const db = getDb();

  // Fetch the ids of unclassified rows for this source (id-only — bounded memory).
  const idRows = await db
    .select({ id: raw_inbox.id })
    .from(raw_inbox)
    .where(and(isNull(raw_inbox.classified_as), eq(raw_inbox.source, source)))
    .orderBy(raw_inbox.received_at)
    .limit(MAX_BATCH + 1);

  const remaining = Math.max(0, idRows.length - MAX_BATCH);
  const ids = idRows.slice(0, MAX_BATCH).map((r) => r.id);

  const result: BatchApplyResult = {
    source,
    target_type,
    attempted: ids.length,
    committed: 0,
    already_classified: 0,
    incomplete_refs: 0,
    merged: 0,
    errors: 0,
    missing_refs: [],
    first_error: null,
    remaining,
  };

  if (ids.length === 0) {
    return Response.json(result, { status: 200 });
  }

  for (const batch of chunk(ids, CHUNK_SIZE)) {
    for (const id of batch) {
      const proposal: CommitProposalInput = {
        inbox_id: id,
        target_type,
        field_map,
        confidence: parsed.data.confidence ?? 0.5,
        unmapped: parsed.data.unmapped ?? [],
        reasoning: parsed.data.reasoning ?? "batch",
      };

      let res: CommitProposalResult;
      try {
        // "create_new": skip per-row dedup for the bulk case (see file header).
        res = await commitProposalCore(
          db,
          chatRuntime.actor.role,
          chatRuntime.actor.userId,
          proposal,
          "create_new",
        );
      } catch (err) {
        result.errors++;
        if (result.first_error === null) {
          result.first_error = err instanceof Error ? err.message : String(err);
        }
        continue;
      }

      switch (res.status) {
        case "committed":
          result.committed++;
          break;
        case "already_classified":
          result.already_classified++;
          break;
        case "merged":
          result.merged++;
          break;
        case "incomplete_required_refs":
          result.incomplete_refs++;
          if (result.missing_refs.length === 0) result.missing_refs = res.missing;
          break;
        case "forbidden":
          // Should never happen (gated above) but stop early if it does.
          return Response.json({ error: "forbidden" }, { status: 403 });
        case "commit_error":
          result.errors++;
          if (result.first_error === null) result.first_error = res.detail;
          break;
        case "invalid_target_type":
          // The whole batch shares one type — a single failure means all fail.
          return Response.json(
            { error: "invalid_target_type", target_type, partial: result },
            { status: 422 },
          );
        case "field_map_error":
          return Response.json(
            { error: "field_map_error", invalid_fields: res.invalid_fields, partial: result },
            { status: 422 },
          );
        default:
          result.errors++;
          if (result.first_error === null) result.first_error = res.status;
          break;
      }
    }
  }

  return Response.json(result, { status: 200 });
}
