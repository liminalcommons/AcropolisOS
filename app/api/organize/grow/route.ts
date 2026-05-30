// §6 GROW — the heartbeat. Turns an ingested row that does NOT fit the current
// ontology into evidence-gated ontology growth: a genuinely-new concept becomes
// a PENDING new-type proposal (always escalates — the steward approves it on the
// graph), while novel fields on an EXISTING type are additive and auto-apply
// through the SAME audited apply pipeline a steward Apply uses.
//
// FENCE: steward-gated (mutation must not live in the read-only, member-reachable
// classify route). evaluateGrow itself is pure; only its OUTPUT mutates, and only
// via the audited proposal/apply path. New types NEVER auto-apply (§4.3/§11.4).
import path from "node:path";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import { raw_inbox } from "@/lib/db/schema";
import { loadOntology } from "@/lib/ontology/load";
import { getRuntimeOntologyDir } from "@/lib/setup/paths";
import { evaluateGrow } from "@/lib/organize/evolve";
import { growDecisionToDiffs } from "@/lib/organize/grow-to-proposal";
import { getProposalStore } from "@/lib/proposals/singleton";
import { applyProposal } from "@/lib/proposals/apply";
import { FsYamlWriter } from "@/lib/proposals/adapters/yaml-writer";
import { GeneratedFilesCodegen } from "@/lib/proposals/adapters/codegen";
import {
  DiffMigrationRunner,
  PgAuditStore,
  PgInboxMigrator,
  PgProposalStatusStore,
  PgTransactionRunner,
} from "@/lib/proposals/adapters/runtime";
import { PgApprovedViewsRegistry } from "@/lib/views/registry-pg";
import type { Proposal } from "@/lib/proposals/store";
import type { ProposalDiff } from "@/lib/proposals/diff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  inbox_id: z.string().min(1),
  // The type the row is being grown toward. If it is NOT an existing ontology
  // type, evaluateGrow escalates it as a new type; if it IS, novel payload keys
  // become additive fields. Not enum-bounded (unlike classify) — that is the
  // whole point: growth must be able to name a concept the ontology lacks.
  target_type: z.string().min(1),
});

export async function POST(req: Request): Promise<Response> {
  const rt = await buildChatRuntime();
  if (isAnonymous(rt.actor)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (rt.actor.role !== "steward") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const { inbox_id, target_type } = parsed.data;

  const db = getDb();
  const [row] = await db.select().from(raw_inbox).where(eq(raw_inbox.id, inbox_id)).limit(1);
  if (!row) {
    return Response.json({ error: "inbox_not_found" }, { status: 404 });
  }
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  if (Object.keys(payload).length === 0) {
    return Response.json({ error: "empty_payload" }, { status: 422 });
  }

  const ontology = await loadOntology(getRuntimeOntologyDir());

  // evaluateGrow filters out fields the (existing) type already has and decides
  // additive-vs-escalate; pass ALL payload keys as the unfit set. Evidence-gated.
  let decision;
  try {
    decision = evaluateGrow(
      { target_type, unfit_fields: payload, evidence_rows: [`raw_inbox:${inbox_id}`] },
      ontology,
    );
  } catch (e) {
    return Response.json({ error: "evaluate_failed", detail: String(e) }, { status: 422 });
  }

  const { additive, structural } = growDecisionToDiffs(decision, ontology);
  const store = getProposalStore();
  const sid = `growth:${inbox_id}`;

  const escalated: string[] = [];
  const autoApplied: string[] = [];
  const proposalIds: string[] = [];

  // New concept -> ALWAYS a pending proposal the steward approves on /graph.
  if (structural) {
    const p = await store.createPending(sid, structural);
    proposalIds.push(p.id);
    escalated.push(...Object.keys(structural.new_object_types));
  }

  // Novel fields on an existing type -> additive, auto-applied through the
  // audited apply pipeline. Fail-soft: if apply throws, leave the proposal
  // PENDING so the field still surfaces on the graph for a manual approve.
  if (additive) {
    const p = await store.createPending(sid, additive);
    proposalIds.push(p.id);
    const ok = await tryAutoApply(p, db, rt.actor.email || rt.actor.userId);
    if (ok) {
      await store.setStatus(p.id, "approved");
      for (const [t, ot] of Object.entries(additive.new_object_types)) {
        for (const f of Object.keys(ot.properties)) autoApplied.push(`${t}.${f}`);
      }
    }
  }

  if (!structural && !additive) {
    return Response.json({ ok: true, grew: false, message: "row already fits the ontology" });
  }

  return Response.json({ ok: true, grew: true, escalated, autoApplied, proposalIds });
}

async function tryAutoApply(
  proposal: Proposal,
  db: ReturnType<typeof getDb>,
  actorId: string,
): Promise<boolean> {
  try {
    const packageRoot = process.cwd();
    const result = await applyProposal(proposal, {
      yamlWriter: new FsYamlWriter(),
      codegen: new GeneratedFilesCodegen({ packageRoot }),
      migrations: new DiffMigrationRunner(proposal.diff as ProposalDiff, db, packageRoot),
      inbox: new PgInboxMigrator(),
      audit: new PgAuditStore(db),
      proposals: new PgProposalStatusStore(),
      viewRegistry: new PgApprovedViewsRegistry(db),
      tx: new PgTransactionRunner(db),
      ontologyRoot: path.join(packageRoot, "ontology"),
      actor: { id: actorId, role: "steward" },
    });
    return result.ok;
  } catch {
    return false;
  }
}
