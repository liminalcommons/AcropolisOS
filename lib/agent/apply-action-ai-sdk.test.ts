// M2.2 step-4: ai-sdk-shaped apply_action tool builder test.
//
// The Mastra-shaped apply_action in tool-gating.ts targets the Agent API.
// /api/chat uses ai-sdk v6's streamText, which wants `ai.tool({...})` shape.
// This module emits the same discriminated input + same dispatch logic but
// in ai-sdk form.
//
// M3.8 #35: bypass_confirmation is NOT in the tool schema and is NOT honored
// from tool-call args. The confirm path goes through /api/chat/confirm which
// sets bypassConfirmation=true server-side.

import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadOntology } from "../ontology/load";
import { createCtx, createInMemoryStore } from "../ontology/ctx";
import { InMemoryAuditStore } from "../audit/writer";
import type { Actor } from "../ctx";
import { createInProcessDispatcher } from "../actions/dispatcher";
import { buildApplyActionAiSdkTool } from "./apply-action-ai-sdk";

const SEED_ROOT = path.resolve(__dirname, "..", "..", "scenarios", "small-community", "ontology");
const FUNCTIONS_DIR = path.resolve(__dirname, "..", "..", "functions");

const steward: Actor = {
  userId: "u-steward",
  email: "s@x.test",
  role: "steward",
  customRoles: [],
};

const MEMBER_ID = "11111111-1111-1111-1111-111111111111";

async function setup(actor: Actor) {
  const ontology = await loadOntology(SEED_ROOT);
  const db = createInMemoryStore();
  const audit = new InMemoryAuditStore();
  await db.objects.Member.create({
    id: MEMBER_ID,
    full_name: "Test",
    email: "t@x.test",
    phone: "555-0000",
    tier_role: "staff",
    started_at: "2025-01-01",
    notes: "",
  });
  const ctx = createCtx({ db, actor, audit });
  const dispatcher = createInProcessDispatcher({
    ctx,
    ontology,
    functionsDir: FUNCTIONS_DIR,
  });
  return { ontology, db, audit, ctx, dispatcher };
}

describe("buildApplyActionAiSdkTool — M2.2 step 4", () => {
  it("returns a tool object with description + execute", async () => {
    const { ontology, ctx, dispatcher } = await setup(steward);
    const tool = buildApplyActionAiSdkTool({
      actor: steward,
      ontology,
      ctx,
      dispatcher,
    });
    expect(tool).toBeDefined();
    expect(typeof tool.execute).toBe("function");
    expect(typeof tool.description).toBe("string");
  });

  it("without bypass: returns confirmation_required for change_tier (always_confirm)", async () => {
    const { ontology, db, audit, ctx, dispatcher } = await setup(steward);
    const tool = buildApplyActionAiSdkTool({
      actor: steward,
      ontology,
      ctx,
      dispatcher,
    });
    const out = (await tool.execute!(
      {
        action: "change_tier",
        params: { member: MEMBER_ID, new_tier: "sustaining" },
      } as never,
      {} as never,
    )) as { ok: boolean; confirmation_required?: unknown };

    expect(out.ok).toBe(false);
    expect(out.confirmation_required).toBeDefined();
    const after = await db.objects.Member.findById(MEMBER_ID);
    expect(after?.tier_role).toBe("staff");
    const rows = await audit.listActionAudit();
    expect(rows.find((r) => r.metadata.result === "ok")).toBeUndefined();
  });

  it("M3.8 #35: bypass_confirmation in tool-call args is IGNORED — always returns confirmation_required", async () => {
    // Even if an attacker (or prompt-injected model) passes bypass_confirmation:true
    // in the tool-call args, the execute() ignores it. The action still returns
    // confirmation_required. Bypass only works via /api/chat/confirm (server-side).
    const { ontology, db, audit, ctx, dispatcher } = await setup(steward);
    const tool = buildApplyActionAiSdkTool({
      actor: steward,
      ontology,
      ctx,
      dispatcher,
    });
    const out = (await tool.execute!(
      {
        action: "change_tier",
        params: { member: MEMBER_ID, new_tier: "sustaining" },
        bypass_confirmation: true, // should be ignored
      } as never,
      {} as never,
    )) as { ok: boolean; confirmation_required?: unknown };

    // Must still require confirmation — bypass_confirmation in args has no effect.
    expect(out.ok).toBe(false);
    expect(out.confirmation_required).toBeDefined();
    // Member tier must NOT have changed.
    const after = await db.objects.Member.findById(MEMBER_ID);
    expect(after?.tier_role).toBe("staff");
    // No ok audit row should exist.
    const rows = await audit.listActionAudit();
    expect(rows.find((r) => r.metadata.result === "ok")).toBeUndefined();
  });
});
