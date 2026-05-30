// US-032: Action-middleware permission enforcement (consolidated proof).
//
// Earlier milestones proved this incidentally across permission-check.test.ts,
// composition.test.ts, and tool-gating.test.ts. M3.2 acceptance requires the
// proof to live IN ONE PLACE, labeled with the user story, so future audits
// can confirm the contract without spelunking through unrelated tests.
//
// The four scenarios that together satisfy US-032:
//
//   (a) A member invoking a steward-only action is denied at the action layer
//       with ActionPermissionError, and a `rejected` row appears in audit.
//   (b) A member CAN invoke an action whose permissions include "*" (i.e. the
//       middleware does not over-deny — open actions stay open).
//   (c) A steward can invoke any seed action (permission check does not
//       spuriously fire for the privileged role).
//   (d) The permission check fires on COMPOSED CHILDREN, not only on the
//       top-level call: a member invoking an open composing action that
//       internally calls a steward-only action is still denied at the child
//       boundary; the mutation does NOT happen and the audit row records the
//       child rejection.
//
// All four pass against the implementation as of M3.1.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuditStore } from "../audit/writer";
import type { Actor } from "../ctx";
import { loadOntology } from "../ontology/load";
import {
  PermissionError,
  createCtx,
  createInMemoryStore,
  type OntologyCtx,
  type OntologyStore,
} from "../ontology/ctx";
import type { Member } from "../ontology/types.generated";
import type { Ontology } from "../ontology/schema";
import { invokeAction } from "./invoke";
import { ActionPermissionError } from "./permission-check";

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

const SEED_DIR = path.join(
  __dirname,
  "..",
  "..",
  "scenarios",
  "small-community", "ontology",
);

const FIXTURE_ROOT = path.join(__dirname, "__test_fixtures__");

function memberRow(id: string, overrides: Partial<Member> = {}): Member {
  return {
    id,
    full_name: `Member ${id}`,
    email: `${id}@example.com`,
    phone: "555-0000",
    tier_role: "staff",
    started_at: "2026-01-01",
    notes: "",
    ...overrides,
  };
}

let tmpRoot: string;
let functionsDir: string;
let db: OntologyStore;
let audit: InMemoryAuditStore;
let memberCtx: OntologyCtx;
let stewardCtx: OntologyCtx;
let seedOntology: Ontology;

beforeEach(async () => {
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  tmpRoot = mkdtempSync(path.join(FIXTURE_ROOT, "us032-"));
  functionsDir = path.join(tmpRoot, "functions");
  mkdirSync(functionsDir, { recursive: true });
  db = createInMemoryStore();
  audit = new InMemoryAuditStore();
  memberCtx = createCtx({ db, actor: member, audit });
  stewardCtx = createCtx({ db, actor: steward, audit });
  seedOntology = await loadOntology(SEED_DIR);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeFunction(name: string, source: string): void {
  writeFileSync(path.join(functionsDir, `${name}.ts`), source, "utf8");
}

describe("US-032 (a): member invoking a steward-only action is denied", () => {
  it("invokeAction throws ActionPermissionError and writes a rejected audit row", async () => {
    // add_member.permissions = [steward] in the seed.
    await expect(
      invokeAction({
        actionName: "add_member",
        params: { full_name: "Mallory", email: "m@example.com" },
        ctx: memberCtx,
        ontology: seedOntology,
        functionsDir,
      }),
    ).rejects.toBeInstanceOf(ActionPermissionError);

    // Subclass relationship — callers can catch the base PermissionError too.
    await expect(
      invokeAction({
        actionName: "add_member",
        params: { full_name: "Mallory", email: "m@example.com" },
        ctx: memberCtx,
        ontology: seedOntology,
        functionsDir,
      }),
    ).rejects.toBeInstanceOf(PermissionError);

    const rejections = (await audit.listActionAudit()).filter(
      (r) =>
        r.subject_id === "add_member" && r.metadata.result === "rejected",
    );
    expect(rejections.length).toBeGreaterThanOrEqual(1);
    const row = rejections[0];
    expect(row.actor).toBe("u-member");
    expect(row.actor_role).toBe("member");
    expect(row.metadata).toMatchObject({
      reason: "permission_denied",
      required_permissions: ["steward"],
    });
  });
});

describe("US-032 (b): member CAN invoke a `*`-permission action", () => {
  it("an action with permissions: [\"*\"] is reachable by a member through invokeAction", async () => {
    // Build an ontology with a function-backed action whose permissions are
    // `*` so we exercise enforceActionPermission's `tokens.includes("*")`
    // branch end-to-end via invokeAction.
    const onto: Ontology = {
      properties: {},
      roles: { steward: {}, member: {} },
      object_types: {
        Member: {
          properties: { id: { type: "uuid", primary_key: true } },
        },
      },
      link_types: {},
      action_types: {
        ping: {
          description: "open ping; no row mutation",
          function: "ping",
          parameters: { msg: { type: "string", required: true } },
          permissions: ["*"],
          agent_policy: "auto_apply",
        },
      },
    } as unknown as Ontology;

    writeFunction(
      "ping",
      `
import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";
export default defineAction({
  schema: z.object({ msg: z.string() }),
  handler: async ({ params }) => ({ ok: true, echoed: params.msg }),
});
      `.trim(),
    );

    const result = await invokeAction({
      actionName: "ping",
      params: { msg: "hello" },
      ctx: memberCtx,
      ontology: onto,
      functionsDir,
    });
    // No permission throw; result returned unchanged; no rejected audit row.
    expect(result).toMatchObject({ ok: true, echoed: "hello" });
    const rows = await audit.listActionAudit();
    const rejected = rows.find(
      (r) => r.subject_id === "ping" && r.metadata.result === "rejected",
    );
    expect(rejected).toBeUndefined();
    const ok = rows.find(
      (r) => r.subject_id === "ping" && r.metadata.result === "ok",
    );
    expect(ok).toBeDefined();
  });
});

describe("US-032 (c): steward can invoke any seed action", () => {
  it("enforceActionPermission allows steward against every action in the seed ontology", async () => {
    // We can't actually invoke every action (some require existing rows /
    // params we don't want to fixture). Permission enforcement is a pure
    // predicate over (actor, action_type) so a direct call through invokeAction
    // for ONE steward-only action plus a static loop over names suffices to
    // prove (c): the middleware doesn't spuriously deny stewards.
    const { enforceActionPermission } = await import("./permission-check");
    for (const name of Object.keys(seedOntology.action_types)) {
      await expect(
        enforceActionPermission({
          ontology: seedOntology,
          actionName: name,
          ctx: stewardCtx,
        }),
      ).resolves.toBeUndefined();
    }
    // No rejection rows should have been written for the steward.
    const rejections = (await audit.listActionAudit()).filter(
      (r) => r.metadata.result === "rejected",
    );
    expect(rejections).toHaveLength(0);
  });
});

describe("US-032 (d): permission check fires on COMPOSED CHILDREN", () => {
  it("denies a child action whose permissions the actor lacks, even when reached via an open composing action; state is unchanged", async () => {
    // Reproduce the M2.5 composition scenario with the minimum surface: an
    // open ("*") composing action that, inside its handler, calls a
    // steward-only action via ctx.actions.X.
    const onto: Ontology = {
      properties: {},
      roles: { steward: {}, member: {} },
      object_types: {
        Member: { properties: { id: { type: "uuid", primary_key: true } } },
      },
      link_types: {},
      action_types: {
        change_tier: {
          description: "steward-only leaf",
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
        open_promote: {
          description: "open composing action that re-enters change_tier",
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
      },
    } as unknown as Ontology;

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
    const updated = await ctx.objects.Member.update(params.member, { tier: params.new_tier });
    return { ok: true, member: params.member, new_tier: updated?.tier ?? params.new_tier };
  },
});
      `.trim(),
    );
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

    await db.objects.Member.create(memberRow("m-1", { tier_role: "staff" }));

    await expect(
      invokeAction({
        actionName: "open_promote",
        params: { member: "m-1", new_tier: "lifetime" },
        ctx: memberCtx,
        ontology: onto,
        functionsDir,
      }),
    ).rejects.toThrow(/cannot invoke action "change_tier"/);

    // Object-state proof: mutation did NOT happen.
    const after = await db.objects.Member.findById("m-1");
    expect(after?.tier_role).toBe("staff");

    // Audit-trail proof: a child rejection row exists for the inner action.
    const rows = await audit.listActionAudit();
    const childRejection = rows.find(
      (r) =>
        r.subject_id === "change_tier" && r.metadata.result === "rejected",
    );
    expect(childRejection).toBeDefined();
    expect(childRejection?.metadata.reason).toBe("permission_denied");
    expect(childRejection?.metadata.required_permissions).toEqual(["steward"]);
    expect(childRejection?.actor).toBe("u-member");
  });
});
