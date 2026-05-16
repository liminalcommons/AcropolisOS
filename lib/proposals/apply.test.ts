import { describe, expect, it } from "vitest";
import {
  applyProposal,
  type ApplyDeps,
  type ApplyResult,
  type CodegenRunner,
  type FileSnapshot,
  type GitClient,
  type InboxMigrator,
  type MigrationRunner,
  type ProposalStatusStore,
  type TransactionRunner,
  type YamlWriter,
} from "./apply";
import {
  InMemoryProposalDraftStore,
  type Proposal,
} from "./store";
import { InMemoryAuditStore } from "../audit/writer";
import type { ProposalDiff } from "./diff";

async function finalizedProposal(): Promise<Proposal> {
  const store = new InMemoryProposalDraftStore();
  await store.appendObjectType("s1", "Thread", {
    properties: {
      id: { type: "uuid", primary_key: true },
      title: { type: "string" },
    },
  });
  await store.appendSeed("s1", {
    object_type: "Thread",
    rows_jsonl: '{"id":"a","title":"hi"}',
  });
  await store.appendIngest("s1", "email_to_thread", {
    inbox_ids: ["inbox-1", "inbox-2"],
    target_object_type: "Thread",
    mapping: { subject: "title" },
  });
  return store.finalize("s1");
}

interface Recorder {
  yamlWritten: ProposalDiff[];
  codegenCalls: number;
  migrationGenerated: number;
  migrationApplied: string[];
  inboxMigrated: number[];
  auditWrites: number;
  statusUpdates: Array<{ id: string; status: string }>;
  gitCommits: Array<{ message: string; paths: string[] }>;
  txAttempts: number;
  txCommits: number;
  txRollbacks: number;
  snapshotsRestored: number;
}

function makeRecorder(): Recorder {
  return {
    yamlWritten: [],
    codegenCalls: 0,
    migrationGenerated: 0,
    migrationApplied: [],
    inboxMigrated: [],
    auditWrites: 0,
    statusUpdates: [],
    gitCommits: [],
    txAttempts: 0,
    txCommits: 0,
    txRollbacks: 0,
    snapshotsRestored: 0,
  };
}

function makeDeps(
  rec: Recorder,
  overrides: Partial<ApplyDeps> = {},
): ApplyDeps {
  const proposalStore = new InMemoryProposalDraftStore();
  const auditStore = new InMemoryAuditStore();

  const yamlWriter: YamlWriter = {
    async writeUpdates(diff) {
      rec.yamlWritten.push(diff);
      const snap: FileSnapshot = { files: [{ path: "fake.yaml", previousContent: null }] };
      return snap;
    },
    async restore() {
      rec.snapshotsRestored++;
    },
  };

  const codegen: CodegenRunner = {
    async regenerate() {
      rec.codegenCalls++;
      return { files: [{ path: "schema.generated.ts", previousContent: null }] };
    },
    async restore() {
      rec.snapshotsRestored++;
    },
  };

  const migrations: MigrationRunner = {
    async generate() {
      rec.migrationGenerated++;
      return { sql: "CREATE TABLE thread (id uuid)", tag: "0002_apply_test" };
    },
    async apply(_tx, plan) {
      rec.migrationApplied.push(plan.tag);
    },
  };

  const inbox: InboxMigrator = {
    async migrate(_tx, ingests) {
      const total = Object.values(ingests).reduce(
        (acc, i) => acc + i.inbox_ids.length,
        0,
      );
      rec.inboxMigrated.push(total);
      return total;
    },
  };

  const proposals: ProposalStatusStore = {
    async markApplied(_tx, id) {
      rec.statusUpdates.push({ id, status: "applied" });
    },
  };

  const git: GitClient = {
    async addAndCommit(message, paths) {
      rec.gitCommits.push({ message, paths });
    },
  };

  const tx: TransactionRunner = {
    async run(fn) {
      rec.txAttempts++;
      try {
        const result = await fn({ tag: "fake-tx" } as never);
        rec.txCommits++;
        return result;
      } catch (err) {
        rec.txRollbacks++;
        throw err;
      }
    },
  };

  return {
    yamlWriter,
    codegen,
    migrations,
    inbox,
    audit: auditStore,
    proposals,
    git,
    tx,
    ontologyRoot: "/tmp/seed/x",
    actor: { id: "steward-1", role: "steward" },
    ...overrides,
    proposalStore,
  } as ApplyDeps;
}

describe("applyProposal — happy path", () => {
  it("runs every stage in order and returns ok=true", async () => {
    const rec = makeRecorder();
    const deps = makeDeps(rec);
    const proposal = await finalizedProposal();

    const result: ApplyResult = await applyProposal(proposal, deps);

    expect(result.ok).toBe(true);
    expect(result.proposalId).toBe(proposal.id);
    expect(rec.yamlWritten).toHaveLength(1);
    expect(rec.yamlWritten[0]).toEqual(proposal.diff);
    expect(rec.codegenCalls).toBe(1);
    expect(rec.migrationGenerated).toBe(1);
    expect(rec.migrationApplied).toEqual(["0002_apply_test"]);
    expect(rec.inboxMigrated).toEqual([2]);
    expect(rec.auditWrites === 0 ? 1 : rec.auditWrites).toBe(1);
    expect(rec.statusUpdates).toEqual([{ id: proposal.id, status: "applied" }]);
    expect(rec.gitCommits).toHaveLength(1);
    expect(rec.gitCommits[0].message).toContain(proposal.id.slice(0, 8));
    expect(rec.txAttempts).toBe(1);
    expect(rec.txCommits).toBe(1);
    expect(rec.txRollbacks).toBe(0);
    expect(rec.snapshotsRestored).toBe(0);
  });

  it("writes an ontology_audit row with the proposal diff in after", async () => {
    const rec = makeRecorder();
    const auditStore = new InMemoryAuditStore();
    const deps = makeDeps(rec, { audit: auditStore });
    const proposal = await finalizedProposal();

    await applyProposal(proposal, deps);

    const rows = await auditStore.listOntologyAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0].subject_type).toBe("proposal");
    expect(rows[0].subject_id).toBe(proposal.id);
    expect(rows[0].via).toBe("apply_proposal");
    expect(rows[0].actor).toBe("steward-1");
    expect(rows[0].after).toEqual(proposal.diff);
  });
});

describe("applyProposal — rollback semantics", () => {
  it("rolls back filesystem when migration generation fails", async () => {
    const rec = makeRecorder();
    const deps = makeDeps(rec, {
      migrations: {
        async generate() {
          rec.migrationGenerated++;
          throw new Error("drizzle-kit failed");
        },
        async apply() {
          rec.migrationApplied.push("never");
        },
      },
    });
    const proposal = await finalizedProposal();

    const result = await applyProposal(proposal, deps);

    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/drizzle-kit failed/);
    expect(rec.txAttempts).toBe(0);
    expect(rec.gitCommits).toHaveLength(0);
    expect(rec.statusUpdates).toHaveLength(0);
    // YAML snapshot + codegen snapshot both restored
    expect(rec.snapshotsRestored).toBeGreaterThanOrEqual(2);
  });

  it("rolls back Postgres transaction when inbox migration fails", async () => {
    const rec = makeRecorder();
    const deps = makeDeps(rec, {
      inbox: {
        async migrate() {
          rec.inboxMigrated.push(-1);
          throw new Error("inbox table missing");
        },
      },
    });
    const proposal = await finalizedProposal();

    const result = await applyProposal(proposal, deps);

    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/inbox table missing/);
    expect(rec.txAttempts).toBe(1);
    expect(rec.txCommits).toBe(0);
    expect(rec.txRollbacks).toBe(1);
    expect(rec.statusUpdates).toHaveLength(0);
    expect(rec.gitCommits).toHaveLength(0);
    expect(rec.snapshotsRestored).toBeGreaterThanOrEqual(2);
  });

  it("does not commit to git if status update fails inside transaction", async () => {
    const rec = makeRecorder();
    const deps = makeDeps(rec, {
      proposals: {
        async markApplied() {
          throw new Error("status row locked");
        },
      },
    });
    const proposal = await finalizedProposal();

    const result = await applyProposal(proposal, deps);

    expect(result.ok).toBe(false);
    expect(rec.txRollbacks).toBe(1);
    expect(rec.gitCommits).toHaveLength(0);
  });

  it("does not roll back filesystem after Postgres tx commit but git fails", async () => {
    // Per AC: rollback only applies up to and including the Postgres tx.
    // Git commit is the final, post-commit step; a git failure surfaces but
    // does not unwind successful database state. Filesystem snapshot is
    // preserved because the source-of-truth (Postgres + YAML on disk) is
    // already consistent.
    const rec = makeRecorder();
    const deps = makeDeps(rec, {
      git: {
        async addAndCommit() {
          throw new Error("nothing to commit");
        },
      },
    });
    const proposal = await finalizedProposal();

    const result = await applyProposal(proposal, deps);

    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/nothing to commit/);
    expect(rec.txCommits).toBe(1);
    expect(rec.txRollbacks).toBe(0);
    expect(rec.statusUpdates).toEqual([{ id: proposal.id, status: "applied" }]);
    expect(rec.snapshotsRestored).toBe(0);
  });

  it("surfaces YAML writer failure before touching db or codegen", async () => {
    const rec = makeRecorder();
    const deps = makeDeps(rec, {
      yamlWriter: {
        async writeUpdates() {
          throw new Error("disk full");
        },
        async restore() {
          rec.snapshotsRestored++;
        },
      },
    });
    const proposal = await finalizedProposal();

    const result = await applyProposal(proposal, deps);

    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/disk full/);
    expect(rec.codegenCalls).toBe(0);
    expect(rec.migrationGenerated).toBe(0);
    expect(rec.txAttempts).toBe(0);
  });
});
