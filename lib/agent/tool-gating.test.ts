import path from "node:path";
import { describe, expect, it } from "vitest";
import { Tool } from "@mastra/core/tools";
import type { Actor } from "../ctx";
import { loadOntology } from "../ontology/load";
import { getToolsForActor } from "./tool-gating";
import type { Ontology } from "../ontology/schema";

const PKG_ROOT = path.resolve(__dirname, "..", "..");
const SMALL_COMMUNITY = path.join(
  PKG_ROOT,
  "seed",
  "small-community",
  "ontology",
);

const stewardActor: Actor = {
  userId: "u-steward",
  email: "steward@example.com",
  role: "steward",
  customRoles: [],
};

const memberActor: Actor = {
  userId: "u-member",
  email: "member@example.com",
  role: "member",
  customRoles: [],
};

describe("getToolsForActor — apply_action narrowing (small-community seed)", () => {
  it("steward's apply_action accepts every declared action", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const { applyActionInput } = getToolsForActor(onto, stewardActor);
    for (const action of Object.keys(onto.action_types)) {
      const result = applyActionInput.safeParse({ action, params: {} });
      expect(
        result.success || result.error.issues.some((i) => i.path[0] === "params"),
        `steward should reach the params branch for action ${action}`,
      ).toBe(true);
    }
  });

  it("member's apply_action rejects steward-only actions before reaching params", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const { applyActionInput } = getToolsForActor(onto, memberActor);
    const addMember = applyActionInput.safeParse({
      action: "add_member",
      params: { full_name: "Mallory", email: "m@example.com" },
    });
    expect(addMember.success).toBe(false);
    const changeTier = applyActionInput.safeParse({
      action: "change_tier",
      params: { member: "m-1", new_tier: "lifetime" },
    });
    expect(changeTier.success).toBe(false);
  });

  it("member's apply_action still accepts actions the member role can invoke", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const { applyActionInput } = getToolsForActor(onto, memberActor);
    const addMinute = applyActionInput.safeParse({
      action: "add_meeting_minute",
      params: {
        title: "Notes",
        body: "Body",
        event: "11111111-1111-1111-1111-111111111111",
      },
    });
    expect(addMinute.success).toBe(true);
    // record_attendance is gated by [steward, member_self] — at session-start
    // the member_self token is allowed in case the member owns target rows.
    const attendance = applyActionInput.safeParse({
      action: "record_attendance",
      params: {
        member: "22222222-2222-2222-2222-222222222222",
        event: "33333333-3333-3333-3333-333333333333",
      },
    });
    expect(attendance.success).toBe(true);
  });
});

describe("getToolsForActor — READ tool filtering", () => {
  it("keeps READ tools whose object type is readable by '*'", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const { tools } = getToolsForActor(onto, memberActor);
    expect(tools.read_member).toBeInstanceOf(Tool);
    expect(tools.read_event).toBeInstanceOf(Tool);
    expect(tools.read_meeting_minute).toBeInstanceOf(Tool);
  });

  it("removes all READ tools for an object type the actor cannot read", async () => {
    const restrictive = makeRestrictiveOntology();
    const memberBundle = getToolsForActor(restrictive, memberActor);
    const stewardBundle = getToolsForActor(restrictive, stewardActor);
    // Member loses 6 READ tools (one set of READ_OPS) for the steward-only
    // SecretLog object type while keeping the public ones.
    const memberIds = Object.keys(memberBundle.tools);
    const stewardIds = Object.keys(stewardBundle.tools);
    expect(memberIds.length).toBeLessThan(stewardIds.length);
    expect(stewardIds.length - memberIds.length).toBe(6);
    expect(memberIds.some((id) => id.endsWith("_secret_log"))).toBe(false);
    expect(stewardIds.some((id) => id.endsWith("_secret_log"))).toBe(true);
  });
});

describe("getToolsForActor — toolset counts (acceptance criterion)", () => {
  it("with seed: steward and member top-level counts match the formula, apply_action narrows from 4 -> 2 branches", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const stewardBundle = getToolsForActor(onto, stewardActor);
    const memberBundle = getToolsForActor(onto, memberActor);

    const READ_OPS_COUNT = 6;
    const OBJECT_TYPE_COUNT = Object.keys(onto.object_types).length; // 3
    const TOP_LEVEL = READ_OPS_COUNT * OBJECT_TYPE_COUNT + 1; // 19

    expect(Object.keys(stewardBundle.tools).length).toBe(TOP_LEVEL);
    expect(Object.keys(memberBundle.tools).length).toBe(TOP_LEVEL);

    const stewardActions = countDiscriminatorBranches(
      stewardBundle.applyActionInput,
    );
    const memberActions = countDiscriminatorBranches(
      memberBundle.applyActionInput,
    );
    expect(stewardActions).toBe(4);
    expect(memberActions).toBe(2);
    expect(memberActions).toBeLessThan(stewardActions);
  });

  it("anonymous actor (null) sees only PROPOSE-shaped tools and no apply_action when nothing is permitted", async () => {
    const stewardsOnly = makeStewardsOnlyOntology();
    const bundle = getToolsForActor(stewardsOnly, null);
    expect(bundle.tools.apply_action).toBeUndefined();
    expect(Object.keys(bundle.tools).length).toBe(0);
  });
});

// === helpers ===

function countDiscriminatorBranches(schema: unknown): number {
  // Zod v4 discriminated union exposes `.options`. A single-branch fallback is
  // an unwrapped z.object — we treat that as branch count 1.
  if (schema && typeof schema === "object" && "options" in schema) {
    const opts = (schema as { options: unknown[] }).options;
    if (Array.isArray(opts)) return opts.length;
  }
  return 1;
}

function makeRestrictiveOntology(): Ontology {
  return {
    properties: {},
    roles: {
      member: {},
      steward: {},
    },
    object_types: {
      Member: {
        permissions: { read: ["*"], write: ["steward", "member_self"] },
        properties: {
          id: { type: "uuid", primary_key: true },
          full_name: { type: "string" },
        },
      },
      SecretLog: {
        permissions: { read: ["steward"], write: ["steward"] },
        properties: {
          id: { type: "uuid", primary_key: true },
          line: { type: "string" },
        },
      },
    },
    link_types: {},
    action_types: {
      // member-invocable so apply_action remains present for both actors —
      // isolates the READ tool delta from the apply_action delta.
      add_member: {
        parameters: { full_name: { type: "string", required: true } },
        permissions: ["steward", "member"],
        agent_policy: "always_confirm",
      },
    },
  } as unknown as Ontology;
}

function makeStewardsOnlyOntology(): Ontology {
  return {
    properties: {},
    roles: { member: {}, steward: {} },
    object_types: {
      Member: {
        permissions: { read: ["steward"], write: ["steward"] },
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
  } as unknown as Ontology;
}
