// M2.3 step-1: failing test that asserts the seed declares delete_member
// as a high-risk, confirm_if_unfamiliar action.
//
// delete_member is the canonical example for M2.3's confirm_if_unfamiliar
// policy because:
//   1. It's irreversibly destructive — the kind of operation an agent must
//      not silently auto-fire even for a steward.
//   2. It has a stable param shape (just { id }) so familiarity-by-shape is
//      meaningful: once the steward has confirmed three deletions, the agent
//      may auto-apply subsequent ones in the same chat run.
//
// The test reads the seed via the same loader the runtime uses, so any drift
// between this assertion and what gets generated into types/zod/migrations is
// caught upstream.

import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadOntology } from "./load";

const PKG_ROOT = path.resolve(__dirname, "..", "..");
const SEED_DIR = path.join(PKG_ROOT, "seed", "small-community");

describe("seed/small-community — delete_member action_type", () => {
  it("is declared with deletes:Member + agent_policy:confirm_if_unfamiliar + steward-only permissions", async () => {
    const ontology = await loadOntology(SEED_DIR);
    const def = ontology.action_types.delete_member;
    expect(def, "delete_member must exist in seed").toBeDefined();
    expect(def.deletes).toBe("Member");
    expect(def.agent_policy).toBe("confirm_if_unfamiliar");
    expect(def.permissions).toEqual(["steward"]);
    expect(def.parameters?.id).toMatchObject({
      type: "uuid",
      required: true,
    });
  });
});
