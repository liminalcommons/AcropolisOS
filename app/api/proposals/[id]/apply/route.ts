import path from "node:path";
import { ProposalNotFoundError } from "@/lib/proposals/store";
import { getProposalStore } from "@/lib/proposals/singleton";
import { getDb } from "@/lib/db/client";
import { applyProposal } from "@/lib/proposals/apply";
import { FsYamlWriter } from "@/lib/proposals/adapters/yaml-writer";
import { GeneratedFilesCodegen } from "@/lib/proposals/adapters/codegen";
import {
  BestEffortGitClient,
  DiffMigrationRunner,
  PgAuditStore,
  PgInboxMigrator,
  PgProposalStatusStore,
  PgTransactionRunner,
} from "@/lib/proposals/adapters/runtime";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(
  _req: Request,
  ctx: RouteCtx,
): Promise<Response> {
  const { id } = await ctx.params;

  // Pull the actor from the active NextAuth session so the audit row carries
  // who clicked Apply. Falls back to a sentinel when the route is hit outside
  // an authenticated context (CI smokes, edge cases).
  const session = await auth().catch(() => null);
  const actorId =
    (session?.user?.email as string | undefined) ?? "steward@local";
  const actorRole = "steward";

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
    migrations: new DiffMigrationRunner(proposal.diff, db),
    inbox: new PgInboxMigrator(),
    audit: new PgAuditStore(db),
    proposals: new PgProposalStatusStore(),
    git: new BestEffortGitClient(packageRoot),
    tx: new PgTransactionRunner(db),
    ontologyRoot,
    actor: { id: actorId, role: actorRole },
    attribution: `${actorId} <${actorId}>`,
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
    });
  } catch (err) {
    if (err instanceof ProposalNotFoundError) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    throw err;
  }
}
