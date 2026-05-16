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
  type OntologyCtx,
  type OntologyStore,
} from "../ontology/ctx";
import type { Ontology } from "../ontology/schema";
import type { Event, Member } from "../ontology/types.generated";
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
  "seed",
  "small-community",
  "ontology",
);

let ontology: Ontology;
let db: OntologyStore;
let ctx: OntologyCtx;

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
    joined_at: "2026-01-01",
    tier: "basic",
    notes: "",
    ...overrides,
  };
}

function eventRow(id: string, overrides: Partial<Event> = {}): Event {
  return {
    id,
    title: `Event ${id}`,
    starts_at: "2026-06-01T18:00:00+00:00",
    location: "Hall",
    description: "An event",
    created_at: "2026-05-01T09:00:00+00:00",
    ...overrides,
  };
}

describe("runDeclarativeAction — creates_object (seed: add_member)", () => {
  it("creates a Member row from typed params + auto-filled system fields", async () => {
    const result = await runDeclarativeAction({
      actionName: "add_member",
      ontology,
      params: {
        full_name: "Ada Lovelace",
        email: "ada@example.com",
        tier: "sustaining",
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
      tier: "sustaining",
    });
    expect(stored?.joined_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(stored?.notes).toBe("");
  });
});

describe("runDeclarativeAction — creates_object (seed: add_meeting_minute)", () => {
  it("creates a MeetingMinute row, threading the event ref through", async () => {
    await db.objects.Event.create(eventRow("e-1"));

    const result = await runDeclarativeAction({
      actionName: "add_meeting_minute",
      ontology,
      params: {
        title: "May standup",
        body: "We discussed the roadmap.",
        event: "e-1",
      },
      ctx,
    });

    expect(result).toMatchObject({
      ok: true,
      directive: "creates_object",
      object_type: "MeetingMinute",
    });
    const id = (result as { id: string }).id;
    const stored = await ctx.objects.MeetingMinute.findById(id);
    expect(stored).toMatchObject({
      id,
      title: "May standup",
      body: "We discussed the roadmap.",
      event_id: "e-1",
    });
    expect(stored?.created_at).toMatch(/^\d{4}-/);
  });
});

describe("runDeclarativeAction — creates_link (seed: record_attendance)", () => {
  it("creates the attended edge with role + auto-filled attended_at", async () => {
    await db.objects.Member.create(memberRow("m-1"));
    await db.objects.Event.create(eventRow("e-1"));

    const result = await runDeclarativeAction({
      actionName: "record_attendance",
      ontology,
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

    const edges = await ctx.links.attended.traverse({ from: "m-1" });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      from: "m-1",
      to: "e-1",
      properties: { role: "organizer" },
    });
    expect(edges[0].properties.attended_at).toMatch(/^\d{4}-/);
  });

  it("defaults link role enum to attendee when omitted", async () => {
    await db.objects.Member.create(memberRow("m-2"));
    await db.objects.Event.create(eventRow("e-2"));
    await runDeclarativeAction({
      actionName: "record_attendance",
      ontology,
      params: { member: "m-2", event: "e-2" },
      ctx,
    });
    const edges = await ctx.links.attended.traverse({ from: "m-2" });
    expect(edges[0].properties.role).toBe("attendee");
  });
});

describe("runDeclarativeAction — updates directive (synthetic action)", () => {
  it("patches a Member row by id with the remaining params", async () => {
    await db.objects.Member.create(memberRow("m-9", { tier: "basic" }));

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
    expect(stored?.tier).toBe("lifetime");
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
    await expect(
      runDeclarativeAction({
        actionName: "add_member",
        ontology,
        params: { full_name: 42 },
        ctx,
      }),
    ).rejects.toBeInstanceOf(DeclarativeActionError);
  });
});
