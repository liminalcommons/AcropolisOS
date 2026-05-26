// Step-2b acceptance gate: composeOrgView validates through the catalog AND the
// fail-closed read fence (buildCanReadType) BEFORE persisting. Proves:
//   - valid data_table over shift (read:["*"]) with steward → ok + persisted
//   - data_table over booking (read:[steward,manager]) with a MEMBER → reject,
//     NOT persisted (fail-closed: an actor who can't read the type can't compose it)
//   - invalid kind / unknown type / bad column → reject, NOT persisted
//
// Uses the REAL shipped ontology permissions (same source as ctx.objects). The
// store writes to uploads/org-dashboard.json under the package root — reset
// between tests via clearOrgDashboard so each assertion starts clean.

import path from "node:path";
import { describe, expect, it, beforeAll, afterEach } from "vitest";
import { composeOrgView } from "./compose-view";
import { readOrgDashboard, clearOrgDashboard } from "./store";
import { buildCanReadType } from "@/lib/widgets/read-api";
import { loadOntology } from "@/lib/ontology/load";
import type { Ontology } from "@/lib/ontology/schema";
import type { Actor } from "@/lib/ctx";

const steward: Actor = {
  userId: "u-steward",
  email: "steward@example.com",
  role: "steward",
  customRoles: [],
};

const member: Actor = {
  userId: "u-member",
  email: "member@example.com",
  role: "member",
  customRoles: [],
};

let ontology: Ontology;

beforeAll(async () => {
  // Real shipped ontology: shift/bed read:["*"], booking read:[steward,manager].
  ontology = await loadOntology(path.resolve(__dirname, "../../ontology"));
});

afterEach(async () => {
  // Reset the store file so each test starts from the default.
  await clearOrgDashboard();
});

describe("composeOrgView — governed + fail-closed", () => {
  it("valid data_table over shift with steward → ok and persisted", async () => {
    const canReadType = buildCanReadType(steward, ontology);
    const result = await composeOrgView(
      {
        kind: "data_table",
        type: "shift",
        columns: ["label", "kind", "starts_at", "status"],
        limit: 20,
      },
      canReadType,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.descriptor.id).toBe("compose-shift-data_table");

    const dashboard = await readOrgDashboard();
    const persisted = dashboard.widgets.find(
      (w) => w.id === "compose-shift-data_table",
    );
    expect(persisted).toBeDefined();
    expect(persisted?.kind).toBe("data_table");
  });

  it("data_table over booking with a MEMBER → rejected (fail-closed) and NOT persisted", async () => {
    const canReadType = buildCanReadType(member, ontology);
    const result = await composeOrgView(
      {
        kind: "data_table",
        type: "booking",
        columns: ["label", "status"],
        limit: 10,
      },
      canReadType,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("not authorized to read booking");

    // Nothing for booking was persisted — store returns the default (bed list).
    const dashboard = await readOrgDashboard();
    expect(
      dashboard.widgets.some((w) => w.id === "compose-booking-data_table"),
    ).toBe(false);
  });

  it("invalid kind → rejected and not persisted", async () => {
    const canReadType = buildCanReadType(steward, ontology);
    const result = await composeOrgView(
      // @ts-expect-error — deliberately invalid kind
      { kind: "pie_chart", type: "shift", columns: ["label"] },
      canReadType,
    );
    expect(result.ok).toBe(false);

    const dashboard = await readOrgDashboard();
    // Only the default bed-list descriptor — nothing composed.
    expect(dashboard.widgets.every((w) => !w.id.startsWith("compose-"))).toBe(true);
  });

  it("unknown type → rejected and not persisted", async () => {
    const canReadType = buildCanReadType(steward, ontology);
    const result = await composeOrgView(
      // "spaceship" is not in CATALOG_VALID_TYPES — rejected at the type gate.
      { kind: "data_table", type: "spaceship", columns: ["label"] },
      canReadType,
    );
    expect(result.ok).toBe(false);

    const dashboard = await readOrgDashboard();
    expect(dashboard.widgets.every((w) => !w.id.startsWith("compose-"))).toBe(true);
  });

  it("bad column → rejected and not persisted", async () => {
    const canReadType = buildCanReadType(steward, ontology);
    const result = await composeOrgView(
      {
        kind: "data_table",
        type: "shift",
        columns: ["not_a_real_field"],
      },
      canReadType,
    );
    expect(result.ok).toBe(false);

    const dashboard = await readOrgDashboard();
    expect(
      dashboard.widgets.some((w) => w.id === "compose-shift-data_table"),
    ).toBe(false);
  });
});
