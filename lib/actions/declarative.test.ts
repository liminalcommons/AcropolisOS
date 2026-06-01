// US-024: Declarative action runner — verifies each YAML directive
// (creates_object / creates_link / updates / deletes) executes against the
// in-memory ontology store with no TS handler involved.

import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "../ctx";
import { loadOntology } from "../ontology/load";
import {
  createCtx,
  createInMemoryStore,
  type LinkAccess,
  type LinkEdge,
  type OntologyCtx,
  type OntologyStore,
} from "../ontology/ctx";
import type { Ontology } from "../ontology/schema";
import type { Member } from "../ontology/types.generated";
import {
  DeclarativeActionError,
  runDeclarativeAction,
} from "./declarative";

const steward: Actor = {
  userId: "u-steward",
  email: "s@example.com",
  role: "steward",
  customRoles: [],
};

const SEED_DIR = path.join(
  __dirname,
  "..",
  "..",
  "scenarios",
  "small-community", "ontology",
);

let ontology: Ontology;
let db: OntologyStore;
let ctx: OntologyCtx;

// Minimal in-memory link store for tests that exercise the creates_link
// directive. Mirrors the private InMemoryLinkAccess in ctx.ts.
class TestLinkAccess<L extends Record<string, unknown>> implements LinkAccess<L> {
  readonly edges: LinkEdge<L>[] = [];

  async create(input: { from: string; to: string; properties: L }): Promise<void> {
    const idx = this.edges.findIndex((e) => e.from === input.from && e.to === input.to);
    const edge: LinkEdge<L> = { from: input.from, to: input.to, properties: { ...input.properties } };
    if (idx >= 0) {
      this.edges[idx] = edge;
    } else {
      this.edges.push(edge);
    }
  }

  async delete(input: { from: string; to: string }): Promise<boolean> {
    const idx = this.edges.findIndex((e) => e.from === input.from && e.to === input.to);
    if (idx < 0) return false;
    this.edges.splice(idx, 1);
    return true;
  }

  async traverse(input: { from?: string; to?: string }): Promise<LinkEdge<L>[]> {
    return this.edges
      .filter((e) => (input.from === undefined ? true : e.from === input.from))
      .filter((e) => (input.to === undefined ? true : e.to === input.to))
      .map((e) => ({ ...e, properties: { ...e.properties } }));
  }
}

beforeEach(async () => {
  ontology = await loadOntology(SEED_DIR);
  db = createInMemoryStore();
  ctx = createCtx({ db, actor: steward });
});

function memberRow(id: string, overrides: Partial<Member> = {}): Member {
  return {
    id,
    full_name: `Member ${id}`,
    email: `${id}@example.com`,
    phone: "555-0000",
    tier_role: "staff",
    started_at: "2026-01-01",
    ...overrides,
  };
}

// Synthetic creates_object action used by the creates_object + error-surface
// suites. Matches the live Member schema (hostel ontology).
function makeOntologyWithCreateMember(base: Ontology): Ontology {
  return {
    ...base,
    action_types: {
      ...base.action_types,
      create_member: {
        description: "Create a member (declarative, synthetic for test)",
        creates_object: "Member",
        parameters: {
          full_name: { type: "string", required: true },
          email: { type: "string", required: true },
          tier_role: {
            type: "enum",
            values: ["work_trader", "staff", "supervisor", "manager"],
          },
        },
        agent_policy: "always_confirm",
      },
    },
  };
}

// Synthetic creates_link action + link-type entry used by the creates_link suite.
function makeOntologyWithAttended(base: Ontology): Ontology {
  return {
    ...base,
    action_types: {
      ...base.action_types,
      log_attendance: {
        description: "Record member attendance at an event (synthetic for test)",
        creates_link: "attended",
        parameters: {
          member: { type: "ref", target: "Member", required: true },
          event: { type: "ref", target: "Event", required: true },
          role: {
            type: "enum",
            values: ["attendee", "organizer", "speaker"],
            default: "attendee",
          },
        },
        agent_policy: "auto_apply",
      },
    },
    link_types: {
      ...base.link_types,
      attended: {
        from: "Member",
        to: "Event",
        cardinality: "many-to-many",
        properties: {
          attended_at: { type: "timestamp" },
          role: {
            type: "enum",
            values: ["attendee", "organizer", "speaker"],
            default: "attendee",
          },
        },
      },
    },
  };
}

describe("runDeclarativeAction — creates_object (synthetic create_member action)", () => {
  it("creates a Member row from typed params + auto-filled system fields", async () => {
    const ontologyWithCreate = makeOntologyWithCreateMember(ontology);
    const result = await runDeclarativeAction({
      actionName: "create_member",
      ontology: ontologyWithCreate,
      params: {
        full_name: "Ada Lovelace",
        email: "ada@example.com",
        tier_role: "staff",
      },
      ctx,
    });

    expect(result).toMatchObject({
      ok: true,
      directive: "creates_object",
      object_type: "Member",
    });
    const id = (result as { id: string }).id;
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    const stored = await ctx.objects.Member.findById(id);
    expect(stored).toMatchObject({
      id,
      full_name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });
});

describe("runDeclarativeAction — creates_link (synthetic log_attendance action)", () => {
  let attendedLink: TestLinkAccess<Record<string, unknown>>;

  beforeEach(() => {
    attendedLink = new TestLinkAccess();
    // Inject the link store so the engine can resolve ctx.links.attended
    (db.links as Record<string, unknown>).attended = attendedLink;
    ctx = createCtx({ db, actor: steward });
  });

  it("creates the attended edge with role + auto-filled attended_at", async () => {
    const ontologyWithLink = makeOntologyWithAttended(ontology);
    await db.objects.Member.create(memberRow("m-1"));
    await db.objects.Event.create({
      id: "e-1",
      title: "Event e-1",
      starts_at: "2026-06-01T18:00:00+00:00",
      duration_hours: 2,
      organizer: "u-steward",
      description: "An event",
      status: "scheduled",
    });

    const result = await runDeclarativeAction({
      actionName: "log_attendance",
      ontology: ontologyWithLink,
      params: { member: "m-1", event: "e-1", role: "organizer" },
      ctx,
    });

    expect(result).toMatchObject({
      ok: true,
      directive: "creates_link",
      link_type: "attended",
      from: "m-1",
      to: "e-1",
    });

    const edges = await attendedLink.traverse({ from: "m-1" });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      from: "m-1",
      to: "e-1",
      properties: { role: "organizer" },
    });
    expect(String(edges[0].properties.attended_at ?? "")).toMatch(/^\d{4}-/);
  });

  it("defaults link role enum to attendee when omitted", async () => {
    const ontologyWithLink = makeOntologyWithAttended(ontology);
    await db.objects.Member.create(memberRow("m-2"));
    await db.objects.Event.create({
      id: "e-2",
      title: "Event e-2",
      starts_at: "2026-06-01T18:00:00+00:00",
      duration_hours: 2,
      organizer: "u-steward",
      description: "An event",
      status: "scheduled",
    });
    await runDeclarativeAction({
      actionName: "log_attendance",
      ontology: ontologyWithLink,
      params: { member: "m-2", event: "e-2" },
      ctx,
    });
    const edges = await attendedLink.traverse({ from: "m-2" });
    expect(edges[0].properties.role).toBe("attendee");
  });
});

describe("runDeclarativeAction — updates directive (synthetic action)", () => {
  it("patches a Member row by id with the remaining params", async () => {
    await db.objects.Member.create(memberRow("m-9", { tier_role: "staff" }));

    const ontologyWithUpdate: Ontology = {
      ...ontology,
      action_types: {
        ...ontology.action_types,
        update_member_tier: {
          description: "Update member tier (declarative)",
          updates: "Member",
          parameters: {
            id: { type: "ref", target: "Member", required: true },
            tier: {
              type: "enum",
              values: ["basic", "sustaining", "lifetime"],
              required: true,
            },
          },
          agent_policy: "always_confirm",
        },
      },
    };

    const result = await runDeclarativeAction({
      actionName: "update_member_tier",
      ontology: ontologyWithUpdate,
      params: { id: "m-9", tier: "lifetime" },
      ctx,
    });

    expect(result).toMatchObject({
      ok: true,
      directive: "updates",
      object_type: "Member",
      id: "m-9",
    });
    const stored = await ctx.objects.Member.findById("m-9");
    expect((stored as unknown as Record<string, unknown>)?.tier).toBe("lifetime");
  });

  it("returns ok:false / not_found when the row is missing", async () => {
    const ontologyWithUpdate: Ontology = {
      ...ontology,
      action_types: {
        ...ontology.action_types,
        update_member_tier: {
          updates: "Member",
          parameters: {
            id: { type: "ref", target: "Member", required: true },
            tier: {
              type: "enum",
              values: ["basic", "sustaining", "lifetime"],
              required: true,
            },
          },
          agent_policy: "always_confirm",
        },
      },
    };
    const result = await runDeclarativeAction({
      actionName: "update_member_tier",
      ontology: ontologyWithUpdate,
      params: { id: "ghost", tier: "lifetime" },
      ctx,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "not_found",
      directive: "updates",
      object_type: "Member",
      id: "ghost",
    });
  });
});

describe("runDeclarativeAction — deletes directive (synthetic action)", () => {
  it("deletes a Member row by id", async () => {
    await db.objects.Member.create(memberRow("m-d"));
    const ontologyWithDelete: Ontology = {
      ...ontology,
      action_types: {
        ...ontology.action_types,
        remove_member: {
          deletes: "Member",
          parameters: {
            id: { type: "ref", target: "Member", required: true },
          },
          agent_policy: "always_confirm",
        },
      },
    };

    const result = await runDeclarativeAction({
      actionName: "remove_member",
      ontology: ontologyWithDelete,
      params: { id: "m-d" },
      ctx,
    });

    expect(result).toMatchObject({
      ok: true,
      directive: "deletes",
      object_type: "Member",
      id: "m-d",
    });
    expect(await ctx.objects.Member.findById("m-d")).toBeNull();
  });
});

describe("runDeclarativeAction — error surface", () => {
  it("throws DeclarativeActionError if the action is not in the ontology", async () => {
    await expect(
      runDeclarativeAction({
        actionName: "ghost",
        ontology,
        params: {},
        ctx,
      }),
    ).rejects.toBeInstanceOf(DeclarativeActionError);
  });

  it("throws DeclarativeActionError if the action has no declarative directive", async () => {
    await expect(
      runDeclarativeAction({
        actionName: "change_tier",
        ontology,
        params: { member: "m-1", new_tier: "lifetime" },
        ctx,
      }),
    ).rejects.toThrow(/not declarative/);
  });

  it("throws DeclarativeActionError on param schema mismatch", async () => {
    const ontologyWithCreate = makeOntologyWithCreateMember(ontology);
    await expect(
      runDeclarativeAction({
        actionName: "create_member",
        ontology: ontologyWithCreate,
        // full_name should be string; passing a number triggers schema validation
        params: { full_name: 42, email: "bad@example.com" },
        ctx,
      }),
    ).rejects.toBeInstanceOf(DeclarativeActionError);
  });
});
