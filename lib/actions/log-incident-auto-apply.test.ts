// log_incident — auto_apply governance path proof.
//
// The user's ORIGINAL thesis: the agent applies ontology action_types via
// apply_action, gated by agent_policy. log_incident is the existing-machinery
// proof of the auto_apply leg:
//
//   policy gate (agent_policy: auto_apply) → NO confirmation_required
//     → in-process dispatcher → invokeAction → DECLARATIVE creates_object
//     → ctx.objects.IncidentLog.create(row), committed synchronously.
//
// This asserts the full apply_action surface (runApplyActionTool with both a
// policy gate AND a dispatcher) so we prove the agent-visible contract, not
// just the declarative runner in isolation. No new code is expected here —
// it verifies the wiring already in place.

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

const INCIDENT_PARAMS = {
  summary: "Noise complaint in dorm D3 after midnight",
  category: "noise" as const,
  severity: "low" as const,
};

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
});

describe("log_incident — auto_apply policy gate", () => {
  it("the action is declarative (creates_object IncidentLog) and auto_apply", () => {
    const def = ontology.action_types.log_incident;
    expect(def).toBeDefined();
    expect(def?.creates_object).toBe("IncidentLog");
    expect(def?.agent_policy).toBe("auto_apply");
  });

  it("resolveActionPolicy returns auto_apply (no confirmation gate)", async () => {
    const decision = await resolveActionPolicy({
      ontology,
      actionName: "log_incident",
      params: INCIDENT_PARAMS,
      ctx: stewardCtx,
    });
    expect(decision).toEqual({ decision: "auto_apply" });
  });
});

describe("log_incident — full apply_action auto_apply path", () => {
  it("commits an IncidentLog row WITHOUT confirmation_required", async () => {
    const dispatcher = createInProcessDispatcher({
      ctx: stewardCtx,
      ontology,
      functionsDir: FUNCTIONS_DIR,
    });

    const result = await runApplyActionTool({
      actor: steward,
      dispatcher,
      action: "log_incident",
      params: INCIDENT_PARAMS,
      policy: { ontology, ctx: stewardCtx },
    });

    // auto_apply ⇒ the tool fired (ok:true), NOT a confirmation envelope.
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result).not.toHaveProperty("confirmation_required");

    // The declarative handler returned a creates_object envelope.
    expect(result.result).toMatchObject({
      ok: true,
      directive: "creates_object",
      object_type: "IncidentLog",
    });

    // The row was actually committed and is readable back through ctx.
    const created = await db.objects.IncidentLog.findMany({});
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      summary: INCIDENT_PARAMS.summary,
      category: "noise",
      severity: "low",
    });

    // An audit "ok" row links the committed action.
    expect(result.audit_id).toBeTypeOf("string");
    const rows = await audit.listActionAudit();
    const okRow = rows.find(
      (r) => r.subject_id === "log_incident" && r.metadata.result === "ok",
    );
    expect(okRow).toBeDefined();
    expect(result.audit_id).toBe(okRow!.id);
  });
});
