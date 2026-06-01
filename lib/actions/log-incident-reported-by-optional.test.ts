// Gap #2 regression — log_incident's reported_by must be OPTIONAL.
//
// `reported_by` is a ref → Member on IncidentLog. The declarative runner cannot
// auto-fill a ref (autoFillForProperty returns undefined for `ref`), and
// log_incident does not collect it as a parameter — so the create-leg always
// builds the row WITHOUT reported_by. When the ontology left reported_by
// implicitly required, codegen emitted a NOT NULL column and `z.string()`
// (required), so the create-leg threw a NOT-NULL violation on live Postgres —
// while the in-memory store (which enforces no constraints) passed, hiding it.
// Fix: reported_by is `required: false`, so the column is nullable and the
// generated schema accepts a reporter-less row. This pins both.

import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadOntology } from "@/lib/ontology/load";
import {
  buildObjectPermissionsMap,
  createCtx,
  createInMemoryStore,
  type OntologyStore,
} from "@/lib/ontology/ctx";
import type { Ontology } from "@/lib/ontology/schema";
import type { Actor } from "@/lib/ctx";
import { InMemoryAuditStore } from "@/lib/audit/writer";
import { runDeclarativeAction } from "@/lib/actions/declarative";
import { IncidentLogSchema } from "@/lib/ontology/types.generated";

const ONTOLOGY_ROOT = path.resolve(__dirname, "..", "..", "ontology");

const steward: Actor = {
  userId: "00000000-0000-4000-8000-0000000000cc",
  email: "stew@example.com",
  role: "steward",
  customRoles: [],
};

let ontology: Ontology;
let db: OntologyStore;

beforeEach(async () => {
  ontology = await loadOntology(ONTOLOGY_ROOT);
  db = createInMemoryStore();
});

describe("log_incident — reported_by optional (Gap #2: live NOT-NULL fix)", () => {
  it("the generated IncidentLog schema accepts a row WITHOUT reported_by", () => {
    const row = {
      id: "00000000-0000-4000-8000-000000000001",
      summary: "Noise complaint in dorm D3 after midnight",
      category: "noise",
      severity: "low",
      occurred_at: "2026-06-01T00:00:00.000Z",
      resolved: false,
    };
    // Before the fix reported_by was `z.string()` (required) and this failed —
    // the exact mismatch that surfaced as a NOT-NULL violation on Postgres.
    expect(IncidentLogSchema.safeParse(row).success).toBe(true);
  });

  it("the declarative create-leg commits an IncidentLog with no reporter", async () => {
    const permissions = buildObjectPermissionsMap(ontology);
    const audit = new InMemoryAuditStore();
    const ctx = createCtx({ db, actor: steward, permissions, audit });

    const result = await runDeclarativeAction({
      actionName: "log_incident",
      ontology,
      params: { summary: "Lost key at front desk", category: "lost_key", severity: "low" },
      ctx,
    });

    expect(result).toMatchObject({
      ok: true,
      directive: "creates_object",
      object_type: "IncidentLog",
    });

    const created = await db.objects.IncidentLog.findMany({});
    expect(created).toHaveLength(1);
    // The runner cannot supply a ref → reported_by is absent; the column must be
    // nullable for the live create to succeed.
    expect((created[0] as { reported_by?: unknown }).reported_by ?? null).toBeNull();
    expect(IncidentLogSchema.safeParse(created[0]).success).toBe(true);
  });
});
