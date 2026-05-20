// M4.2 step-1 RED: invite_member must
//   1) generate a 32-char hex code + set invite_expires_at to ~now+7d on the
//      target Member row, when invoked by a steward
//   2) dispatch notify_member with a body containing the /claim?code=<code>
//      link (asserted via the sendMail adapter spy — decoupled from the
//      M4.1 inbox-row contract that the parallel subagent is implementing)
//   3) reject non-steward invocation via the action permission middleware
//   4) reject re-invite of an already-claimed Member (user_id is set)
//
// Test style mirrors functions/promote-to-steward.test.ts: load the REAL
// seed + REAL function file via invokeAction, so YAML wiring + function
// discovery + side-effect dispatch are exercised end-to-end.

import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryAuditStore } from "../audit/writer";
import type { Actor } from "../ctx";
import { invokeAction } from "./invoke";
import type { SideEffectAdapters } from "./side-effects";
import { loadOntology } from "../ontology/load";
import {
  buildObjectPermissionsMap,
  createCtx,
  createInMemoryStore,
  type OntologyCtx,
  type OntologyStore,
} from "../ontology/ctx";
import type { Member } from "../ontology/types.generated";
import type { Ontology } from "../ontology/schema";

const SEED_ROOT = path.resolve(__dirname, "..", "..", "seed", "small-community");
const FUNCTIONS_DIR = path.resolve(__dirname, "..", "..", "functions");

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
  } as Member;
}

let ontology: Ontology;
let db: OntologyStore;
let audit: InMemoryAuditStore;
let stewardCtx: OntologyCtx;
let memberCtx: OntologyCtx;
let adapters: SideEffectAdapters;

beforeEach(async () => {
  ontology = await loadOntology(SEED_ROOT);
  db = createInMemoryStore();
  audit = new InMemoryAuditStore();
  // M3.8.32: pass the real permissions map so field-level redaction on
  // invite_code / invite_expires_at is exercised in all test assertions.
  const permissions = buildObjectPermissionsMap(ontology);
  stewardCtx = createCtx({ db, actor: steward, audit, permissions });
  memberCtx = createCtx({ db, actor: memberActor, audit, permissions });
  adapters = {
    sendMail: vi.fn(async () => undefined),
    postWebhook: vi.fn(async () => ({ status: 200 })),
    config: {},
  };
});

describe("invite_member action (M4.2)", () => {
  it("steward invocation generates a 32-char hex code, sets expiry ~now+7d, and dispatches notify_member with the /claim link", async () => {
    const memberId = "00000000-0000-4000-8000-000000000a01";
    await db.objects.Member.create(memberRow(memberId));

    const before = Date.now();
    const result = (await invokeAction({
      actionName: "invite_member",
      params: { member_id: memberId },
      ctx: stewardCtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
      sideEffectAdapters: adapters,
    })) as { invite_code: string; claim_url: string };
    const after = Date.now();

    expect(result.invite_code).toMatch(/^[a-f0-9]{32}$/);
    expect(result.claim_url).toBe(`/claim?code=${result.invite_code}`);

    const persisted = await db.objects.Member.findById(memberId);
    expect(persisted?.invite_code).toBe(result.invite_code);
    expect(persisted?.invite_expires_at).toBeTruthy();
    const expiry = new Date(persisted!.invite_expires_at as string).getTime();
    // 7d in ms = 604_800_000. Allow generous +/- 5s window for clock drift
    // around the assertion bounds.
    expect(expiry).toBeGreaterThanOrEqual(before + 7 * 24 * 3600 * 1000 - 5000);
    expect(expiry).toBeLessThanOrEqual(after + 7 * 24 * 3600 * 1000 + 5000);

    // notify_member side-effect adapter fired — asserting "DISPATCHED with
    // the right link_url" via the sendMail spy. This is decoupled from
    // M4.1's inbox-row contract (which is asserted by the parallel
    // notify-member-writes-inbox.test.ts).
    expect(adapters.sendMail).toHaveBeenCalledTimes(1);
    const call = (adapters.sendMail as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { body: string; action_type?: string };
    expect(call.action_type).toBe("invite_member");
    expect(call.body).toContain(result.claim_url);
    expect(call.body).toContain(result.invite_code);
  });

  it("rejects non-steward invocation (permission_denied)", async () => {
    const memberId = "00000000-0000-4000-8000-000000000a02";
    await db.objects.Member.create(memberRow(memberId));

    await expect(
      invokeAction({
        actionName: "invite_member",
        params: { member_id: memberId },
        ctx: memberCtx,
        ontology,
        functionsDir: FUNCTIONS_DIR,
        sideEffectAdapters: adapters,
      }),
    ).rejects.toThrow(/cannot invoke action "invite_member"/);

    const persisted = await db.objects.Member.findById(memberId);
    expect(persisted?.invite_code ?? null).toBeNull();
    expect(adapters.sendMail).not.toHaveBeenCalled();
  });

  it("non-steward findById on an invited Member hides invite_code and invite_expires_at (M3.8.32 permissions gate)", async () => {
    // Create a placeholder member (no user_id yet) and run the invite as steward.
    const memberId = "00000000-0000-4000-8000-000000000a05";
    await db.objects.Member.create(memberRow(memberId));

    const result = (await invokeAction({
      actionName: "invite_member",
      params: { member_id: memberId },
      ctx: stewardCtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
      sideEffectAdapters: adapters,
    })) as { invite_code: string };

    // Steward sees invite_code on the raw store row.
    const asSeenBySteward = await stewardCtx.objects.Member.findById(memberId);
    expect(asSeenBySteward?.invite_code).toBe(result.invite_code);

    // A different member (not the invitee — they have no user_id link yet so
    // member_self doesn't match) cannot read invite_code or invite_expires_at.
    // memberActor has role "member" and userId "u-member" which differs from
    // the row.id ("00000000-...a05"), so the member_self gate fails and the
    // row is filtered to null (the object-level read gate also applies).
    const asSeenByOther = await memberCtx.objects.Member.findById(memberId);
    // Object-level read gate: member_self fails (different user), steward not
    // in memberActor.role → findById returns null (no read access at all).
    expect(asSeenByOther).toBeNull();
  });

  it("rejects re-invite when the Member is already claimed (user_id is set)", async () => {
    const memberId = "00000000-0000-4000-8000-000000000a03";
    await db.objects.Member.create(
      memberRow(memberId, { user_id: "u-existing" } as Partial<Member>),
    );

    await expect(
      invokeAction({
        actionName: "invite_member",
        params: { member_id: memberId },
        ctx: stewardCtx,
        ontology,
        functionsDir: FUNCTIONS_DIR,
        sideEffectAdapters: adapters,
      }),
    ).rejects.toThrow(/already_claimed/);
  });
});
