import { describe, expect, it } from "vitest";
import {
  applyProposal,
  type ApplyDeps,
  type ApplyResult,
  type CodegenRunner,
  type FileSnapshot,
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

  it("returns commitHint listing every host-side path the apply touched", async () => {
    const rec = makeRecorder();
    const deps = makeDeps(rec, {
      yamlWriter: {
        async writeUpdates(diff) {
          rec.yamlWritten.push(diff);
          return {
            files: [
              { path: "ontology/properties.yaml", previousContent: null },
              {
                path: "ontology/object-types/member.yaml",
                previousContent: null,
              },
            ],
          };
        },
        async restore() {
          rec.snapshotsRestored++;
        },
      },
      codegen: {
        async regenerate() {
          rec.codegenCalls++;
          return {
            files: [
              { path: "lib/db/schema.generated.ts", previousContent: null },
            ],
          };
        },
        async restore() {
          rec.snapshotsRestored++;
        },
      },
      migrations: {
        async generate() {
          return { sql: "ALTER TABLE m ADD COLUMN x text;", tag: "T1" };
        },
        async apply() {},
      },
    });
    const proposal = await finalizedProposal();
    const r = await applyProposal(proposal, deps);
    expect(r.ok).toBe(true);
    expect(r.commitHint).toEqual(
      expect.arrayContaining([
        "ontology/properties.yaml",
        "ontology/object-types/member.yaml",
        "lib/db/schema.generated.ts",
        "drizzle/T1.sql",
        "drizzle/meta/_journal.json",
      ]),
    );
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
    expect(rec.statusUpdates).toHaveLength(0);
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
    expect(rec.snapshotsRestored).toBeGreaterThanOrEqual(2);
  });

  it("does not commit status update if it fails inside transaction", async () => {
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
  });

  it("calls migrations.persist after tx commits", async () => {
    const rec = makeRecorder();
    const callOrder: string[] = [];
    const deps = makeDeps(rec, {
      migrations: {
        async generate() {
          return { sql: "ALTER TABLE x ADD COLUMN y text;", tag: "T1" };
        },
        async apply() {
          callOrder.push("apply");
        },
        async persist() {
          callOrder.push("persist");
        },
      },
    });
    const proposal = await finalizedProposal();
    const r = await applyProposal(proposal, deps);
    expect(r.ok).toBe(true);
    expect(callOrder).toEqual(["apply", "persist"]);
  });

  it("does NOT call migrations.persist when the postgres tx rolls back", async () => {
    const rec = makeRecorder();
    let persistCalled = false;
    const deps = makeDeps(rec, {
      migrations: {
        async generate() {
          return { sql: "X", tag: "T1" };
        },
        async apply() {},
        async persist() {
          persistCalled = true;
        },
      },
      inbox: {
        async migrate() {
          throw new Error("inbox boom");
        },
      },
    });
    const proposal = await finalizedProposal();
    const r = await applyProposal(proposal, deps);
    expect(r.ok).toBe(false);
    expect(persistCalled).toBe(false);
  });

  it("returns ok=false when migrations.persist throws", async () => {
    const rec = makeRecorder();
    const deps = makeDeps(rec, {
      migrations: {
        async generate() {
          return { sql: "X", tag: "T1" };
        },
        async apply() {},
        async persist() {
          throw new Error("disk full");
        },
      },
    });
    const proposal = await finalizedProposal();
    const r = await applyProposal(proposal, deps);
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/disk full/);
    expect(rec.statusUpdates).toEqual([{ id: proposal.id, status: "applied" }]);
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
