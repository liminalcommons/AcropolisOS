import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyProposal, type ApplyDeps } from "./apply";
import {
  InMemoryProposalDraftStore,
  type Proposal,
} from "./store";
import { InMemoryAuditStore } from "../audit/writer";
import { FsYamlWriter } from "./adapters/yaml-writer";
import { GeneratedFilesCodegen } from "./adapters/codegen";
import { loadOntology } from "../ontology/load";

const PKG_ROOT = path.resolve(__dirname, "..", "..");
const SOURCE_SEED = path.join(
  PKG_ROOT,
  "seed",
  "small-community",
);

interface Sandbox {
  root: string;
  ontologyRoot: string;
  packageRoot: string;
}

async function makeSandbox(): Promise<Sandbox> {
  const root = await mkdtemp(path.join(tmpdir(), "apply-int-"));
  const packageRoot = path.join(root, "pkg");
  const ontologyRoot = path.join(packageRoot, "seed", "small-community");
  await mkdir(path.dirname(ontologyRoot), { recursive: true });
  await cp(SOURCE_SEED, ontologyRoot, { recursive: true });
  // Also create empty lib/ontology, lib/agent, lib/db so codegen has output dirs.
  await mkdir(path.join(packageRoot, "lib", "ontology"), { recursive: true });
  await mkdir(path.join(packageRoot, "lib", "agent"), { recursive: true });
  await mkdir(path.join(packageRoot, "lib", "db"), { recursive: true });
  return { root, ontologyRoot, packageRoot };
}

async function finalizeProposalAddingThread(): Promise<Proposal> {
  const store = new InMemoryProposalDraftStore();
  await store.appendObjectType("s1", "Thread", {
    description: "A discussion thread",
    properties: {
      id: { type: "uuid", primary_key: true },
      title: { type: "string", required: true },
    },
  });
  await store.appendLinkType("s1", "thread_replies", {
    from: "Member",
    to: "Thread",
    cardinality: "one-to-many",
  });
  await store.appendSharedProperty("s1", "slug", {
    type: "string",
    description: "URL-safe identifier",
  });
  await store.appendSeed("s1", {
    object_type: "Thread",
    rows_jsonl: '{"id":"a","title":"hi"}\n',
  });
  await store.appendIngest("s1", "email_to_thread", {
    inbox_ids: ["inbox-1"],
    target_object_type: "Thread",
    mapping: { subject: "title" },
  });
  return store.finalize("s1");
}

function buildDeps(sb: Sandbox, opts: {
  failMigration?: boolean;
} = {}): { deps: ApplyDeps; rec: { gitCommits: number; statusUpdates: number; auditWrites: () => Promise<number>; auditStore: InMemoryAuditStore } } {
  const auditStore = new InMemoryAuditStore();
  const gitCommitsRef = { count: 0 };
  const statusRef = { count: 0 };

  const deps: ApplyDeps = {
    yamlWriter: new FsYamlWriter(),
    codegen: new GeneratedFilesCodegen({ packageRoot: sb.packageRoot }),
    migrations: {
      async generate() {
        if (opts.failMigration) throw new Error("forced migration failure");
        return { sql: "-- noop", tag: "9999_test" };
      },
      async apply() {
        /* no-op for integration */
      },
    },
    inbox: {
      async migrate(_tx, ingests) {
        return Object.values(ingests).reduce(
          (acc, i) => acc + i.inbox_ids.length,
          0,
        );
      },
    },
    audit: auditStore,
    proposals: {
      async markApplied() {
        statusRef.count++;
      },
    },
    git: {
      async addAndCommit() {
        gitCommitsRef.count++;
      },
    },
    tx: {
      async run(fn) {
        return fn({ tag: "fake" });
      },
    },
    ontologyRoot: sb.ontologyRoot,
    actor: { id: "steward-int", role: "steward" },
  };

  return {
    deps,
    rec: {
      get gitCommits() {
        return gitCommitsRef.count;
      },
      get statusUpdates() {
        return statusRef.count;
      },
      auditWrites: async () => (await auditStore.listOntologyAudit()).length,
      auditStore,
    } as never,
  };
}

describe("applyProposal — integration with real YAML + codegen adapters", () => {
  let sb: Sandbox;

  beforeEach(async () => {
    sb = await makeSandbox();
  });
  afterEach(async () => {
    await rm(sb.root, { recursive: true, force: true });
  });

  it("writes YAML, regenerates artifacts, and the new ontology loads + integrity-checks", async () => {
    const proposal = await finalizeProposalAddingThread();
    const { deps, rec } = buildDeps(sb);

    const result = await applyProposal(proposal, deps);
    expect(result.ok).toBe(true);
    expect(rec.gitCommits).toBe(1);
    expect(rec.statusUpdates).toBe(1);
    expect(await rec.auditWrites()).toBe(1);

    // YAML files written
    const threadYaml = await readFile(
      path.join(sb.ontologyRoot, "object-types", "thread.yaml"),
      "utf8",
    );
    expect(threadYaml).toMatch(/Thread:/);
    expect(threadYaml).toMatch(/title:/);

    const propertiesYaml = await readFile(
      path.join(sb.ontologyRoot, "properties.yaml"),
      "utf8",
    );
    expect(propertiesYaml).toMatch(/slug:/);
    expect(propertiesYaml).toMatch(/email:/); // preserved existing

    const linkYaml = await readFile(
      path.join(sb.ontologyRoot, "link-types.yaml"),
      "utf8",
    );
    expect(linkYaml).toMatch(/thread_replies:/);
    expect(linkYaml).toMatch(/attended:/); // preserved existing

    // Loader picks up the new ontology and integrity check passes
    const reloaded = await loadOntology(sb.ontologyRoot);
    expect(Object.keys(reloaded.object_types).sort()).toEqual([
      "Event",
      "MeetingMinute",
      "Member",
      "Thread",
    ]);
    expect(reloaded.link_types.thread_replies.cardinality).toBe("one-to-many");
    expect(reloaded.properties.slug.type).toBe("string");

    // Generated artifacts contain the new type
    const drizzle = await readFile(
      path.join(sb.packageRoot, "lib", "db", "schema.generated.ts"),
      "utf8",
    );
    expect(drizzle).toMatch(/export const thread = pgTable/);

    const zod = await readFile(
      path.join(sb.packageRoot, "lib", "ontology", "types.generated.ts"),
      "utf8",
    );
    expect(zod).toMatch(/ThreadSchema/);

    // Seed + ingest sibling artifacts
    const seedFile = await readFile(
      path.join(sb.packageRoot, "seed", "small-community", "seeds", "Thread.jsonl"),
      "utf8",
    );
    expect(seedFile).toMatch(/"id":"a"/);

    const ingestFile = await readFile(
      path.join(sb.packageRoot, "seed", "small-community", "ingests", "email_to_thread.yaml"),
      "utf8",
    );
    expect(ingestFile).toMatch(/target_object_type: Thread/);
  });

  it("rolls back YAML + generated files when migration generation throws", async () => {
    const proposal = await finalizeProposalAddingThread();
    const { deps, rec } = buildDeps(sb, { failMigration: true });

    // capture pre-apply state for comparison
    const beforeProps = await readFile(
      path.join(sb.ontologyRoot, "properties.yaml"),
      "utf8",
    );
    const beforeLinks = await readFile(
      path.join(sb.ontologyRoot, "link-types.yaml"),
      "utf8",
    );

    const result = await applyProposal(proposal, deps);
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/forced migration failure/);
    expect(rec.gitCommits).toBe(0);
    expect(rec.statusUpdates).toBe(0);

    // properties.yaml + link-types.yaml restored exactly
    const afterProps = await readFile(
      path.join(sb.ontologyRoot, "properties.yaml"),
      "utf8",
    );
    const afterLinks = await readFile(
      path.join(sb.ontologyRoot, "link-types.yaml"),
      "utf8",
    );
    expect(afterProps).toBe(beforeProps);
    expect(afterLinks).toBe(beforeLinks);

    // object-types/thread.yaml was new — should have been removed on rollback
    await expect(
      readFile(
        path.join(sb.ontologyRoot, "object-types", "thread.yaml"),
        "utf8",
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });

    // generated files that were created from scratch should be deleted too
    await expect(
      readFile(
        path.join(sb.packageRoot, "lib", "db", "schema.generated.ts"),
        "utf8",
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });

    // Reloading the seed must still succeed (no broken state left behind)
    const reloaded = await loadOntology(sb.ontologyRoot);
    expect(Object.keys(reloaded.object_types).sort()).toEqual([
      "Event",
      "MeetingMinute",
      "Member",
    ]);
  });
});
