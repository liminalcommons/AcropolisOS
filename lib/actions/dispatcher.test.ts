// US-027: apply_action dispatcher.
//
// `createInProcessDispatcher` wraps `invokeAction` so the agent's apply_action
// tool can invoke a typed action and receive both the handler's result and
// the action_audit row id that records it. The audit id lets the chat panel
// render an "Action recorded" card linking back to the audit row.
//
// Routes through the same code path the per-action Inngest function uses
// (audit middleware → permission check → declarative/function handler),
// preserving identical durability + idempotency semantics.

import { describe, expect, it } from "vitest";
import { InMemoryAuditStore } from "../audit/writer";
import type { Actor } from "../ctx";
import {
  createCtx,
  createInMemoryStore,
  type OntologyStore,
} from "../ontology/ctx";
import type { Ontology } from "../ontology/schema";
import { createInProcessDispatcher } from "./dispatcher";

const steward: Actor = {
  userId: "u-steward",
  email: "s@example.com",
  role: "steward",
  customRoles: [],
};

const memberActor: Actor = {
  userId: "u-member",
  email: "m@example.com",
  role: "member",
  customRoles: [],
};

// Declarative-only ontology — no function-backed actions, so no functionsDir
// is needed. `change_tier_decl` updates a Member row directly via `updates`.
function buildOntology(): Ontology {
  return {
    properties: {},
    roles: { steward: {}, member: {} },
    object_types: {
      Member: {
        permissions: { read: ["*"], write: ["steward"] },
        properties: {
          id: { type: "uuid", primary_key: true },
          full_name: { type: "string" },
          email: { type: "email" },
          joined_at: { type: "date" },
          tier: {
            type: "enum",
            values: ["basic", "sustaining", "lifetime"],
            default: "basic",
          },
          notes: { type: "string" },
        },
      },
    },
    link_types: {},
    action_types: {
      add_member: {
        description: "Add a new member",
        creates_object: "Member",
        parameters: {
          full_name: { type: "string", required: true },
          email: { type: "email", required: true },
          tier: {
            type: "enum",
            values: ["basic", "sustaining", "lifetime"],
            default: "basic",
          },
        },
        permissions: ["steward"],
        agent_policy: "always_confirm",
      },
    },
  } as unknown as Ontology;
}

function setup(actor: Actor) {
  const db: OntologyStore = createInMemoryStore();
  const audit = new InMemoryAuditStore();
  const ctx = createCtx({ db, actor, audit });
  const ontology = buildOntology();
  return { db, audit, ctx, ontology };
}

describe("createInProcessDispatcher — US-027", () => {
  it("invokes the declarative action and returns {result, audit_id}", async () => {
    const { audit, ctx, ontology } = setup(steward);
    const dispatcher = createInProcessDispatcher({
      ctx,
      ontology,
      functionsDir: "/__unused__",
    });

    const out = await dispatcher({
      action: "add_member",
      params: {
        full_name: "Ada Lovelace",
        email: "ada@example.com",
        tier: "sustaining",
      },
    });

    expect(out).toBeDefined();
    const envelope = out as { result: unknown; audit_id: string | null };
    expect(envelope.result).toBeDefined();
    expect(envelope.audit_id).toBeTypeOf("string");

    const rows = await audit.listActionAudit();
    // pre (pending) + post (ok) for the same action
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const okRow = rows.find(
      (r) =>
        r.subject_id === "add_member" && r.metadata.result === "ok",
    );
    expect(okRow).toBeDefined();
    expect(envelope.audit_id).toBe(okRow!.id);
  });

  it("surfaces ActionPermissionError to the caller (tool-gating turns it into permission_denied)", async () => {
    const { ctx, ontology } = setup(memberActor);
    const dispatcher = createInProcessDispatcher({
      ctx,
      ontology,
      functionsDir: "/__unused__",
    });

    await expect(
      dispatcher({
        action: "add_member",
        params: { full_name: "Mallory", email: "m@example.com" },
      }),
    ).rejects.toThrow();
  });

  it("returns audit_id: null when no audit store is wired", async () => {
    const db = createInMemoryStore();
    const ctx = createCtx({ db, actor: steward }); // no audit
    const ontology = buildOntology();
    const dispatcher = createInProcessDispatcher({
      ctx,
      ontology,
      functionsDir: "/__unused__",
    });

    const out = (await dispatcher({
      action: "add_member",
      params: { full_name: "Grace Hopper", email: "g@example.com" },
    })) as { result: unknown; audit_id: string | null };

    expect(out.audit_id).toBeNull();
    expect(out.result).toBeDefined();
  });
});
