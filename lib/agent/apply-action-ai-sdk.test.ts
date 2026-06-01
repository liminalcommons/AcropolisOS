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
import { z } from "zod";
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
    expect(tool).not.toBeNull();
    expect(typeof tool!.execute).toBe("function");
    expect(typeof tool!.description).toBe("string");
  });

  it("returns null when the actor can invoke no actions — no degenerate (type:null) schema", async () => {
    // Regression: with zero allowed actions the old builder returned a z.never()
    // inputSchema, which serializes to a function schema with no object `type`.
    // Strict providers (DeepSeek) reject it as `type: null`, failing the WHOLE
    // chat request. The builder must instead return null so the caller omits the
    // tool. Reproduced with an ontology that declares no action_types.
    const { ctx, dispatcher } = await setup(steward);
    const emptyOntology = { object_types: {}, action_types: {}, link_types: {}, properties: {} } as never;
    const tool = buildApplyActionAiSdkTool({ actor: steward, ontology: emptyOntology, ctx, dispatcher });
    expect(tool).toBeNull();
  });

  it("emits a top-level type:object JSON schema — strict providers reject a top-level oneOf", async () => {
    // Regression: with multiple allowed actions the schema was a z.discriminatedUnion,
    // which serializes to a top-level `oneOf` with no `type`. DeepSeek rejects that as
    // `type: null`, failing the WHOLE chat request. The top level must be an object.
    const { ontology, ctx, dispatcher } = await setup(steward);
    const tool = buildApplyActionAiSdkTool({ actor: steward, ontology, ctx, dispatcher });
    expect(tool).not.toBeNull();
    const json = z.toJSONSchema(tool!.inputSchema as z.ZodType) as { type?: string; oneOf?: unknown };
    expect(json.type).toBe("object");
    expect(json.oneOf).toBeUndefined();
  });

  it("without bypass: returns confirmation_required for change_tier (always_confirm)", async () => {
    const { ontology, db, audit, ctx, dispatcher } = await setup(steward);
    const tool = buildApplyActionAiSdkTool({
      actor: steward,
      ontology,
      ctx,
      dispatcher,
    });
    const out = (await tool!.execute!(
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
    const out = (await tool!.execute!(
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
