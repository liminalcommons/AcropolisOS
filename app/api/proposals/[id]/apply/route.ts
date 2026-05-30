import path from "node:path";
import { ProposalNotFoundError } from "@/lib/proposals/store";
import { getProposalStore } from "@/lib/proposals/singleton";
import { getDb } from "@/lib/db/client";
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
import { InMemoryApprovedViewsRegistry } from "@/lib/views/registry";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(
  _req: Request,
  ctx: RouteCtx,
): Promise<Response> {
  const runtime_ctx = await buildChatRuntime();
  if (isAnonymous(runtime_ctx.actor)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  // M3.8 #46: use the role resolved from the session, never hardcode steward.
  // Any authenticated non-steward hitting this endpoint gets 403.
  const actorRole = runtime_ctx.actor.role;
  if (actorRole !== "steward") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const actorId = runtime_ctx.actor.email || runtime_ctx.actor.userId;

  const store = getProposalStore();
  const proposal = await store.getProposal(id);
  if (!proposal) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (proposal.status !== "pending") {
    return Response.json(
      { error: "not_pending", status: proposal.status },
      { status: 409 },
    );
  }

  const packageRoot = process.cwd();
  const ontologyRoot = path.join(packageRoot, "ontology");
  const db = getDb();

  const result = await applyProposal(proposal, {
    yamlWriter: new FsYamlWriter(),
    codegen: new GeneratedFilesCodegen({ packageRoot }),
    migrations: new DiffMigrationRunner(proposal.diff, db, packageRoot),
    inbox: new PgInboxMigrator(),
    audit: new PgAuditStore(db),
    proposals: new PgProposalStatusStore(),
    viewRegistry: new InMemoryApprovedViewsRegistry(),
    tx: new PgTransactionRunner(db),
    ontologyRoot,
    actor: { id: actorId, role: actorRole },
  });

  if (!result.ok) {
    return Response.json(
      {
        error: result.error?.message ?? "apply_failed",
        proposalId: result.proposalId,
      },
      { status: 500 },
    );
  }

  try {
    const updated = await store.setStatus(id, "approved");
    return Response.json({
      proposal: updated,
      migrationTag: result.migrationTag,
      inboxRowsMigrated: result.inboxRowsMigrated,
      commitHint: result.commitHint,
    });
  } catch (err) {
    if (err instanceof ProposalNotFoundError) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    throw err;
  }
}
