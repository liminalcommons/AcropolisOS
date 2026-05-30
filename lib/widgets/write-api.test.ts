import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildCanWriteType } from "./write-api";
import { loadOntology } from "@/lib/ontology/load";
import type { Ontology } from "@/lib/ontology/schema";
import type { Actor } from "@/lib/ctx";

const steward: Actor = { userId: "u-s", email: "s@x", role: "steward", customRoles: [] };
const member: Actor = { userId: "u-m", email: "m@x", role: "member", customRoles: [] };

let ontology: Ontology;
beforeAll(async () => {
  // bed write:[manager]; booking/guest write:[steward,manager]; member write:[manager,member_self]
  ontology = await loadOntology(path.resolve(__dirname, "../../ontology"));
});

describe("buildCanWriteType (UX write gate, mirrors the write fence tokens)", () => {
  it("steward: booking/guest allow (steward token), bed deny (manager-only)", () => {
    const can = buildCanWriteType(steward, ontology);
    expect(can("booking")).toBe(true);
    expect(can("guest")).toBe(true);
    expect(can("bed")).toBe(false); // write:[manager] — steward is not a manager
  });

  it("member: restricted types deny; member_self type (member) allows create", () => {
    const can = buildCanWriteType(member, ontology);
    expect(can("booking")).toBe(false);
    expect(can("bed")).toBe(false);
    expect(can("member")).toBe(true); // write includes member_self
  });

  it("anonymous (null): everything denies, fail-closed", () => {
    const can = buildCanWriteType(null, ontology);
    expect(can("booking")).toBe(false);
    expect(can("member")).toBe(false);
    expect(can("bed")).toBe(false);
  });

  it("unknown type denies", () => {
    expect(buildCanWriteType(steward, ontology)("not_a_type")).toBe(false);
  });
});
