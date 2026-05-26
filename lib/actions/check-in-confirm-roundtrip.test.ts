// check_in — always_confirm governance ROUND-TRIP proof (deterministic, no browser).
//
// The browser chat panel is too flaky to verify the always_confirm contract,
// so this locks it in at the apply_action surface — the SAME entry point the
// agent and the Confirm button drive:
//
//   Step A (agent path):  runApplyActionTool({ ..., policy })  WITHOUT bypass
//     → policy gate resolves always_confirm → confirmation_required envelope,
//       dispatcher NEVER called, NO mutation.
//
//   Step B (confirm path): runApplyActionTool({ ..., policy, bypassConfirmation:true })
//     → exactly what app/api/chat/confirm/route.ts sets server-side →
//       dispatcher fires invokeAction → handler mutates Booking + Guest.
//
// Mirrors log-incident-auto-apply.test.ts (harness: resolveActionPolicy +
// createInProcessDispatcher + runApplyActionTool) and check-in.test.ts
// (Booking + Guest fixture). No new production code is expected — this proves
// the wiring already in place: agent → confirmation_required → confirm →
// handler → mutation.

import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuditStore } from "@/lib/audit/writer";
import type { Actor } from "@/lib/ctx";
import { loadOntology } from "@/lib/ontology/load";
import {
  buildObjectPermissionsMap,
  createCtx,
  createInMemoryStore,
  type OntologyCtx,
  type OntologyStore,
} from "@/lib/ontology/ctx";
import type { Booking, Guest } from "@/lib/ontology/types.generated";
import type { Ontology } from "@/lib/ontology/schema";
import { createInProcessDispatcher } from "@/lib/actions/dispatcher";
import { resolveActionPolicy } from "@/lib/actions/policy";
import { runApplyActionTool } from "@/lib/agent/tool-gating";

const ONTOLOGY_ROOT = path.resolve(__dirname, "..", "..", "ontology");
const FUNCTIONS_DIR = path.resolve(__dirname, "..", "..", "functions");

const steward: Actor = {
  userId: "00000000-0000-4000-8000-0000000000cc",
  email: "stew@example.com",
  role: "steward",
  customRoles: [],
};

const GUEST_ID = "00000000-0000-4000-8001-000000000010";
const BOOKING_ID = "00000000-0000-4000-8002-000000000010";

function guestRow(overrides: Partial<Guest> = {}): Guest {
  return {
    id: GUEST_ID,
    full_name: "Lena Petrov",
    email: "lena@example.com",
    country: "BR",
    phone: "555-0000",
    arrived_at: "2026-06-03",
    expected_departure: "2026-06-07",
    current_status: "booked",
    is_work_trader: false,
    ...overrides,
  };
}

function bookingRow(overrides: Partial<Booking> = {}): Booking {
  return {
    id: BOOKING_ID,
    label: "Lena Petrov / D3-A2 / Jun 3-7",
    guest: GUEST_ID,
    bed: "00000000-0000-4000-8003-000000000010",
    from_date: "2026-06-03",
    to_date: "2026-06-07",
    rate_per_night: 0,
    currency: "EUR",
    source: "direct",
    status: "confirmed",
    ...overrides,
  };
}

const CHECK_IN_PARAMS = { booking: BOOKING_ID };

let ontology: Ontology;
let db: OntologyStore;
let audit: InMemoryAuditStore;
let stewardCtx: OntologyCtx;

beforeEach(async () => {
  ontology = await loadOntology(ONTOLOGY_ROOT);
  const permissions = buildObjectPermissionsMap(ontology);
  db = createInMemoryStore();
  audit = new InMemoryAuditStore();
  stewardCtx = createCtx({ db, actor: steward, permissions, audit });
  // Seed a confirmed booking + a not-yet-checked-in guest.
  await db.objects.Guest.create(guestRow({ current_status: "booked" }));
  await db.objects.Booking.create(bookingRow({ status: "confirmed" }));
});

describe("check_in — always_confirm policy gate", () => {
  it("the action is function-backed and always_confirm", () => {
    const def = ontology.action_types.check_in;
    expect(def).toBeDefined();
    expect(def?.function).toBe("check-in");
    expect(def?.agent_policy).toBe("always_confirm");
  });

  it("resolveActionPolicy returns the always_confirm confirmation gate", async () => {
    const decision = await resolveActionPolicy({
      ontology,
      actionName: "check_in",
      params: CHECK_IN_PARAMS,
      ctx: stewardCtx,
    });
    expect(decision).toEqual({
      decision: "confirmation_required",
      reason: "always_confirm",
    });
  });
});

describe("check_in — apply_action always_confirm ROUND-TRIP", () => {
  it("Step A (agent, no bypass): gated → confirmation_required, dispatcher NOT run, no mutation", async () => {
    const dispatcher = createInProcessDispatcher({
      ctx: stewardCtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
    });

    const result = await runApplyActionTool({
      actor: steward,
      dispatcher,
      action: "check_in",
      params: CHECK_IN_PARAMS,
      policy: { ontology, ctx: stewardCtx },
      // NO bypassConfirmation — this is the agent/LLM path, which must gate.
    });

    // always_confirm ⇒ NOT applied: ok:false with a confirmation envelope.
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("confirmation_required");
    expect(result.confirmation_required).toMatchObject({
      action: "check_in",
      params: CHECK_IN_PARAMS,
      reason: "always_confirm",
      required_permissions: ["steward", "manager"],
    });
    // No applied result, no audit row for an applied action.
    expect(result.result).toBeUndefined();

    // The handler did NOT run: Booking still confirmed, Guest still booked.
    const booking = await db.objects.Booking.findById(BOOKING_ID);
    expect(booking?.status).toBe("confirmed");
    const guest = await db.objects.Guest.findById(GUEST_ID);
    expect(guest?.current_status).toBe("booked");
  });

  it("Step B (confirm, bypassConfirmation): applies → handler mutates Booking + Guest", async () => {
    const dispatcher = createInProcessDispatcher({
      ctx: stewardCtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
    });

    // This is EXACTLY what app/api/chat/confirm/route.ts sets server-side after
    // the human clicks Confirm: same runApplyActionTool, same args, plus the
    // bypassConfirmation flag that the LLM tool schema never exposes.
    const result = await runApplyActionTool({
      actor: steward,
      dispatcher,
      action: "check_in",
      params: CHECK_IN_PARAMS,
      policy: { ontology, ctx: stewardCtx },
      bypassConfirmation: true,
    });

    // Bypass ⇒ the action fired (ok:true), NOT a confirmation envelope.
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result).not.toHaveProperty("confirmation_required");

    // The function-backed handler returned its check-in envelope.
    expect(result.result).toMatchObject({
      ok: true,
      booking: BOOKING_ID,
      booking_status: "checked_in",
      guest: GUEST_ID,
      guest_status: "checked_in",
      checked_in: true,
    });

    // The mutation actually committed and reads back through ctx.
    const booking = await db.objects.Booking.findById(BOOKING_ID);
    expect(booking?.status).toBe("checked_in");
    const guest = await db.objects.Guest.findById(GUEST_ID);
    expect(guest?.current_status).toBe("checked_in");

    // An audit "ok" row links the applied action.
    expect(result.audit_id).toBeTypeOf("string");
    const rows = await audit.listActionAudit();
    const okRow = rows.find(
      (r) => r.subject_id === "check_in" && r.metadata.result === "ok",
    );
    expect(okRow).toBeDefined();
    expect(result.audit_id).toBe(okRow!.id);
  });
});
