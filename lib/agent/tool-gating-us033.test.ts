// US-033: Session-start tool gating — explicit member-vs-steward diff.
//
// The acceptance criterion is that, given the same ontology, the Mastra tool
// surface returned by getToolsForActor MUST be a strict subset for a member
// when compared to a steward — in particular the `apply_action` tool's input
// schema must narrow the action_types discriminated union to only the actions
// the member can invoke. The LLM never sees the steward-only branches.
//
// This file holds that proof in one place, labeled with the user story.
// It is intentionally independent of the broader tool-gating.test.ts file so
// the US-033 deliverable can be inspected without spelunking through
// auxiliary behaviors (READ tools, policy gate, etc.).

import path from "node:path";
import { describe, expect, it } from "vitest";
import { z, type ZodTypeAny } from "zod";
import type { Actor } from "../ctx";
import { loadOntology } from "../ontology/load";
import { getToolsForActor } from "./tool-gating";

const SEED_DIR = path.join(
  __dirname,
  "..",
  "..",
  "scenarios",
  "small-community", "ontology",
);

const steward: Actor = {
  userId: "u-steward",
  email: "s@example.com",
  role: "steward",
  customRoles: [],
};

const member: Actor = {
  userId: "u-member",
  email: "m@example.com",
  role: "member",
  customRoles: [],
};

// Extract the set of `action` literal values from an apply_action input
// schema. Reaches into each branch's `shape.action` (a z.literal) to read
// its bound value directly — survives Zod v4 issue-code reshaping because
// it does not rely on parse-error introspection.
function extractActionLiterals(schema: ZodTypeAny): string[] {
  function literalOf(branch: unknown): string | null {
    if (!branch || typeof branch !== "object") return null;
    // z.object's .shape exposes per-field schemas in v4 (and via _def in v3).
    const shape =
      (branch as { shape?: Record<string, unknown> }).shape ??
      ((branch as { _def?: { shape?: () => Record<string, unknown> } })._def
        ?.shape?.() ?? null);
    if (!shape) return null;
    const actionField = (shape as Record<string, unknown>).action as
      | { value?: unknown; _def?: { value?: unknown } }
      | undefined;
    if (!actionField) return null;
    const v =
      actionField.value ??
      (actionField._def && (actionField._def as { value?: unknown }).value);
    return typeof v === "string" ? v : null;
  }

  // Discriminated union — Zod exposes branches on `.options`.
  if (schema && typeof schema === "object" && "options" in schema) {
    const opts = (schema as { options: unknown[] }).options;
    if (Array.isArray(opts)) {
      const names: string[] = [];
      for (const opt of opts) {
        const n = literalOf(opt);
        if (n) names.push(n);
      }
      return names.slice().sort();
    }
  }
  // Single-branch fallback: the apply_action schema is a bare z.object.
  const single = literalOf(schema);
  return single ? [single] : [];
}

describe("US-033: apply_action discriminated union narrows per actor", () => {
  it("member's apply_action exposes a STRICT SUBSET of the steward's branches", async () => {
    const onto = await loadOntology(SEED_DIR);

    const stewardBundle = getToolsForActor(onto, steward);
    const memberBundle = getToolsForActor(onto, member);

    const stewardActions = stewardBundle.allowedActions.slice().sort();
    const memberActions = memberBundle.allowedActions.slice().sort();

    // Steward sees every declared action.
    expect(stewardActions).toEqual(
      Object.keys(onto.action_types).slice().sort(),
    );

    // Member sees a strict subset.
    expect(memberActions.length).toBeLessThan(stewardActions.length);
    for (const a of memberActions) {
      expect(stewardActions).toContain(a);
    }

    // The actions REMOVED for the member must include every action whose
    // declared permissions are steward-only.
    const removed = stewardActions.filter((a) => !memberActions.includes(a));
    for (const a of removed) {
      const perms = onto.action_types[a].permissions ?? [];
      const memberPermitted =
        perms.includes("*") ||
        perms.includes("member") ||
        perms.includes("member_self");
      expect(
        memberPermitted,
        `action "${a}" is removed for member but its permissions allow members: ${JSON.stringify(perms)}`,
      ).toBe(false);
    }
  });

  it("the live discriminated-union BRANCHES of apply_action match allowedActions for both actors", async () => {
    const onto = await loadOntology(SEED_DIR);

    const stewardBundle = getToolsForActor(onto, steward);
    const memberBundle = getToolsForActor(onto, member);

    const stewardSchemaActions = extractActionLiterals(
      stewardBundle.applyActionInput,
    );
    const memberSchemaActions = extractActionLiterals(
      memberBundle.applyActionInput,
    );

    // The schema is the wall: what the LLM sees as the input contract has
    // exactly the same set as allowedActions. Steward set is a superset of
    // member set.
    expect(stewardSchemaActions).toEqual(
      stewardBundle.allowedActions.slice().sort(),
    );
    expect(memberSchemaActions).toEqual(
      memberBundle.allowedActions.slice().sort(),
    );
    expect(memberSchemaActions.length).toBeLessThan(
      stewardSchemaActions.length,
    );
  });

  it("a member's apply_action schema REJECTS a steward-only action at the discriminator boundary (not at params)", async () => {
    const onto = await loadOntology(SEED_DIR);
    const { applyActionInput } = getToolsForActor(onto, member);

    // add_member is steward-only. Even with syntactically valid params the
    // member-facing schema must reject because the `action` literal is not in
    // the narrowed union.
    const result = applyActionInput.safeParse({
      action: "add_member",
      params: { full_name: "Mallory", email: "m@example.com" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // The failing issue must be on the `action` discriminator, NOT on
      // params — otherwise we'd be leaking the existence of forbidden
      // branches to the LLM through error messages.
      const actionIssue = result.error.issues.find(
        (i) => i.path.length === 1 && i.path[0] === "action",
      );
      expect(actionIssue).toBeDefined();
    }
  });

  it("a member's apply_action ACCEPTS an action whose permissions include `member`", async () => {
    const onto = await loadOntology(SEED_DIR);
    const { applyActionInput } = getToolsForActor(onto, member);

    // mark_notification_read.permissions = [member_self, steward] in the seed.
    // member_self is treated as allowed for any member actor at gating time
    // (row-level ownership check runs later in ctx).
    const result = applyActionInput.safeParse({
      action: "mark_notification_read",
      params: {
        notification_id: "11111111-1111-1111-1111-111111111111",
      },
    });
    expect(result.success).toBe(true);
  });

  it("getToolsForActor with a deliberately steward-only synthetic ontology yields zero apply_action branches for a member", async () => {
    // Independent of the seed — locks down the boundary case where the union
    // would collapse to z.never() because the member has nothing to invoke.
    const stewardsOnly = {
      properties: {},
      roles: { steward: {}, member: {} },
      object_types: {
        Member: {
          permissions: { read: ["*"], write: ["steward"] },
          properties: {
            id: { type: "uuid", primary_key: true },
            full_name: { type: "string" },
          },
        },
      },
      link_types: {},
      action_types: {
        add_member: {
          parameters: { full_name: { type: "string", required: true } },
          permissions: ["steward"],
          agent_policy: "always_confirm",
        },
      },
    } as unknown as Awaited<ReturnType<typeof loadOntology>>;

    const stewardBundle = getToolsForActor(stewardsOnly, steward);
    const memberBundle = getToolsForActor(stewardsOnly, member);

    expect(stewardBundle.allowedActions).toEqual(["add_member"]);
    expect(memberBundle.allowedActions).toEqual([]);

    // When there are no allowed actions the apply_action input falls back to
    // z.never() and the tool is omitted from the bundle entirely.
    expect(memberBundle.tools.apply_action).toBeUndefined();
    expect(memberBundle.applyActionInput instanceof z.ZodNever).toBe(true);
  });
});
