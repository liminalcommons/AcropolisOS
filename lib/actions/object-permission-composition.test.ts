// M3.1 / US-031 acceptance criterion #8:
//
//   A function-backed action running as a member actor that calls
//   ctx.objects.Member.update(other_id, ...) is denied at the OBJECT layer
//   EVEN IF the action-level permission allowed the action to run.
//
// composition.test.ts already covers the dual case: an open child action
// permission cannot rescue an action-layer deny. This file covers the
// orthogonal case: a member-permitted action body still cannot reach across
// to another member's row via the object accessor, because wrapObjectAccess
// enforces member_self at write time.
//
// This is what makes US-031 a real boundary, not a paperwork rule: even a
// well-intentioned-looking action body cannot escalate by calling the store
// directly.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuditStore } from "../audit/writer";
import type { Actor } from "../ctx";
import {
  buildObjectPermissionsMap,
  createCtx,
  createInMemoryStore,
  PermissionError,
  type OntologyCtx,
  type OntologyStore,
} from "../ontology/ctx";
import { loadOntology } from "../ontology/load";
import type { Member } from "../ontology/types.generated";
import type { Ontology } from "../ontology/schema";
import { invokeAction } from "./invoke";

const PKG_ROOT = path.resolve(__dirname, "..", "..");
const SMALL_COMMUNITY = path.join(PKG_ROOT, "seed", "small-community");

// Real v4 UUIDs (gotcha_acropolisos_zod4_uuid_strict).
const MEMBER_A_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_B_ID = "22222222-2222-4222-8222-222222222222";

const memberAActor: Actor = {
  userId: MEMBER_A_ID,
  email: "a@example.com",
  role: "member",
  customRoles: [],
};

const stewardActor: Actor = {
  userId: "00000000-0000-4000-8000-000000000001",
  email: "s@example.com",
  role: "steward",
  customRoles: [],
};

function memberRow(id: string, overrides: Partial<Member> = {}): Member {
  return {
    id,
    full_name: `Member ${id.slice(0, 4)}`,
    email: `${id.slice(0, 4)}@example.com`,
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
let memberCtx: OntologyCtx;
let stewardCtx: OntologyCtx;
let ontology: Ontology;

beforeEach(async () => {
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  tmpRoot = mkdtempSync(path.join(FIXTURE_ROOT, "object-perm-comp-"));
  functionsDir = path.join(tmpRoot, "functions");
  mkdirSync(functionsDir, { recursive: true });

  db = createInMemoryStore();
  audit = new InMemoryAuditStore();

  // Load the real small-community ontology so we get the production
  // permissions map (Member.read/write = steward + member_self).
  ontology = await loadOntology(SMALL_COMMUNITY);

  // Override one action to make it open at the action layer (permissions
  // ["*"]) so we isolate the object-layer enforcement. We mutate the
  // loaded ontology rather than writing a sidecar YAML — the test is about
  // runtime composition, not YAML loading.
  const overlay: Ontology = {
    ...ontology,
    action_types: {
      ...ontology.action_types,
      // Member-permitted, function-backed action body that POKES another
      // member's row via ctx.objects.Member.update — should be denied at the
      // object layer despite the action being permitted.
      poke_member: {
        description: "Member-permitted action that tries to update any Member row",
        function: "poke-member",
        parameters: {
          member: { type: "string", required: true },
          new_tier: {
            type: "enum",
            values: ["basic", "sustaining", "lifetime"],
            required: true,
          },
        },
        // Action-layer permission is open — any member can invoke.
        permissions: ["*"],
        agent_policy: "always_confirm",
      },
    },
  };
  ontology = overlay;

  const permissions = buildObjectPermissionsMap(ontology);
  memberCtx = createCtx({ db, actor: memberAActor, permissions, audit });
  stewardCtx = createCtx({ db, actor: stewardActor, permissions, audit });

  // Seed two members directly via the unwrapped store (bypass permissions
  // for setup, mirroring the pattern in lib/agent/read-tools.test.ts).
  await db.objects.Member.create(memberRow(MEMBER_A_ID));
  await db.objects.Member.create(memberRow(MEMBER_B_ID));

  // Write the function body that the action will load.
  writeFileSync(
    path.join(functionsDir, "poke-member.ts"),
    `
import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";
export default defineAction({
  schema: z.object({
    member: z.string(),
    new_tier: z.enum(["basic", "sustaining", "lifetime"]),
  }),
  handler: async ({ params, ctx }) => {
    // Direct object-layer write. Under a member actor scope, the wrap
    // enforces member_self — write to OTHER member's row throws
    // PermissionError. The action layer cannot rescue this.
    const updated = await ctx.objects.Member.update(params.member, {
      tier: params.new_tier,
    });
    return { ok: true, updated };
  },
});
    `.trim(),
    "utf8",
  );
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("M3.1 / US-031 — object-layer deny inside an action body (member actor)", () => {
  it("rejects cross-member object writes from a member-permitted action body", async () => {
    // The function-backed runner wraps any non-FunctionBackedActionError handler
    // throw in a FunctionBackedActionError carrying the original on `cause`.
    // We assert on the cause so the test reflects what users see (the wrapped
    // error) without losing specificity about WHY it failed.
    let caught: unknown;
    try {
      await invokeAction({
        actionName: "poke_member",
        params: { member: MEMBER_B_ID, new_tier: "lifetime" },
        ctx: memberCtx,
        ontology,
        functionsDir,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const cause = (caught as { cause?: unknown }).cause ?? caught;
    expect(cause).toBeInstanceOf(PermissionError);
    expect((cause as PermissionError).operation).toBe("update");
    expect((cause as PermissionError).objectType).toBe("Member");

    // Crucially: the target row is unchanged.
    const after = await db.objects.Member.findById(MEMBER_B_ID);
    expect(after?.tier).toBe("basic");
  });

  it("permits the same action when the same member acts on their OWN row", async () => {
    const result = await invokeAction({
      actionName: "poke_member",
      params: { member: MEMBER_A_ID, new_tier: "sustaining" },
      ctx: memberCtx,
      ontology,
      functionsDir,
    });
    expect((result as { ok: boolean }).ok).toBe(true);
    const after = await db.objects.Member.findById(MEMBER_A_ID);
    expect(after?.tier).toBe("sustaining");
  });

  it("permits a steward to update any member through the same action", async () => {
    const result = await invokeAction({
      actionName: "poke_member",
      params: { member: MEMBER_B_ID, new_tier: "lifetime" },
      ctx: stewardCtx,
      ontology,
      functionsDir,
    });
    expect((result as { ok: boolean }).ok).toBe(true);
    const after = await db.objects.Member.findById(MEMBER_B_ID);
    expect(after?.tier).toBe("lifetime");
  });
});
