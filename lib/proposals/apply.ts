import type { AuditStore } from "../audit/writer";
import type { ProposalDiff } from "./diff";
import type { Proposal } from "./store";

export interface FileSnapshotEntry {
  path: string;
  previousContent: string | null;
}

export interface FileSnapshot {
  files: FileSnapshotEntry[];
}

export interface YamlWriter {
  writeUpdates(diff: ProposalDiff, ontologyRoot: string): Promise<FileSnapshot>;
  restore(snapshot: FileSnapshot): Promise<void>;
}

export interface CodegenRunner {
  regenerate(ontologyRoot: string): Promise<FileSnapshot>;
  restore(snapshot: FileSnapshot): Promise<void>;
}

export interface MigrationPlan {
  sql: string;
  tag: string;
}

export type Tx = { readonly tag: string };

export interface MigrationRunner {
  generate(): Promise<MigrationPlan>;
  apply(tx: Tx, plan: MigrationPlan): Promise<void>;
}

export interface InboxMigrator {
  migrate(
    tx: Tx,
    ingests: ProposalDiff["new_ingests"],
  ): Promise<number>;
}

export interface ProposalStatusStore {
  markApplied(tx: Tx, proposalId: string): Promise<void>;
}

export interface GitClient {
  addAndCommit(
    message: string,
    paths: string[],
    attribution?: string,
  ): Promise<void>;
}

export interface TransactionRunner {
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export interface ApplyActor {
  id: string;
  role: string;
}

export interface ApplyDeps {
  yamlWriter: YamlWriter;
  codegen: CodegenRunner;
  migrations: MigrationRunner;
  inbox: InboxMigrator;
  audit: AuditStore;
  proposals: ProposalStatusStore;
  git: GitClient;
  tx: TransactionRunner;
  ontologyRoot: string;
  actor: ApplyActor;
  attribution?: string;
}

export interface ApplyResult {
  ok: boolean;
  proposalId: string;
  migrationTag?: string;
  inboxRowsMigrated?: number;
  error?: Error;
}

function commitMessage(proposal: Proposal): string {
  const shortId = proposal.id.slice(0, 8);
  const objectCount = Object.keys(proposal.diff.new_object_types).length;
  const linkCount = Object.keys(proposal.diff.new_link_types).length;
  const actionCount = Object.keys(proposal.diff.new_action_types).length;
  const parts: string[] = [];
  if (objectCount > 0) parts.push(`${objectCount} object`);
  if (linkCount > 0) parts.push(`${linkCount} link`);
  if (actionCount > 0) parts.push(`${actionCount} action`);
  const summary = parts.length > 0 ? parts.join(", ") : "ontology update";
  return `proposal ${shortId}: apply ${summary}`;
}

function pathsTouched(
  yamlSnap: FileSnapshot,
  codegenSnap: FileSnapshot,
  migrationTag: string,
): string[] {
  const set = new Set<string>();
  for (const f of yamlSnap.files) set.add(f.path);
  for (const f of codegenSnap.files) set.add(f.path);
  set.add(`drizzle/${migrationTag}.sql`);
  set.add("drizzle/meta/_journal.json");
  return [...set];
}

export async function applyProposal(
  proposal: Proposal,
  deps: ApplyDeps,
): Promise<ApplyResult> {
  let yamlSnapshot: FileSnapshot | null = null;
  let codegenSnapshot: FileSnapshot | null = null;

  const rollbackFilesystem = async (): Promise<void> => {
    if (codegenSnapshot) {
      try {
        await deps.codegen.restore(codegenSnapshot);
      } catch {
        // best-effort rollback; original error takes precedence
      }
    }
    if (yamlSnapshot) {
      try {
        await deps.yamlWriter.restore(yamlSnapshot);
      } catch {
        // best-effort rollback
      }
    }
  };

  try {
    yamlSnapshot = await deps.yamlWriter.writeUpdates(
      proposal.diff,
      deps.ontologyRoot,
    );
  } catch (err) {
    return failure(proposal.id, err);
  }

  try {
    codegenSnapshot = await deps.codegen.regenerate(deps.ontologyRoot);
  } catch (err) {
    await rollbackFilesystem();
    return failure(proposal.id, err);
  }

  let migrationPlan: MigrationPlan;
  try {
    migrationPlan = await deps.migrations.generate();
  } catch (err) {
    await rollbackFilesystem();
    return failure(proposal.id, err);
  }

  let inboxRowsMigrated = 0;
  try {
    await deps.tx.run(async (tx) => {
      await deps.migrations.apply(tx, migrationPlan);
      inboxRowsMigrated = await deps.inbox.migrate(tx, proposal.diff.new_ingests);
      await deps.audit.insertOntologyAudit({
        actor: deps.actor.id,
        actor_role: deps.actor.role,
        via: "apply_proposal",
        subject_type: "proposal",
        subject_id: proposal.id,
        before: null,
        after: proposal.diff,
        metadata: {
          migration_tag: migrationPlan.tag,
          inbox_rows_migrated: inboxRowsMigrated,
          impacted_tables: proposal.diff.impacted_tables,
        },
      });
      await deps.proposals.markApplied(tx, proposal.id);
    });
  } catch (err) {
    await rollbackFilesystem();
    return failure(proposal.id, err);
  }

  // Postgres tx committed. Filesystem now reflects committed state — do
  // not roll back filesystem from this point on, even if git commit fails.
  try {
    const paths = pathsTouched(yamlSnapshot, codegenSnapshot, migrationPlan.tag);
    await deps.git.addAndCommit(
      commitMessage(proposal),
      paths,
      deps.attribution,
    );
  } catch (err) {
    return {
      ok: false,
      proposalId: proposal.id,
      migrationTag: migrationPlan.tag,
      inboxRowsMigrated,
      error: toError(err),
    };
  }

  return {
    ok: true,
    proposalId: proposal.id,
    migrationTag: migrationPlan.tag,
    inboxRowsMigrated,
  };
}

function failure(proposalId: string, err: unknown): ApplyResult {
  return { ok: false, proposalId, error: toError(err) };
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(String(err));
}
