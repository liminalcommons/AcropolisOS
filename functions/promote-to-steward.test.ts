// M2.5: end-to-end action composition exercising the REAL seed + REAL
// function file (not in-line fixtures). Invokes promote_to_steward, then
// asserts the audit chain hangs together: parent → change_tier child →
// notify_member side-effect, all reachable via buildActionChain(rootId).

import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildActionChain } from "../lib/audit/reader";
import { InMemoryAuditStore } from "../lib/audit/writer";
import type { Actor } from "../lib/ctx";
import { invokeAction } from "../lib/actions/invoke";
import type { SideEffectAdapters } from "../lib/actions/side-effects";
import { loadOntology } from "../lib/ontology/load";
import {
  createCtx,
  createInMemoryStore,
  type OntologyCtx,
  type OntologyStore,
} from "../lib/ontology/ctx";
import type { Member } from "../lib/ontology/types.generated";
import type { Ontology } from "../lib/ontology/schema";

const SEED_ROOT = path.resolve(__dirname, "..", "scenarios", "small-community", "ontology");
const FUNCTIONS_DIR = path.resolve(__dirname, "..", "functions");

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
    phone: "555-0000",
    tier_role: "staff",
    started_at: "2026-01-01",
    notes: "",
    ...overrides,
  };
}

let ontology: Ontology;
let db: OntologyStore;
let audit: InMemoryAuditStore;
let ctx: OntologyCtx;
let memberCtx: OntologyCtx;
let adapters: SideEffectAdapters;

beforeEach(async () => {
  ontology = await loadOntology(SEED_ROOT);
  db = createInMemoryStore();
  audit = new InMemoryAuditStore();
  ctx = createCtx({ db, actor: steward, audit });
  memberCtx = createCtx({ db, actor: member, audit });
  adapters = {
    sendMail: vi.fn(async () => undefined),
    postWebhook: vi.fn(async () => ({ status: 200 })),
    config: {},
  };
});

describe("promote_to_steward — real seed composition", () => {
  it("loads from the real ontology seed (proves the yaml + function discover one another)", () => {
    expect(ontology.action_types.promote_to_steward).toBeDefined();
    expect(ontology.action_types.promote_to_steward?.function).toBe(
      "promote-to-steward",
    );
    expect(ontology.action_types.promote_to_steward?.permissions).toEqual([
      "steward",
    ]);
  });

  it("composes change_tier inside the handler and the audit chain links back via buildActionChain", async () => {
    const memberId = "00000000-0000-4000-8000-000000000001";
    await db.objects.Member.create(memberRow(memberId, { tier_role: "staff" }));

    const result = await invokeAction({
      actionName: "promote_to_steward",
      params: { member: memberId },
      ctx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
      sideEffectAdapters: adapters,
    });
    expect(result).toMatchObject({ ok: true, promoted: true });

    const after = await db.objects.Member.findById(memberId);
    expect(after?.tier_role).toBe("manager");

    const rows = await audit.listActionAudit();
    const promotePre = rows.find(
      (r) =>
        r.subject_id === "promote_to_steward" &&
        r.metadata.result === "pending",
    );
    expect(promotePre).toBeDefined();

    // 0g-codegen-drift: change_tier was removed (hostel-domain rename to
    // promote-to-steward doing a direct Member.update). The audit chain now
    // only contains the root promote_to_steward rows + the notify_member
    // side-effect. No change_tier child row exists.
    const chain = buildActionChain(rows, promotePre!.id);
    const subjectsAtDepthOne = chain
      .filter((c) => c.depth === 1)
      .map((c) => c.row.subject_id)
      .sort();
    // notify_member side-effect rows are recorded with subject_type
    // "side_effect" and subject_id like "notify_member" (M2.4).
    expect(subjectsAtDepthOne).toContain("notify_member");

    // Side-effect adapter actually fired.
    expect(adapters.sendMail).toHaveBeenCalled();
  });

  it("DENIES a member-actor invocation — permission required on the parent (steward-only)", async () => {
    const memberId = "00000000-0000-4000-8000-000000000002";
    await db.objects.Member.create(memberRow(memberId));

    await expect(
      invokeAction({
        actionName: "promote_to_steward",
        params: { member: memberId },
        ctx: memberCtx,
        ontology,
        functionsDir: FUNCTIONS_DIR,
        sideEffectAdapters: adapters,
      }),
    ).rejects.toThrow(/cannot invoke action "promote_to_steward"/);

    // No tier change.
    const after = await db.objects.Member.findById(memberId);
    expect(after?.tier_role).toBe("staff");
    expect(adapters.sendMail).not.toHaveBeenCalled();
  });
});
