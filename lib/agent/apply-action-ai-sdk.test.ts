// M2.2 step-4: ai-sdk-shaped apply_action tool builder test.
//
// The Mastra-shaped apply_action in tool-gating.ts targets the Agent API.
// /api/chat uses ai-sdk v6's streamText, which wants `ai.tool({...})` shape.
// This module emits the same discriminated input + same dispatch logic but
// in ai-sdk form, and adds an explicit `bypass_confirmation?: boolean` so
// the UI's Confirm button can re-fire the call past the always_confirm gate.

import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadOntology } from "../ontology/load";
import { createCtx, createInMemoryStore } from "../ontology/ctx";
import { InMemoryAuditStore } from "../audit/writer";
import type { Actor } from "../ctx";
import { createInProcessDispatcher } from "../actions/dispatcher";
import { buildApplyActionAiSdkTool } from "./apply-action-ai-sdk";

const SEED_ROOT = path.resolve(__dirname, "..", "..", "seed", "small-community");
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
    joined_at: "2025-01-01",
    tier: "basic",
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
    expect(after?.tier).toBe("basic");
    const rows = await audit.listActionAudit();
    expect(rows.find((r) => r.metadata.result === "ok")).toBeUndefined();
  });

  it("with bypass_confirmation=true: dispatches the action and mutates the row", async () => {
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
        bypass_confirmation: true,
      } as never,
      {} as never,
    )) as { ok: boolean; audit_id?: string | null };

    expect(out.ok).toBe(true);
    expect(out.audit_id).toBeTypeOf("string");
    const after = await db.objects.Member.findById(MEMBER_ID);
    expect(after?.tier).toBe("sustaining");
    const rows = await audit.listActionAudit();
    expect(
      rows.find(
        (r) => r.subject_id === "change_tier" && r.metadata.result === "ok",
      ),
    ).toBeDefined();
  });
});
