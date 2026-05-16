import { describe, expect, it } from "vitest";
import {
  assertOntologyIntegrity,
  OntologyIntegrityError,
} from "./load";
import type { Ontology } from "./schema";

function baseOntology(): Ontology {
  return {
    properties: { email: { type: "email" } },
    roles: {
      member: { description: "any" },
      steward: { description: "any" },
    },
    object_types: {
      Member: {
        properties: {
          id: { type: "uuid", primary_key: true },
          full_name: { type: "string" },
        },
      },
    },
    link_types: {},
    action_types: {},
  };
}

describe("assertOntologyIntegrity", () => {
  it("passes on a coherent base ontology", () => {
    expect(() => assertOntologyIntegrity(baseOntology())).not.toThrow();
  });

  it("rejects a ref to an undeclared shared property", () => {
    const onto = baseOntology();
    onto.object_types.Member.properties.email = { ref: "nonexistent" };
    expect(() => assertOntologyIntegrity(onto)).toThrow(OntologyIntegrityError);
  });

  it("rejects a ref-typed property pointing at an unknown object type", () => {
    const onto = baseOntology();
    onto.object_types.Member.properties.bff = {
      type: "ref",
      target: "Ghost",
    };
    try {
      assertOntologyIntegrity(onto);
      expect.fail("expected throw");
    } catch (err) {
      const e = err as OntologyIntegrityError;
      expect(e.violations[0].message).toContain("Ghost");
    }
  });

  it("rejects a link type pointing at unknown object types", () => {
    const onto = baseOntology();
    onto.link_types.bogus = {
      from: "Member",
      to: "Phantom",
      cardinality: "many-to-many",
    };
    try {
      assertOntologyIntegrity(onto);
      expect.fail("expected throw");
    } catch (err) {
      const e = err as OntologyIntegrityError;
      expect(
        e.violations.some((v) => v.pointer.includes("/link_types/bogus/to")),
      ).toBe(true);
    }
  });

  it("rejects an action whose creates_link is undefined", () => {
    const onto = baseOntology();
    onto.action_types.dangling = {
      creates_link: "nowhere",
      agent_policy: "always_confirm",
    };
    try {
      assertOntologyIntegrity(onto);
      expect.fail("expected throw");
    } catch (err) {
      const e = err as OntologyIntegrityError;
      expect(e.violations[0].pointer).toContain("creates_link");
    }
  });

  it("rejects an unknown permission token", () => {
    const onto = baseOntology();
    onto.object_types.Member.permissions = { read: ["ghost_role"] };
    try {
      assertOntologyIntegrity(onto);
      expect.fail("expected throw");
    } catch (err) {
      const e = err as OntologyIntegrityError;
      expect(e.violations[0].message).toContain("ghost_role");
    }
  });

  it("accepts the built-in permission tokens * and member_self", () => {
    const onto = baseOntology();
    onto.object_types.Member.permissions = {
      read: ["*"],
      write: ["steward", "member_self"],
    };
    expect(() => assertOntologyIntegrity(onto)).not.toThrow();
  });

  it("rejects a title_property that does not name a declared property", () => {
    const onto = baseOntology();
    onto.object_types.Member.title_property = "missing";
    try {
      assertOntologyIntegrity(onto);
      expect.fail("expected throw");
    } catch (err) {
      const e = err as OntologyIntegrityError;
      expect(e.violations[0].pointer).toContain("title_property");
    }
  });
});
