// Pure projection of (ontology + data + viewer) into a graph model. The
// load-bearing invariant is the read fence: an unreadable/hidden type yields no
// nodes, and any edge to a missing node is dropped — so a member's graph is a
// strict subset of the steward's, with no dangling endpoints and no id leak.
import { describe, it, expect } from "vitest";
import { deriveDataGraph } from "@/lib/graph/data-graph";
import type { Ontology } from "@/lib/ontology/schema";
import type { CanReadType } from "@/lib/widgets/read-api";

const ONT = {
  object_types: {
    Member: { title_property: "full_name", kind: "agent", properties: { id: { type: "uuid", primary_key: true }, full_name: { type: "string" } } },
    Guest: { title_property: "full_name", kind: "agent", properties: { id: { type: "uuid", primary_key: true }, full_name: { type: "string" } } },
    Room: { title_property: "code", kind: "resource", properties: { id: { type: "uuid", primary_key: true }, code: { type: "string" } } },
    Bed: { title_property: "code", kind: "resource", properties: { id: { type: "uuid", primary_key: true }, code: { type: "string" }, room: { type: "ref", target: "Room" } } },
    Booking: { title_property: "label", kind: "commitment", properties: { id: { type: "uuid", primary_key: true }, label: { type: "string" }, guest: { type: "ref", target: "Guest" }, bed: { type: "ref", target: "Bed" } } },
  },
  properties: {},
  link_types: {},
  action_types: {},
} as unknown as Ontology;

const ROWS: Record<string, Array<Record<string, unknown>>> = {
  member: [{ id: "m1", full_name: "Lucia" }],
  guest: [{ id: "g1", full_name: "Lena" }, { id: "g2", full_name: "Sofia" }],
  room: [{ id: "r1", code: "D3" }],
  bed: [{ id: "b1", code: "D3-A2", room: "r1" }, { id: "b2", code: "S1-3", room: "r1" }],
  booking: [{ id: "bk1", label: "Lena/D3-A2", guest: "g1", bed: "b1" }, { id: "bk2", label: "Sofia/S1-3", guest: "g2", bed: "b2" }],
};

const ALL: CanReadType = () => true;
const ids = (m: { nodes: { id: string }[] }) => m.nodes.map((n) => n.id).sort();

describe("deriveDataGraph", () => {
  it("emits a node per readable row and an edge per non-null ref", () => {
    const m = deriveDataGraph(ONT, ROWS, [], ALL);
    expect(m.nodes).toHaveLength(8); // 1 member + 2 guest + 1 room + 2 bed + 2 booking
    expect(m.edges).toHaveLength(6); // bed.room x2 + booking.guest x2 + booking.bed x2
    expect(m.nodes.find((n) => n.id === "booking:bk1")).toMatchObject({ type: "booking", label: "Lena/D3-A2", kind: "commitment" });
    expect(m.edges.some((e) => e.source === "booking:bk1" && e.target === "guest:g1" && e.label === "guest")).toBe(true);
    expect(m.edges.some((e) => e.source === "bed:b1" && e.target === "room:r1" && e.label === "room")).toBe(true);
  });

  it("FENCE: drops edges whose target type is unreadable (no dangling endpoints, no leak)", () => {
    const noGuest: CanReadType = (t) => t !== "guest";
    const m = deriveDataGraph(ONT, ROWS, [], noGuest);
    expect(m.nodes.some((n) => n.type === "guest")).toBe(false); // no guest nodes
    expect(m.edges.some((e) => e.target.startsWith("guest:"))).toBe(false); // booking.guest edges dropped
    expect(m.edges.some((e) => e.label === "bed")).toBe(true); // booking.bed survives
    expect(m.nodes).toHaveLength(6);
    expect(m.edges).toHaveLength(4);
  });

  it("FENCE: a member's graph is a strict subset of the steward's", () => {
    const steward = deriveDataGraph(ONT, ROWS, [], ALL);
    const member: CanReadType = (t) => t === "guest" || t === "booking"; // can't read member/room/bed
    const m = deriveDataGraph(ONT, ROWS, [], member);
    const stewardIds = new Set(ids(steward));
    for (const id of ids(m)) expect(stewardIds.has(id)).toBe(true);
    expect(m.nodes.length).toBeLessThan(steward.nodes.length);
    // booking.bed/booking.guest edges: guest readable, bed NOT → bed edges dropped, guest edges kept
    expect(m.edges.every((e) => !e.target.startsWith("bed:") && !e.target.startsWith("room:"))).toBe(true);
  });

  it("excludes hidden types", () => {
    const m = deriveDataGraph(ONT, ROWS, [], ALL, { hiddenTypes: ["member", "room"] });
    expect(m.nodes.some((n) => n.type === "member" || n.type === "room")).toBe(false);
    expect(m.nodes).toHaveLength(6); // 2 guest + 2 bed + 2 booking
    expect(m.edges.some((e) => e.target.startsWith("room:"))).toBe(false); // bed.room dropped (room hidden)
  });

  it("keeps provided link edges only when both endpoints are present", () => {
    const links = [
      { source: "guest:g1", target: "room:r1", label: "visited" }, // both present
      { source: "guest:g2", target: "member:gone", label: "x" }, // target absent
    ];
    const m = deriveDataGraph(ONT, ROWS, links, ALL);
    expect(m.edges.some((e) => e.label === "visited")).toBe(true);
    expect(m.edges.some((e) => e.target === "member:gone")).toBe(false);
  });

  it("ego mode: keeps only the N-hop neighborhood of the focus node", () => {
    const h1 = deriveDataGraph(ONT, ROWS, [], ALL, { focus: { type: "guest", id: "g1" }, hops: 1 });
    expect(ids(h1)).toEqual(["booking:bk1", "guest:g1"]); // g1 + the booking referencing it
    expect(h1.edges).toHaveLength(1);

    const h2 = deriveDataGraph(ONT, ROWS, [], ALL, { focus: { type: "guest", id: "g1" }, hops: 2 });
    expect(ids(h2)).toEqual(["bed:b1", "booking:bk1", "guest:g1"]); // + the bed bk1 references
    expect(h2.edges.map((e) => e.label).sort()).toEqual(["bed", "guest"]);
  });

  it("ego mode: empty when the focus node is unreadable", () => {
    const noGuest: CanReadType = (t) => t !== "guest";
    const m = deriveDataGraph(ONT, ROWS, [], noGuest, { focus: { type: "guest", id: "g1" }, hops: 2 });
    expect(m.nodes).toHaveLength(0);
    expect(m.edges).toHaveLength(0);
  });
});
