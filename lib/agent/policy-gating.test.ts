// US-026: apply_action ↔ policy integration.
//
// `runApplyActionTool`, when wired with a policy gate, must:
//   - fire the dispatcher and return the result for auto_apply actions
//   - skip the dispatcher and return a structured confirmation_required
//     envelope for always_confirm or unfamiliar confirm_if_unfamiliar actions
//   - render the confirmation card payload with enough context for the chat
//     panel (action name, params, reason, required_permissions, prior_success_count)
//
// Policy is opt-in: callers that omit the `policy` field get the pre-US-026
// behavior (dispatcher always invoked). getToolsForActor wires the gate when
// a ctx is supplied so the production code path is policy-aware by default.

import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryAuditStore } from "../audit/writer";
import type { Actor } from "../ctx";
import { loadOntology } from "../ontology/load";
import {
  createCtx,
  createInMemoryStore,
  type OntologyCtx,
} from "../ontology/ctx";
import type { Ontology } from "../ontology/schema";
import { runApplyActionTool, getToolsForActor } from "./tool-gating";

const PKG_ROOT = path.resolve(__dirname, "..", "..");
const SMALL_COMMUNITY = path.join(
  PKG_ROOT,
  "scenarios",
  "small-community", "ontology",
);

const stewardActor: Actor = {
  userId: "u-steward",
  email: "s@example.com",
  role: "steward",
  customRoles: [],
};

let ontology: Ontology;
let audit: InMemoryAuditStore;
let stewardCtx: OntologyCtx;

beforeEach(async () => {
  ontology = await loadOntology(SMALL_COMMUNITY);
  audit = new InMemoryAuditStore();
  stewardCtx = createCtx({
    db: createInMemoryStore(),
    actor: stewardActor,
    audit,
  });
});

describe("apply_action — policy gating (US-026)", () => {
  it("fires the dispatcher when policy resolves to auto_apply", async () => {
    // mark_notification_read is auto_apply in the small-community seed.
    const dispatcher = vi.fn(async () => ({ marked: true }));
    const out = await runApplyActionTool({
      actor: stewardActor,
      dispatcher,
      action: "mark_notification_read",
      params: { notification_id: "n-1" },
      policy: { ontology, ctx: stewardCtx },
    });
    expect(dispatcher).toHaveBeenCalledOnce();
    expect(out.ok).toBe(true);
    expect(out.result).toEqual({ marked: true });
    expect(out.confirmation_required).toBeUndefined();
  });

  it("returns confirmation_required and SKIPS the dispatcher for always_confirm actions", async () => {
    // promote_to_steward is always_confirm with permissions: [steward] in the seed.
    const dispatcher = vi.fn(async () => ({ promoted: true }));
    const out = await runApplyActionTool({
      actor: stewardActor,
      dispatcher,
      action: "promote_to_steward",
      params: { member: "m-1" },
      policy: { ontology, ctx: stewardCtx },
    });
    expect(dispatcher).not.toHaveBeenCalled();
    expect(out.ok).toBe(false);
    expect(out.result).toBeUndefined();
    expect(out.error).toBeUndefined();
    expect(out.confirmation_required).toMatchObject({
      action: "promote_to_steward",
      reason: "always_confirm",
      required_permissions: ["steward"],
      params: { member: "m-1" },
    });
  });

  it("returns confirmation_required for confirm_if_unfamiliar when actor lacks prior successes", async () => {
    const onto: Ontology = {
      ...ontology,
      action_types: {
        ...ontology.action_types,
        promote_to_steward: {
          ...ontology.action_types.promote_to_steward,
          agent_policy: "confirm_if_unfamiliar",
        },
      },
    };
    const dispatcher = vi.fn(async () => ({ promoted: true }));
    const out = await runApplyActionTool({
      actor: stewardActor,
      dispatcher,
      action: "promote_to_steward",
      params: { member: "m-1" },
      policy: { ontology: onto, ctx: stewardCtx },
    });
    expect(dispatcher).not.toHaveBeenCalled();
    expect(out.confirmation_required).toMatchObject({
      action: "promote_to_steward",
      reason: "unfamiliar",
      prior_success_count: 0,
      required_permissions: ["steward"],
    });
  });

  it("fires the dispatcher for confirm_if_unfamiliar once familiarity threshold is met", async () => {
    const onto: Ontology = {
      ...ontology,
      action_types: {
        ...ontology.action_types,
        promote_to_steward: {
          ...ontology.action_types.promote_to_steward,
          agent_policy: "confirm_if_unfamiliar",
        },
      },
    };
    for (let i = 0; i < 3; i++) {
      await audit.insertActionAudit({
        actor: stewardActor.userId,
        actor_role: stewardActor.role,
        via: "inngest",
        subject_type: "action",
        subject_id: "promote_to_steward",
        before: null,
        after: null,
        metadata: {
          result: "ok",
          params: { member: `m-${i}` },
        },
      });
    }
    const dispatcher = vi.fn(async () => ({ promoted: true }));
    const out = await runApplyActionTool({
      actor: stewardActor,
      dispatcher,
      action: "promote_to_steward",
      params: { member: "m-3" },
      policy: { ontology: onto, ctx: stewardCtx },
    });
    expect(dispatcher).toHaveBeenCalledOnce();
    expect(out.ok).toBe(true);
    expect(out.confirmation_required).toBeUndefined();
  });

  it("does not consult policy when the `policy` field is omitted (back-compat)", async () => {
    // promote_to_steward is always_confirm in the seed. Without policy wired,
    // the dispatcher must still fire — preserves pre-US-026 behavior.
    const dispatcher = vi.fn(async () => ({ promoted: true }));
    const out = await runApplyActionTool({
      actor: stewardActor,
      dispatcher,
      action: "promote_to_steward",
      params: { member: "m-1" },
    });
    expect(dispatcher).toHaveBeenCalledOnce();
    expect(out.ok).toBe(true);
    expect(out.confirmation_required).toBeUndefined();
  });

  it("getToolsForActor — apply_action gate is wired when ctx is provided", async () => {
    const dispatcher = vi.fn(async () => ({ promoted: true }));
    const { tools } = getToolsForActor(ontology, stewardActor, {
      applyActionDispatcher: dispatcher,
      ctx: stewardCtx,
    });
    const applyAction = tools.apply_action;
    if (!applyAction?.execute) {
      throw new Error("expected apply_action tool with execute");
    }
    // promote_to_steward is always_confirm — should return confirmation_required.
    // The wrapper passes its input directly to runApplyActionTool, matching
    // the pattern used by the READ tools in lib/agent/read-tools.ts.
    type ExecuteFn = NonNullable<typeof applyAction.execute>;
    const result = (await applyAction.execute(
      {
        action: "promote_to_steward",
        params: { member: "m-1" },
      } as unknown as Parameters<ExecuteFn>[0],
      {} as unknown as Parameters<ExecuteFn>[1],
    )) as {
      ok: boolean;
      confirmation_required?: unknown;
    };
    expect(dispatcher).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.confirmation_required).toMatchObject({
      action: "promote_to_steward",
      reason: "always_confirm",
    });
  });
});
