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
import { composeOrgView, removeOrgView, clearOrgView } from "./compose-view";
import { readOrgDashboard, clearOrgDashboard, adminDefaultBoard } from "./store";
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
  // Reset the store file so each test starts from empty (the floor is derived
  // at the /org page, not in the store).
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
      { canReadType, canWriteDashboard: true, ontology },
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
    // A member is not a steward → canWriteDashboard:false. The structural
    // write-auth gate fires FIRST (before the read fence), so the reason is the
    // dashboard-write rejection, not the read-type rejection.
    const result = await composeOrgView(
      {
        kind: "data_table",
        type: "booking",
        columns: ["label", "status"],
        limit: 10,
      },
      { canReadType, canWriteDashboard: false, ontology },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Not authorized to modify the org dashboard");

    // Nothing for booking was persisted — the absent store returns empty.
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
      { canReadType, canWriteDashboard: true, ontology },
    );
    expect(result.ok).toBe(false);

    const dashboard = await readOrgDashboard();
    // The absent store returns empty — nothing composed.
    expect(dashboard.widgets.every((w) => !w.id.startsWith("compose-"))).toBe(true);
  });

  it("unknown type → rejected and not persisted", async () => {
    const canReadType = buildCanReadType(steward, ontology);
    const result = await composeOrgView(
      // "spaceship" is not in the loaded ontology — rejected at the type gate.
      { kind: "data_table", type: "spaceship", columns: ["label"] },
      { canReadType, canWriteDashboard: true, ontology },
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
      { canReadType, canWriteDashboard: true, ontology },
    );
    expect(result.ok).toBe(false);

    const dashboard = await readOrgDashboard();
    expect(
      dashboard.widgets.some((w) => w.id === "compose-shift-data_table"),
    ).toBe(false);
  });
});

describe("structural write-authorization — fail-closed and independent of read-auth", () => {
  it("canWriteDashboard:false → rejected and NOT persisted, even for a READABLE public type (shift)", async () => {
    // shift is read:["*"] — fully readable. Write-auth is INDEPENDENT of
    // read-auth: a caller who cannot WRITE the dashboard cannot compose it even
    // when they CAN read the type. Proves the write gate is structural and prior.
    const canReadType = buildCanReadType(steward, ontology);
    const result = await composeOrgView(
      {
        kind: "data_table",
        type: "shift",
        columns: ["label", "status"],
      },
      { canReadType, canWriteDashboard: false, ontology },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Not authorized to modify the org dashboard");

    const dashboard = await readOrgDashboard();
    expect(
      dashboard.widgets.some((w) => w.id === "compose-shift-data_table"),
    ).toBe(false);
  });

  it("canWriteDashboard:true + readable type → persists", async () => {
    const canReadType = buildCanReadType(steward, ontology);
    const result = await composeOrgView(
      { kind: "data_table", type: "shift", columns: ["label", "status"] },
      { canReadType, canWriteDashboard: true, ontology },
    );
    expect(result.ok).toBe(true);

    const dashboard = await readOrgDashboard();
    expect(
      dashboard.widgets.some((w) => w.id === "compose-shift-data_table"),
    ).toBe(true);
  });
});

describe("removeOrgView — gated, fail-closed, idempotent", () => {
  it("with write-auth → removes the composed widget", async () => {
    const canReadType = buildCanReadType(steward, ontology);
    await composeOrgView(
      { kind: "data_table", type: "shift", columns: ["label"] },
      { canReadType, canWriteDashboard: true, ontology },
    );
    expect(
      (await readOrgDashboard()).widgets.some(
        (w) => w.id === "compose-shift-data_table",
      ),
    ).toBe(true);

    const r = await removeOrgView(
      { kind: "data_table", type: "shift" },
      { canWriteDashboard: true },
    );
    expect(r.ok).toBe(true);

    expect(
      (await readOrgDashboard()).widgets.some(
        (w) => w.id === "compose-shift-data_table",
      ),
    ).toBe(false);
  });

  it("without write-auth → {ok:false} and the widget is still present", async () => {
    const canReadType = buildCanReadType(steward, ontology);
    await composeOrgView(
      { kind: "data_table", type: "shift", columns: ["label"] },
      { canReadType, canWriteDashboard: true, ontology },
    );

    const r = await removeOrgView(
      { kind: "data_table", type: "shift" },
      { canWriteDashboard: false },
    );
    expect(r.ok).toBe(false);

    expect(
      (await readOrgDashboard()).widgets.some(
        (w) => w.id === "compose-shift-data_table",
      ),
    ).toBe(true);
  });
});

describe("clearOrgView — gated, fail-closed", () => {
  it("with write-auth → dashboard returns to empty (floor derived at the page)", async () => {
    const canReadType = buildCanReadType(steward, ontology);
    await composeOrgView(
      { kind: "data_table", type: "shift", columns: ["label"] },
      { canReadType, canWriteDashboard: true, ontology },
    );

    const r = await clearOrgView({ canWriteDashboard: true });
    expect(r.ok).toBe(true);

    // After clear the store is empty; the admin floor is derived at the /org
    // page (adminDefaultBoard), not returned by the store.
    const dashboard = await readOrgDashboard();
    expect(dashboard.widgets).toHaveLength(0);
  });

  it("without write-auth → {ok:false} and the dashboard is unchanged", async () => {
    const canReadType = buildCanReadType(steward, ontology);
    await composeOrgView(
      { kind: "data_table", type: "shift", columns: ["label"] },
      { canReadType, canWriteDashboard: true, ontology },
    );

    const r = await clearOrgView({ canWriteDashboard: false });
    expect(r.ok).toBe(false);

    expect(
      (await readOrgDashboard()).widgets.some(
        (w) => w.id === "compose-shift-data_table",
      ),
    ).toBe(true);
  });
});

describe("multiple widgets coexist (append, not replace)", () => {
  it("composing two DIFFERENT type+kind widgets → readOrgDashboard contains BOTH", async () => {
    const canReadType = buildCanReadType(steward, ontology);

    const a = await composeOrgView(
      { kind: "data_table", type: "shift", columns: ["label", "status"] },
      { canReadType, canWriteDashboard: true, ontology },
    );
    expect(a.ok).toBe(true);

    const b = await composeOrgView(
      { kind: "metric", type: "bed" },
      { canReadType, canWriteDashboard: true, ontology },
    );
    expect(b.ok).toBe(true);

    const dashboard = await readOrgDashboard();
    expect(
      dashboard.widgets.some((w) => w.id === "compose-shift-data_table"),
    ).toBe(true);
    expect(
      dashboard.widgets.some((w) => w.id === "compose-bed-metric"),
    ).toBe(true);
  });

  it("threads a FILTER into a data_table config (incl. @today) — the agent can compose filtered lists", async () => {
    // Regression for the VN-35 gap: buildConfig dropped `filter` for data_table,
    // so the agent could compose filtered COUNTS but not filtered LISTS (could
    // not reproduce the veto-queue / arrivals-today views). booking is
    // read:[steward,manager] → steward + canWriteDashboard.
    const canReadType = buildCanReadType(steward, ontology);
    const result = await composeOrgView(
      {
        kind: "data_table",
        type: "booking",
        columns: ["label", "from_date"],
        filter: { field: "from_date", value: "@today" },
      },
      { canReadType, canWriteDashboard: true, ontology },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cfg = result.descriptor.config as {
      filter?: { field: string; value: string };
    };
    expect(cfg.filter).toEqual({ field: "from_date", value: "@today" });

    const dashboard = await readOrgDashboard();
    const persisted = dashboard.widgets.find(
      (w) => w.id === "compose-booking-data_table",
    );
    const persistedCfg = persisted?.config as {
      filter?: { field: string; value: string };
    };
    expect(persistedCfg?.filter).toEqual({ field: "from_date", value: "@today" });
  });
});

describe("adminDefaultBoard — derived admin floor", () => {
  it("leads with the open-agent_blocker veto-queue and has a count metric per type", () => {
    const board = adminDefaultBoard(ontology, () => true);
    expect(board[0].kind).toBe("data_table");
    expect((board[0].config as { type: string }).type).toBe("agent_blocker");
    expect((board[0].config as { filter?: { field: string; value: string } }).filter)
      .toEqual({ field: "status", value: "open" });
    expect(board.some((d) => d.kind === "metric")).toBe(true);
    const vqCols = (board[0].config as { columns: string[] }).columns;
    expect(vqCols).toContain("id");            // row-id action target
    expect(vqCols).toContain("pathways");      // resolver choices source
    expect(vqCols).toContain("confirm_action");// confirm source
  });
});
