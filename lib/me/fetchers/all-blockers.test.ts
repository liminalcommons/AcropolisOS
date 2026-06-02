// Regression: getAllOpenBlockers MUST carry input_schema + confirm_action
// through its projection — the Focus surface (buildDecisionView) needs them to
// render the text_input + confirm_binary modes. They were dropped once (the
// projection predated those modes), which made confirm_binary fall back to a
// bare "Resolve" button live while every unit test (which builds DecisionInput
// directly) stayed green. This test closes that gap at the fetcher boundary.
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/ctx";
import {
  buildObjectPermissionsMap,
  createCtx,
  createInMemoryStore,
  type OntologyCtx,
} from "@/lib/ontology/ctx";
import { loadOntology } from "@/lib/ontology/load";
import type { AgentBlocker, Member } from "@/lib/ontology/types.generated";
import { getAllOpenBlockers } from "./all-blockers";

const SEED_ROOT = path.resolve(__dirname, "..", "..", "..", "scenarios", "small-community", "ontology");

const steward: Actor = {
  userId: "00000000-0000-4000-8000-0000000000cc",
  email: "stew@example.com",
  role: "steward",
  customRoles: [],
};

function makeMember(actor: Actor): Member {
  return {
    id: actor.userId,
    full_name: "Steward",
    email: actor.email,
    phone: "555-0000",
    tier_role: "staff",
    started_at: "2026-01-01",
    notes: "",
  };
}

let db: ReturnType<typeof createInMemoryStore>;
let ctxSteward: OntologyCtx;

beforeEach(async () => {
  db = createInMemoryStore();
  const ontology = await loadOntology(SEED_ROOT);
  const permissions = buildObjectPermissionsMap(ontology);
  ctxSteward = createCtx({ db, actor: steward, permissions });
  await db.objects.Member.create(makeMember(steward));
});

describe("getAllOpenBlockers — projection carries every resolution-mode payload", () => {
  it("preserves input_schema (text_input) and confirm_action (confirm_binary)", async () => {
    await db.objects.AgentBlocker.create({
      id: "00000000-0000-4000-8002-000000000001",
      blocked_actor_id: steward.userId,
      reason_kind: "missing_data",
      summary: "Need dietary info",
      detail: "Kitchen rota",
      resolution_mode: "text_input",
      input_schema: JSON.stringify({ kind: "string", prompt: "What is the guest's dietary need?" }),
      status: "open",
      created_at: new Date().toISOString(),
    } as AgentBlocker);
    await db.objects.AgentBlocker.create({
      id: "00000000-0000-4000-8002-000000000002",
      blocked_actor_id: steward.userId,
      reason_kind: "consent",
      summary: "Publish rules",
      detail: "Public board",
      resolution_mode: "confirm_binary",
      confirm_action: JSON.stringify({ label: "Post to public board", action: { type: "x" } }),
      status: "open",
      created_at: new Date().toISOString(),
    } as AgentBlocker);

    const open = await getAllOpenBlockers(ctxSteward);
    const text = open.find((b) => b.resolution_mode === "text_input");
    const confirm = open.find((b) => b.resolution_mode === "confirm_binary");

    expect(text?.input_schema).toBeTruthy();
    expect(String(text?.input_schema)).toContain("dietary need");
    expect(confirm?.confirm_action).toBeTruthy();
    expect(String(confirm?.confirm_action)).toContain("Post to public board");
  });
});
