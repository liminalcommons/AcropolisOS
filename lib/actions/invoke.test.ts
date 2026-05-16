// US-029: Action composition via ctx.actions.X.
//
// A function-backed handler calls ctx.actions.<other_action>(params); the
// nested invocation runs under the same actor, gets its own audit envelope,
// and records parent_action_audit_id pointing at the parent's pending row.
// The audit log IS the call tree.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { createActionsDispatcher, invokeAction } from "./invoke";
import type { SideEffectAdapters } from "./side-effects";

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
let ontology: Ontology;

beforeEach(() => {
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  tmpRoot = mkdtempSync(path.join(FIXTURE_ROOT, "invoke-"));
  functionsDir = path.join(tmpRoot, "functions");
  mkdirSync(functionsDir, { recursive: true });
  db = createInMemoryStore();
  audit = new InMemoryAuditStore();
  ctx = createCtx({ db, actor: steward, audit });

  // Minimal ontology spanning the three actions under test. The real seed
  // would carry richer parameters; we keep this scoped to what the runner
  // needs to dispatch and check permissions.
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
      send_welcome_packet: {
        description: "Send a member their welcome packet",
        function: "send-welcome-packet",
        parameters: {
          member: { type: "string", required: true },
        },
        permissions: ["steward"],
        agent_policy: "always_confirm",
      },
      promote_member: {
        description: "Promote a member: change_tier + send_welcome_packet",
        function: "promote-member",
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
    return {
      ok: true,
      member: params.member,
      previous_tier: before.tier,
      new_tier: updated?.tier ?? params.new_tier,
    };
  },
});
    `.trim(),
  );
}

function writeSendWelcomePacket(): void {
  writeFunction(
    "send-welcome-packet",
    `
import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";
export default defineAction({
  schema: z.object({
    member: z.string(),
  }),
  handler: async ({ params, ctx }) => {
    const before = await ctx.objects.Member.findById(params.member);
    if (!before) return { ok: false, reason: "member_not_found", member: params.member };
    await ctx.objects.Member.update(params.member, { notes: "welcome packet sent" });
    return { ok: true, member: params.member, sent: true };
  },
});
    `.trim(),
  );
}

function writePromoteMember(): void {
  // promote_member composes change_tier + send_welcome_packet by calling
  // them through ctx.actions.X. Both nested calls must record
  // parent_action_audit_id pointing at promote_member's audit row.
  writeFunction(
    "promote-member",
    `
import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";
export default defineAction({
  schema: z.object({
    member: z.string(),
    new_tier: z.enum(["basic", "sustaining", "lifetime"]),
  }),
  handler: async ({ params, ctx }) => {
    const tierResult = await ctx.actions.change_tier({
      member: params.member,
      new_tier: params.new_tier,
    });
    const welcomeResult = await ctx.actions.send_welcome_packet({
      member: params.member,
    });
    return {
      ok: true,
      member: params.member,
      change_tier: tierResult,
      send_welcome_packet: welcomeResult,
    };
  },
});
    `.trim(),
  );
}

describe("invokeAction — single action without composition", () => {
  it("runs a function-backed action and records pre + post audit rows", async () => {
    writeChangeTier();
    await db.objects.Member.create(memberRow("m-1", { tier: "basic" }));

    const result = await invokeAction({
      actionName: "change_tier",
      params: { member: "m-1", new_tier: "sustaining" },
      ctx,
      ontology,
      functionsDir,
    });

    expect(result).toMatchObject({
      ok: true,
      member: "m-1",
      previous_tier: "basic",
      new_tier: "sustaining",
    });

    const rows = await audit.listActionAudit();
    expect(rows).toHaveLength(2);
    expect(rows[0].subject_id).toBe("change_tier");
    expect(rows[0].metadata.result).toBe("pending");
    expect(rows[1].subject_id).toBe("change_tier");
    expect(rows[1].metadata.result).toBe("ok");
    // No parent at the top level.
    expect(rows[0].metadata.parent_action_audit_id).toBeUndefined();
    expect(rows[1].metadata.parent_action_audit_id).toBeUndefined();
  });

  it("enforces permission and refuses when the actor lacks the role", async () => {
    writeChangeTier();
    await db.objects.Member.create(memberRow("m-1"));
    const memberCtx = createCtx({ db, actor: memberActor, audit });

    await expect(
      invokeAction({
        actionName: "change_tier",
        params: { member: "m-1", new_tier: "sustaining" },
        ctx: memberCtx,
        ontology,
        functionsDir,
      }),
    ).rejects.toThrow(/cannot invoke action "change_tier"/);

    // The Member's tier MUST NOT have changed.
    const after = await db.objects.Member.findById("m-1");
    expect(after?.tier).toBe("basic");
  });
});

describe("invokeAction — promote_member composes change_tier + send_welcome_packet", () => {
  it("invokes both child actions under the same actor", async () => {
    writeChangeTier();
    writeSendWelcomePacket();
    writePromoteMember();
    await db.objects.Member.create(memberRow("m-1", { tier: "basic" }));

    const result = await invokeAction({
      actionName: "promote_member",
      params: { member: "m-1", new_tier: "lifetime" },
      ctx,
      ontology,
      functionsDir,
    });

    expect(result).toMatchObject({
      ok: true,
      member: "m-1",
      change_tier: { ok: true, new_tier: "lifetime" },
      send_welcome_packet: { ok: true, sent: true },
    });

    // Both side effects must have happened on the same Member row.
    const after = await db.objects.Member.findById("m-1");
    expect(after?.tier).toBe("lifetime");
    expect(after?.notes).toBe("welcome packet sent");
  });

  it("records audit chain with parent_action_audit_id linking children to promote_member", async () => {
    writeChangeTier();
    writeSendWelcomePacket();
    writePromoteMember();
    await db.objects.Member.create(memberRow("m-1", { tier: "basic" }));

    await invokeAction({
      actionName: "promote_member",
      params: { member: "m-1", new_tier: "lifetime" },
      ctx,
      ontology,
      functionsDir,
    });

    const rows = await audit.listActionAudit();
    // Three actions × (pre + post) = 6 rows.
    expect(rows).toHaveLength(6);

    const promoteRows = rows.filter((r) => r.subject_id === "promote_member");
    const tierRows = rows.filter((r) => r.subject_id === "change_tier");
    const welcomeRows = rows.filter(
      (r) => r.subject_id === "send_welcome_packet",
    );
    expect(promoteRows).toHaveLength(2);
    expect(tierRows).toHaveLength(2);
    expect(welcomeRows).toHaveLength(2);

    const promotePre = promoteRows.find((r) => r.metadata.result === "pending");
    expect(promotePre).toBeDefined();
    const promoteParentId = promotePre!.id;

    // Both child actions must point at promote_member's pending row.
    for (const r of tierRows) {
      expect(r.metadata.parent_action_audit_id).toBe(promoteParentId);
    }
    for (const r of welcomeRows) {
      expect(r.metadata.parent_action_audit_id).toBe(promoteParentId);
    }

    // promote_member rows themselves carry no parent (it's the root).
    for (const r of promoteRows) {
      expect(r.metadata.parent_action_audit_id).toBeUndefined();
    }
  });

  it("propagates errors from a nested action and still records the parent's failure", async () => {
    writeChangeTier();
    writeSendWelcomePacket();
    writePromoteMember();
    // Member missing → change_tier returns ok:false, promote continues. To
    // exercise an error path, mock change_tier to throw.
    writeFunction(
      "change-tier",
      `
import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";
export default defineAction({
  schema: z.object({ member: z.string(), new_tier: z.enum(["basic","sustaining","lifetime"]) }),
  handler: async () => { throw new Error("tier update failed"); },
});
      `.trim(),
    );
    await db.objects.Member.create(memberRow("m-1"));

    await expect(
      invokeAction({
        actionName: "promote_member",
        params: { member: "m-1", new_tier: "lifetime" },
        ctx,
        ontology,
        functionsDir,
      }),
    ).rejects.toThrow(/tier update failed/);

    const rows = await audit.listActionAudit();
    // promote_member pre + post(error), change_tier pre + post(error). No
    // send_welcome_packet row (we threw before reaching it).
    const promoteErrors = rows.filter(
      (r) =>
        r.subject_id === "promote_member" && r.metadata.result === "error",
    );
    const tierErrors = rows.filter(
      (r) => r.subject_id === "change_tier" && r.metadata.result === "error",
    );
    const welcome = rows.filter((r) => r.subject_id === "send_welcome_packet");
    expect(promoteErrors).toHaveLength(1);
    expect(tierErrors).toHaveLength(1);
    expect(welcome).toHaveLength(0);

    // The failed child still records its parent.
    const promotePre = rows.find(
      (r) =>
        r.subject_id === "promote_member" && r.metadata.result === "pending",
    );
    expect(promotePre).toBeDefined();
    expect(tierErrors[0].metadata.parent_action_audit_id).toBe(promotePre!.id);
  });
});

describe("createActionsDispatcher — bare dispatcher (without parent invokeAction)", () => {
  it("exposes one callable per action_type in the ontology", () => {
    writeChangeTier();
    writeSendWelcomePacket();
    writePromoteMember();
    const dispatcher = createActionsDispatcher({
      ctx,
      ontology,
      functionsDir,
    });
    expect(Object.keys(dispatcher).sort()).toEqual([
      "change_tier",
      "promote_member",
      "send_welcome_packet",
    ]);
    expect(typeof dispatcher.change_tier).toBe("function");
  });

  it("propagates parentAuditId from the dispatcher to invokeAction (audit row carries it)", async () => {
    writeChangeTier();
    await db.objects.Member.create(memberRow("m-1"));
    const dispatcher = createActionsDispatcher({
      ctx,
      ontology,
      functionsDir,
      parentAuditId: "synthetic-parent-id",
    });
    await dispatcher.change_tier({ member: "m-1", new_tier: "sustaining" });

    const rows = await audit.listActionAudit();
    expect(rows.every((r) => r.metadata.parent_action_audit_id === "synthetic-parent-id")).toBe(true);
  });
});

describe("invokeAction — side-effects dispatch (US-028)", () => {
  it("fires declared side effects after audit_post(ok)", async () => {
    writeChangeTier();
    await db.objects.Member.create(memberRow("m-1", { tier: "basic" }));

    // change_tier declares [audit, notify_member] in our test ontology
    // below — extend it now and re-validate by using the existing ontology
    // var.
    ontology.action_types.change_tier.side_effects = [
      "audit",
      "notify_member",
      "webhook",
    ];

    const sendMail = vi.fn(async () => undefined);
    const postWebhook = vi.fn(async () => ({ status: 200 }));
    const adapters: SideEffectAdapters = {
      sendMail,
      postWebhook,
      config: { webhook_url: "https://hooks.example.com/x" },
    };

    await invokeAction({
      actionName: "change_tier",
      params: { member: "m-1", new_tier: "sustaining" },
      ctx,
      ontology,
      functionsDir,
      sideEffectAdapters: adapters,
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "s@example.com" }),
    );
    expect(postWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://hooks.example.com/x",
        body: expect.objectContaining({ action: "change_tier" }),
      }),
    );
  });

  it("does NOT fire side effects when the action errors", async () => {
    writeFunction(
      "change-tier",
      `
import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";
export default defineAction({
  schema: z.object({ member: z.string(), new_tier: z.enum(["basic","sustaining","lifetime"]) }),
  handler: async () => { throw new Error("boom"); },
});
      `.trim(),
    );
    await db.objects.Member.create(memberRow("m-1"));
    ontology.action_types.change_tier.side_effects = ["notify_member"];

    const sendMail = vi.fn(async () => undefined);
    const postWebhook = vi.fn(async () => ({ status: 200 }));
    const adapters: SideEffectAdapters = {
      sendMail,
      postWebhook,
      config: {},
    };

    await expect(
      invokeAction({
        actionName: "change_tier",
        params: { member: "m-1", new_tier: "sustaining" },
        ctx,
        ontology,
        functionsDir,
        sideEffectAdapters: adapters,
      }),
    ).rejects.toThrow(/boom/);

    expect(sendMail).not.toHaveBeenCalled();
  });

  it("side-effect failures do not roll back the action (still returns result)", async () => {
    writeChangeTier();
    await db.objects.Member.create(memberRow("m-1", { tier: "basic" }));
    ontology.action_types.change_tier.side_effects = ["notify_member"];

    const sendMail = vi.fn(async () => {
      throw new Error("SMTP unreachable");
    });
    const adapters: SideEffectAdapters = {
      sendMail,
      postWebhook: vi.fn(async () => ({ status: 200 })),
      config: {},
    };

    const result = await invokeAction({
      actionName: "change_tier",
      params: { member: "m-1", new_tier: "sustaining" },
      ctx,
      ontology,
      functionsDir,
      sideEffectAdapters: adapters,
    });

    // Action result unaffected.
    expect(result).toMatchObject({ ok: true, new_tier: "sustaining" });

    // Audit envelope stays "ok" — side effects don't roll it back.
    const rows = await audit.listActionAudit();
    const post = rows.find((r) => r.metadata.result === "ok");
    expect(post).toBeDefined();
  });
});
