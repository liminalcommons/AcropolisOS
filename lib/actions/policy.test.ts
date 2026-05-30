// US-026: Per-action policy gating.
//
// Each action_type's YAML agent_policy decides whether the agent can fire it
// directly or must surface a confirmation card to the steward:
//   - auto_apply             → fire
//   - always_confirm         → confirm  (default when omitted)
//   - confirm_if_unfamiliar  → consult action_audit: ≥3 prior successes by
//                              this actor with the same param shape → fire,
//                              otherwise confirm.
//
// `apply_action` (the agent's mutate tool) returns either the fired result
// or a structured `confirmation_required` envelope; tests cover both the
// pure policy resolver here and the integrated apply_action path.

import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuditStore } from "../audit/writer";
import type { Actor } from "../ctx";
import { loadOntology } from "../ontology/load";
import {
  createCtx,
  createInMemoryStore,
  type OntologyCtx,
  type OntologyStore,
} from "../ontology/ctx";
import type { Ontology } from "../ontology/schema";
import { resolveActionPolicy } from "./policy";

const PKG_ROOT = path.resolve(__dirname, "..", "..");
const SEED_DIR = path.join(PKG_ROOT, "scenarios", "small-community", "ontology");

const steward: Actor = {
  userId: "u-steward",
  email: "s@example.com",
  role: "steward",
  customRoles: [],
};

const otherSteward: Actor = {
  userId: "u-steward-2",
  email: "s2@example.com",
  role: "steward",
  customRoles: [],
};

let ontology: Ontology;
let db: OntologyStore;
let audit: InMemoryAuditStore;
let stewardCtx: OntologyCtx;

beforeEach(async () => {
  ontology = await loadOntology(SEED_DIR);
  db = createInMemoryStore();
  audit = new InMemoryAuditStore();
  stewardCtx = createCtx({ db, actor: steward, audit });
});

async function recordOkAudit(input: {
  actor: Actor;
  actionName: string;
  params: Record<string, unknown>;
}): Promise<void> {
  await audit.insertActionAudit({
    actor: input.actor.userId,
    actor_role: input.actor.role,
    via: "inngest",
    subject_type: "action",
    subject_id: input.actionName,
    before: null,
    after: null,
    metadata: {
      result: "ok",
      params: input.params,
    },
  });
}

describe("resolveActionPolicy — auto_apply", () => {
  it("returns auto_apply for an action declared as auto_apply", async () => {
    // record_attendance is auto_apply in the seed.
    const decision = await resolveActionPolicy({
      ontology,
      actionName: "record_attendance",
      params: { member: "m-1", event: "e-1" },
      ctx: stewardCtx,
    });
    expect(decision).toEqual({ decision: "auto_apply" });
  });
});

describe("resolveActionPolicy — always_confirm", () => {
  it("returns confirmation_required for actions declared as always_confirm", async () => {
    const decision = await resolveActionPolicy({
      ontology,
      actionName: "add_member",
      params: { full_name: "X", email: "x@example.com" },
      ctx: stewardCtx,
    });
    expect(decision).toMatchObject({
      decision: "confirmation_required",
      reason: "always_confirm",
    });
  });

  it("defaults to always_confirm when YAML omits agent_policy (zod default)", async () => {
    // Build an ad-hoc action_type without an agent_policy field. Zod's
    // .default("always_confirm") on the schema means parsed action_types
    // always carry one — but resolveActionPolicy should not assume the
    // field is present and should treat missing as always_confirm too.
    const ad: Ontology = {
      ...ontology,
      action_types: {
        ...ontology.action_types,
        custom_action: {
          description: "ad-hoc",
          creates_object: "Member",
          parameters: {},
          permissions: ["steward"],
          // Cast through unknown so the test exercises the missing-field
          // path even though the live parser guarantees a default.
        } as unknown as Ontology["action_types"][string],
      },
    };
    const decision = await resolveActionPolicy({
      ontology: ad,
      actionName: "custom_action",
      params: {},
      ctx: stewardCtx,
    });
    expect(decision).toMatchObject({
      decision: "confirmation_required",
      reason: "always_confirm",
    });
  });
});

describe("resolveActionPolicy — confirm_if_unfamiliar", () => {
  function withConfirmIfUnfamiliar(actionName: string): Ontology {
    const def = ontology.action_types[actionName];
    return {
      ...ontology,
      action_types: {
        ...ontology.action_types,
        [actionName]: { ...def, agent_policy: "confirm_if_unfamiliar" },
      },
    };
  }

  it("returns confirmation_required + unfamiliar when audit shows fewer than 3 prior successes", async () => {
    const onto = withConfirmIfUnfamiliar("add_member");
    await recordOkAudit({
      actor: steward,
      actionName: "add_member",
      params: { full_name: "A", email: "a@example.com" },
    });
    await recordOkAudit({
      actor: steward,
      actionName: "add_member",
      params: { full_name: "B", email: "b@example.com" },
    });
    const decision = await resolveActionPolicy({
      ontology: onto,
      actionName: "add_member",
      params: { full_name: "C", email: "c@example.com" },
      ctx: stewardCtx,
    });
    expect(decision).toEqual({
      decision: "confirmation_required",
      reason: "unfamiliar",
      priorSuccessCount: 2,
    });
  });

  it("returns auto_apply once this actor has ≥3 prior successes with the same param shape", async () => {
    const onto = withConfirmIfUnfamiliar("add_member");
    for (let i = 0; i < 3; i++) {
      await recordOkAudit({
        actor: steward,
        actionName: "add_member",
        params: { full_name: `M${i}`, email: `m${i}@example.com` },
      });
    }
    const decision = await resolveActionPolicy({
      ontology: onto,
      actionName: "add_member",
      params: { full_name: "M3", email: "m3@example.com" },
      ctx: stewardCtx,
    });
    expect(decision).toEqual({ decision: "auto_apply" });
  });

  it("does not credit other actors' prior successes towards this actor's familiarity", async () => {
    const onto = withConfirmIfUnfamiliar("add_member");
    for (let i = 0; i < 5; i++) {
      await recordOkAudit({
        actor: otherSteward,
        actionName: "add_member",
        params: { full_name: `M${i}`, email: `m${i}@example.com` },
      });
    }
    const decision = await resolveActionPolicy({
      ontology: onto,
      actionName: "add_member",
      params: { full_name: "Mine", email: "mine@example.com" },
      ctx: stewardCtx,
    });
    expect(decision).toMatchObject({
      decision: "confirmation_required",
      reason: "unfamiliar",
      priorSuccessCount: 0,
    });
  });

  it("does not count error/pending/replay rows as familiarity evidence", async () => {
    const onto = withConfirmIfUnfamiliar("add_member");
    // 4 non-ok rows for this actor + action.
    for (const result of ["error", "pending", "replay", "rejected"]) {
      await audit.insertActionAudit({
        actor: steward.userId,
        actor_role: steward.role,
        via: "inngest",
        subject_type: "action",
        subject_id: "add_member",
        before: null,
        after: null,
        metadata: {
          result,
          params: { full_name: "X", email: "x@example.com" },
        },
      });
    }
    const decision = await resolveActionPolicy({
      ontology: onto,
      actionName: "add_member",
      params: { full_name: "Y", email: "y@example.com" },
      ctx: stewardCtx,
    });
    expect(decision).toMatchObject({
      decision: "confirmation_required",
      reason: "unfamiliar",
      priorSuccessCount: 0,
    });
  });

  it("does not credit successes from other action_types", async () => {
    const onto = withConfirmIfUnfamiliar("add_member");
    for (let i = 0; i < 5; i++) {
      await recordOkAudit({
        actor: steward,
        actionName: "add_meeting_minute",
        params: { title: `T${i}`, body: "b", event: "e" },
      });
    }
    const decision = await resolveActionPolicy({
      ontology: onto,
      actionName: "add_member",
      params: { full_name: "Z", email: "z@example.com" },
      ctx: stewardCtx,
    });
    expect(decision).toMatchObject({
      decision: "confirmation_required",
      reason: "unfamiliar",
      priorSuccessCount: 0,
    });
  });

  it("requires same param shape (different key sets => not similar)", async () => {
    const onto = withConfirmIfUnfamiliar("add_member");
    // Three priors but each with a different/mismatched shape.
    await recordOkAudit({
      actor: steward,
      actionName: "add_member",
      params: { full_name: "A" }, // missing email
    });
    await recordOkAudit({
      actor: steward,
      actionName: "add_member",
      params: { full_name: "B", email: "b@example.com", extra: 1 }, // extra key
    });
    await recordOkAudit({
      actor: steward,
      actionName: "add_member",
      params: { email: "c@example.com" }, // missing full_name
    });
    const decision = await resolveActionPolicy({
      ontology: onto,
      actionName: "add_member",
      params: { full_name: "D", email: "d@example.com" },
      ctx: stewardCtx,
    });
    expect(decision).toMatchObject({
      decision: "confirmation_required",
      reason: "unfamiliar",
      priorSuccessCount: 0,
    });
  });

  it("respects a custom familiarityThreshold", async () => {
    const onto = withConfirmIfUnfamiliar("add_member");
    await recordOkAudit({
      actor: steward,
      actionName: "add_member",
      params: { full_name: "A", email: "a@example.com" },
    });
    const decision = await resolveActionPolicy({
      ontology: onto,
      actionName: "add_member",
      params: { full_name: "B", email: "b@example.com" },
      ctx: stewardCtx,
      familiarityThreshold: 1,
    });
    expect(decision).toEqual({ decision: "auto_apply" });
  });

  it("treats missing audit store as zero prior successes (best-effort)", async () => {
    const onto = withConfirmIfUnfamiliar("add_member");
    const ctxNoAudit = createCtx({ db, actor: steward });
    const decision = await resolveActionPolicy({
      ontology: onto,
      actionName: "add_member",
      params: { full_name: "X", email: "x@example.com" },
      ctx: ctxNoAudit,
    });
    expect(decision).toMatchObject({
      decision: "confirmation_required",
      reason: "unfamiliar",
      priorSuccessCount: 0,
    });
  });
});

describe("resolveActionPolicy — unknown action", () => {
  it("falls back to always_confirm for an action not in the ontology", async () => {
    const decision = await resolveActionPolicy({
      ontology,
      actionName: "ghost_action",
      params: {},
      ctx: stewardCtx,
    });
    expect(decision).toMatchObject({
      decision: "confirmation_required",
      reason: "always_confirm",
    });
  });
});
