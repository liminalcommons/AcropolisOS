// US-029 / M2.5: Deeper action composition guarantees.
//
// invoke.test.ts already covers the basic case (function-backed action calls
// ctx.actions.X; child rows record parent_action_audit_id). This file pins
// down the M2.5 acceptance criteria that go beyond that:
//
//   1. Recursion works at least 2 levels deep (grandparent → parent → child)
//      with each level's parent_action_audit_id pointing at the immediate
//      parent — not flattened to the root.
//   2. Permission re-check fires on EVERY nested invocation. A function-backed
//      composing action MUST NOT let a low-privilege actor sidestep a child
//      action's required role.
//   3. Recursion depth has a hard ceiling (prevents runaway / accidental
//      infinite composition) — when exceeded the runner throws a recognisable
//      error and the audit row records the failure.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuditStore } from "../audit/writer";
import type { Actor } from "../ctx";
import {
  createCtx,
  createInMemoryStore,
  type OntologyCtx,
  type OntologyStore,
} from "../ontology/ctx";
import type { Member } from "../ontology/types.generated";
import type { Ontology } from "../ontology/schema";
import { invokeAction } from "./invoke";

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

function memberRow(id: string, overrides: Partial<Member> = {}): Member {
  return {
    id,
    full_name: `Member ${id}`,
    email: `${id}@example.com`,
    joined_at: "2026-01-01",
    tier: "basic",
    notes: "",
    ...overrides,
  };
}

const FIXTURE_ROOT = path.join(__dirname, "__test_fixtures__");

let tmpRoot: string;
let functionsDir: string;
let db: OntologyStore;
let audit: InMemoryAuditStore;
let ctx: OntologyCtx;
let memberCtx: OntologyCtx;
let ontology: Ontology;

beforeEach(() => {
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  tmpRoot = mkdtempSync(path.join(FIXTURE_ROOT, "composition-"));
  functionsDir = path.join(tmpRoot, "functions");
  mkdirSync(functionsDir, { recursive: true });
  db = createInMemoryStore();
  audit = new InMemoryAuditStore();
  ctx = createCtx({ db, actor: steward, audit });
  memberCtx = createCtx({ db, actor: member, audit });

  ontology = {
    properties: {},
    roles: {
      steward: {},
      member: {},
    },
    object_types: {
      Member: {
        properties: {
          id: { type: "uuid", primary_key: true },
        },
      },
    },
    link_types: {},
    action_types: {
      // Leaf: steward-only.
      change_tier: {
        description: "Move a member to a different tier",
        function: "change-tier",
        parameters: {
          member: { type: "string", required: true },
          new_tier: {
            type: "enum",
            values: ["basic", "sustaining", "lifetime"],
            required: true,
          },
        },
        permissions: ["steward"],
        agent_policy: "always_confirm",
      },
      // Composes change_tier — open permission so we can test that the CHILD
      // permission still bites even when the parent is open.
      open_promote: {
        description: "Composes change_tier without re-checking perms upfront",
        function: "open-promote",
        parameters: {
          member: { type: "string", required: true },
          new_tier: {
            type: "enum",
            values: ["basic", "sustaining", "lifetime"],
            required: true,
          },
        },
        permissions: ["*"],
        agent_policy: "always_confirm",
      },
      // Level-2 wrapper that composes open_promote, which then composes
      // change_tier. Used to assert 3-deep audit chain (grandparent → parent
      // → child) where each child's parent_action_audit_id is the IMMEDIATE
      // parent, not flattened to the root.
      orchestrate_promote: {
        description: "Two-level wrapper for promote",
        function: "orchestrate-promote",
        parameters: {
          member: { type: "string", required: true },
          new_tier: {
            type: "enum",
            values: ["basic", "sustaining", "lifetime"],
            required: true,
          },
        },
        permissions: ["steward"],
        agent_policy: "always_confirm",
      },
      // Self-recursive — used to exercise the depth guard.
      recurse_forever: {
        description: "Calls itself forever (depth-guard target)",
        function: "recurse-forever",
        parameters: {
          depth: { type: "integer", required: true },
        },
        permissions: ["steward"],
        agent_policy: "always_confirm",
      },
    },
  };
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeFunction(name: string, source: string): void {
  writeFileSync(path.join(functionsDir, `${name}.ts`), source, "utf8");
}

function writeChangeTier(): void {
  writeFunction(
    "change-tier",
    `
import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";
export default defineAction({
  schema: z.object({
    member: z.string(),
    new_tier: z.enum(["basic", "sustaining", "lifetime"]),
  }),
  handler: async ({ params, ctx }) => {
    const before = await ctx.objects.Member.findById(params.member);
    if (!before) return { ok: false, reason: "member_not_found", member: params.member };
    const updated = await ctx.objects.Member.update(params.member, { tier: params.new_tier });
    return { ok: true, member: params.member, previous_tier: before.tier, new_tier: updated?.tier ?? params.new_tier };
  },
});
    `.trim(),
  );
}

function writeOpenPromote(): void {
  writeFunction(
    "open-promote",
    `
import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";
export default defineAction({
  schema: z.object({
    member: z.string(),
    new_tier: z.enum(["basic", "sustaining", "lifetime"]),
  }),
  handler: async ({ params, ctx }) => {
    const result = await ctx.actions.change_tier({
      member: params.member,
      new_tier: params.new_tier,
    });
    return { ok: true, wrapped: result };
  },
});
    `.trim(),
  );
}

function writeOrchestratePromote(): void {
  writeFunction(
    "orchestrate-promote",
    `
import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";
export default defineAction({
  schema: z.object({
    member: z.string(),
    new_tier: z.enum(["basic", "sustaining", "lifetime"]),
  }),
  handler: async ({ params, ctx }) => {
    const inner = await ctx.actions.open_promote({
      member: params.member,
      new_tier: params.new_tier,
    });
    return { ok: true, inner };
  },
});
    `.trim(),
  );
}

function writeRecurseForever(): void {
  writeFunction(
    "recurse-forever",
    `
import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";
export default defineAction({
  schema: z.object({ depth: z.number() }),
  handler: async ({ params, ctx }) => {
    const next = await ctx.actions.recurse_forever({ depth: params.depth + 1 });
    return { ok: true, next };
  },
});
    `.trim(),
  );
}

describe("composition — 2-level deep recursion", () => {
  it("records parent_action_audit_id as IMMEDIATE parent at each depth", async () => {
    writeChangeTier();
    writeOpenPromote();
    writeOrchestratePromote();
    await db.objects.Member.create(memberRow("m-1", { tier: "basic" }));

    await invokeAction({
      actionName: "orchestrate_promote",
      params: { member: "m-1", new_tier: "lifetime" },
      ctx,
      ontology,
      functionsDir,
    });

    const rows = await audit.listActionAudit();
    // Three actions × (pending + ok) = 6 rows.
    expect(rows).toHaveLength(6);

    const orchPre = rows.find(
      (r) => r.subject_id === "orchestrate_promote" && r.metadata.result === "pending",
    );
    const openPre = rows.find(
      (r) => r.subject_id === "open_promote" && r.metadata.result === "pending",
    );
    const tierPre = rows.find(
      (r) => r.subject_id === "change_tier" && r.metadata.result === "pending",
    );
    expect(orchPre).toBeDefined();
    expect(openPre).toBeDefined();
    expect(tierPre).toBeDefined();

    // Grandparent has no parent.
    expect(orchPre!.metadata.parent_action_audit_id).toBeUndefined();
    // open_promote's parent is the orchestrator (NOT undefined; NOT itself).
    expect(openPre!.metadata.parent_action_audit_id).toBe(orchPre!.id);
    // change_tier's parent is open_promote — IMMEDIATE parent, not the root.
    expect(tierPre!.metadata.parent_action_audit_id).toBe(openPre!.id);
  });
});

describe("composition — permission re-check on child invocations", () => {
  it("denies a child action whose permissions the actor lacks, even when reached via an open composing action", async () => {
    writeChangeTier();
    writeOpenPromote();
    await db.objects.Member.create(memberRow("m-1", { tier: "basic" }));

    // open_promote is open ("*"); change_tier requires steward. A `member`
    // actor invoking open_promote MUST be denied at the change_tier child
    // boundary — composition does NOT escalate privileges.
    await expect(
      invokeAction({
        actionName: "open_promote",
        params: { member: "m-1", new_tier: "lifetime" },
        ctx: memberCtx,
        ontology,
        functionsDir,
      }),
    ).rejects.toThrow(/cannot invoke action "change_tier"/);

    // Crucially: the Member tier MUST NOT have changed.
    const after = await db.objects.Member.findById("m-1");
    expect(after?.tier).toBe("basic");

    // And the audit log shows the denial — a child rejection row exists.
    const rows = await audit.listActionAudit();
    const rejection = rows.find(
      (r) =>
        r.subject_id === "change_tier" && r.metadata.result === "rejected",
    );
    expect(rejection).toBeDefined();
    expect(rejection?.metadata.reason).toBe("permission_denied");
  });
});

describe("composition — recursion depth guard", () => {
  it("rejects a composing action that exceeds the maximum chain depth", async () => {
    writeRecurseForever();

    await expect(
      invokeAction({
        actionName: "recurse_forever",
        params: { depth: 0 },
        ctx,
        ontology,
        functionsDir,
      }),
    ).rejects.toThrow(/composition depth/i);
  });
});
