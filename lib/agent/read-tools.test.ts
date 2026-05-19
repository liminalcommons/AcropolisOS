import path from "node:path";
import { describe, expect, it } from "vitest";
import { Tool } from "@mastra/core/tools";
import { InMemoryAuditStore } from "../audit/writer";
import type { Actor } from "../ctx";
import { loadOntology } from "../ontology/load";
import {
  buildObjectPermissionsMap,
  createCtx,
  createInMemoryStore,
  type OntologyCtx,
} from "../ontology/ctx";
import type {
  AttendedLink,
  Event,
  MeetingMinute,
  Member,
} from "../ontology/types.generated";
import {
  buildReadToolsForActor,
  invokeReadTool,
} from "./read-tools";
import { getToolsForActor } from "./tool-gating";

const PKG_ROOT = path.resolve(__dirname, "..", "..");
const SMALL_COMMUNITY = path.join(
  PKG_ROOT,
  "seed",
  "small-community",
);

const stewardActor: Actor = {
  userId: "u-steward",
  email: "steward@example.com",
  role: "steward",
  customRoles: [],
};

// IMPORTANT (M3.1 / US-031): for the Member type, `member_self` resolves via
// `row.id === actor.userId`. The seeded "own" Member row id below
// (11111111-...111) must equal this userId, otherwise this actor cannot
// even read their own row under the tightened seed (read: ["steward",
// "member_self"]).
const memberActor: Actor = {
  userId: "11111111-1111-1111-1111-111111111111",
  email: "member@example.com",
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
    notes: `private notes for ${id}`,
    ...overrides,
  };
}

function eventRow(id: string, overrides: Partial<Event> = {}): Event {
  return {
    id,
    title: `Event ${id}`,
    starts_at: "2026-05-01T19:00:00+00:00",
    location: "Town Hall",
    description: `desc-${id}`,
    created_at: "2026-04-01T00:00:00+00:00",
    ...overrides,
  };
}

function minuteRow(
  id: string,
  eventId: string,
  overrides: Partial<MeetingMinute> = {},
): MeetingMinute {
  return {
    id,
    title: `Minutes ${id}`,
    body: `body-${id}`,
    event_id: eventId,
    created_at: "2026-05-02T00:00:00+00:00",
    ...overrides,
  };
}

async function makeSeededCtx(actor: Actor): Promise<{
  ctx: OntologyCtx;
  audit: InMemoryAuditStore;
  ontology: Awaited<ReturnType<typeof loadOntology>>;
  memberId: string;
  eventId: string;
  minuteId: string;
}> {
  const ontology = await loadOntology(SMALL_COMMUNITY);
  const db = createInMemoryStore();
  const audit = new InMemoryAuditStore();
  const permissions = buildObjectPermissionsMap(ontology);

  // Seed (unwrapped — bypass permissions for setup).
  const memberId = "11111111-1111-1111-1111-111111111111";
  const otherMemberId = "11111111-1111-1111-1111-111111111112";
  const eventId = "22222222-2222-2222-2222-222222222222";
  const otherEventId = "22222222-2222-2222-2222-222222222223";
  const minuteId = "33333333-3333-3333-3333-333333333333";

  await db.objects.Member.create(memberRow(memberId, { full_name: "Ada" }));
  await db.objects.Member.create(memberRow(otherMemberId, { full_name: "Bea" }));
  await db.objects.Event.create(eventRow(eventId, { title: "Spring Gathering" }));
  await db.objects.Event.create(eventRow(otherEventId, { title: "Autumn Council" }));
  await db.objects.MeetingMinute.create(minuteRow(minuteId, eventId));
  const link: AttendedLink = {
    attended_at: "2026-05-01T19:30:00+00:00",
    role: "attendee",
  };
  await db.links.attended.create({
    from: memberId,
    to: eventId,
    properties: link,
  });

  // Pre-seed an audit row that read_tools should be able to surface.
  await audit.insertOntologyAudit({
    actor: "u-steward",
    actor_role: "steward",
    via: "test",
    subject_type: "Member",
    subject_id: memberId,
    before: null,
    after: { full_name: "Ada" },
  });
  await audit.insertOntologyAudit({
    actor: "u-steward",
    actor_role: "steward",
    via: "test",
    subject_type: "Event",
    subject_id: eventId,
    before: null,
    after: { title: "Spring Gathering" },
  });

  const ctx = createCtx({ db, actor, permissions, audit });
  return { ctx, audit, ontology, memberId, eventId, minuteId };
}

describe("buildReadToolsForActor — every READ op returns a working Mastra Tool", () => {
  it("returns Tool instances for each (READ op × object type) pair", async () => {
    const { ctx, ontology } = await makeSeededCtx(stewardActor);
    const tools = buildReadToolsForActor({ ontology, ctx });
    for (const obj of Object.keys(ontology.object_types)) {
      const lowered = obj.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
      for (const op of [
        "describe",
        "query",
        "traverse",
        "sample",
        "read",
        "audit",
      ]) {
        const id = `${op}_${lowered}`;
        expect(tools[id], `missing tool ${id}`).toBeInstanceOf(Tool);
      }
    }
  });
});

describe("describe_<object> tool", () => {
  it("returns the object type name plus its property map", async () => {
    const { ctx, ontology } = await makeSeededCtx(stewardActor);
    const tools = buildReadToolsForActor({ ontology, ctx });
    const out = await invokeReadTool(tools.describe_member, {});
    expect(out.name).toBe("Member");
    expect(out.properties).toMatchObject({
      id: expect.anything(),
      full_name: expect.anything(),
      tier: expect.anything(),
    });
  });
});

describe("query_<object> tool", () => {
  it("returns all rows when no filter is given", async () => {
    const { ctx, ontology } = await makeSeededCtx(stewardActor);
    const tools = buildReadToolsForActor({ ontology, ctx });
    const out = await invokeReadTool(tools.query_member, {});
    expect(out.results).toHaveLength(2);
  });

  it("respects filter equality", async () => {
    const { ctx, ontology } = await makeSeededCtx(stewardActor);
    const tools = buildReadToolsForActor({ ontology, ctx });
    const out = await invokeReadTool(tools.query_member, {
      filter: { full_name: "Ada" },
    });
    expect(out.results).toHaveLength(1);
    expect(out.results[0].full_name).toBe("Ada");
  });

  it("clamps to limit when given", async () => {
    const { ctx, ontology } = await makeSeededCtx(stewardActor);
    const tools = buildReadToolsForActor({ ontology, ctx });
    const out = await invokeReadTool(tools.query_member, { limit: 1 });
    expect(out.results).toHaveLength(1);
  });
});

describe("read_<object> tool", () => {
  it("returns the record when found", async () => {
    const { ctx, ontology, memberId } = await makeSeededCtx(stewardActor);
    const tools = buildReadToolsForActor({ ontology, ctx });
    const out = await invokeReadTool(tools.read_member, { id: memberId });
    expect(out.record).not.toBeNull();
    expect(out.record!.id).toBe(memberId);
  });

  it("returns null when missing", async () => {
    const { ctx, ontology } = await makeSeededCtx(stewardActor);
    const tools = buildReadToolsForActor({ ontology, ctx });
    const out = await invokeReadTool(tools.read_member, { id: "nope" });
    expect(out.record).toBeNull();
  });

  it("hides property-level permissioned fields for a non-steward", async () => {
    const { ctx, ontology, memberId } = await makeSeededCtx(memberActor);
    const tools = buildReadToolsForActor({ ontology, ctx });
    const out = await invokeReadTool(tools.read_member, { id: memberId });
    expect(out.record).not.toBeNull();
    // `notes` is steward-only at property level.
    expect((out.record as Record<string, unknown>).notes).toBeUndefined();
  });
});

describe("sample_<object> tool", () => {
  it("returns at most N rows", async () => {
    const { ctx, ontology } = await makeSeededCtx(stewardActor);
    const tools = buildReadToolsForActor({ ontology, ctx });
    const out = await invokeReadTool(tools.sample_member, { n: 1 });
    expect(out.samples).toHaveLength(1);
  });

  it("defaults to its declared default when n is omitted", async () => {
    const { ctx, ontology } = await makeSeededCtx(stewardActor);
    const tools = buildReadToolsForActor({ ontology, ctx });
    const out = await invokeReadTool(tools.sample_event, {});
    expect(out.samples.length).toBeGreaterThan(0);
    expect(out.samples.length).toBeLessThanOrEqual(5);
  });
});

describe("traverse_<object> tool", () => {
  it("returns linked rows + edge properties for outgoing links from the row", async () => {
    const { ctx, ontology, memberId, eventId } = await makeSeededCtx(stewardActor);
    const tools = buildReadToolsForActor({ ontology, ctx });
    const out = await invokeReadTool(tools.traverse_member, { id: memberId });
    expect(out.linked.length).toBeGreaterThan(0);
    const hit = out.linked.find(
      (l: { link?: string; to?: string }) => l.to === eventId,
    );
    expect(hit).toBeDefined();
    expect((hit as { link: string }).link).toBe("attended");
  });

  it("filters by link name when supplied", async () => {
    const { ctx, ontology, memberId } = await makeSeededCtx(stewardActor);
    const tools = buildReadToolsForActor({ ontology, ctx });
    const out = await invokeReadTool(tools.traverse_member, {
      id: memberId,
      link: "attended",
    });
    expect(
      out.linked.every((l: { link: string }) => l.link === "attended"),
    ).toBe(true);
  });

  it("returns an empty linked list when the row has no edges", async () => {
    const { ctx, ontology } = await makeSeededCtx(stewardActor);
    const tools = buildReadToolsForActor({ ontology, ctx });
    const out = await invokeReadTool(tools.traverse_member, {
      id: "11111111-1111-1111-1111-111111111112",
    });
    expect(out.linked).toEqual([]);
  });
});

describe("audit_<object> tool", () => {
  it("returns audit rows scoped to the object type", async () => {
    const { ctx, ontology } = await makeSeededCtx(stewardActor);
    const tools = buildReadToolsForActor({ ontology, ctx });
    const out = await invokeReadTool(tools.audit_member, {});
    expect(out.entries.length).toBe(1);
    expect((out.entries[0] as { subject_type: string }).subject_type).toBe(
      "Member",
    );
  });

  it("filters by id when supplied", async () => {
    const { ctx, ontology, memberId } = await makeSeededCtx(stewardActor);
    const tools = buildReadToolsForActor({ ontology, ctx });
    const out = await invokeReadTool(tools.audit_member, { id: memberId });
    expect(out.entries.length).toBe(1);
    expect((out.entries[0] as { subject_id: string }).subject_id).toBe(
      memberId,
    );
  });

  it("returns empty entries when audit store is not wired", async () => {
    const { ctx, ontology } = await makeSeededCtx(stewardActor);
    // Strip audit by re-creating ctx without it
    const ctxNoAudit = { ...ctx, audit: undefined };
    const tools = buildReadToolsForActor({ ontology, ctx: ctxNoAudit });
    const out = await invokeReadTool(tools.audit_event, {});
    expect(out.entries).toEqual([]);
  });
});

describe("getToolsForActor — wires real READ executes when ctx is supplied", () => {
  it("read_member returns the row via the gated bundle", async () => {
    const { ctx, ontology, memberId } = await makeSeededCtx(stewardActor);
    const { tools } = getToolsForActor(ontology, stewardActor, { ctx });
    const tool = tools.read_member;
    expect(tool).toBeInstanceOf(Tool);
    const out = await invokeReadTool(tool, { id: memberId });
    expect((out.record as { id: string }).id).toBe(memberId);
  });

  it("read_member without ctx still produces a tool but execute throws not-implemented", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const { tools } = getToolsForActor(onto, stewardActor);
    await expect(
      invokeReadTool(tools.read_member, { id: "irrelevant" }),
    ).rejects.toThrow(/not implemented/);
  });
});
