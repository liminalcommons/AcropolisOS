import { describe, expect, it } from "vitest";
import { applyProposal, type ApplyDeps } from "./apply";
import { InMemoryProposalDraftStore, type Proposal } from "./store";
import { InMemoryAuditStore } from "../audit/writer";
import { InMemoryApprovedViewsRegistry } from "../views/registry";

async function viewProposal(): Promise<Proposal> {
  const store = new InMemoryProposalDraftStore();
  await store.appendView("s1", {
    scope: "role",
    scope_key: "steward",
    descriptors: [{ id: "v1", kind: "metric", config: { type: "member", agg: "count" } }],
  });
  return store.finalize("s1");
}

function noopDeps(registry: InMemoryApprovedViewsRegistry): ApplyDeps {
  return {
    yamlWriter: { writeUpdates: async () => ({ files: [] }), restore: async () => {} },
    codegen: { regenerate: async () => ({ files: [] }), restore: async () => {} },
    migrations: {
      generate: async () => ({ sql: "", tag: "noop" }),
      apply: async () => {},
    },
    inbox: { migrate: async () => 0 },
    audit: new InMemoryAuditStore(),
    proposals: { markApplied: async () => {} },
    tx: { run: async (fn) => fn({ tag: "noop" }) },
    viewRegistry: registry,
    ontologyRoot: "/tmp/onto",
    actor: { id: "steward@x", role: "steward" },
  };
}

describe("applyProposal — view config materialization", () => {
  it("writes new_view_configs into the registry under the right scope", async () => {
    const registry = new InMemoryApprovedViewsRegistry();
    const result = await applyProposal(await viewProposal(), noopDeps(registry));
    expect(result.ok).toBe(true);
    const rows = await registry.get({ scope: "role", scope_key: "steward" });
    expect(rows.map((d) => d.id)).toEqual(["v1"]);
  });
});
